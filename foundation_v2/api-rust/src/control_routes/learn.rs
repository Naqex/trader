use super::*;
use std::path::{Component, Path as FilePath, PathBuf};

fn unavailable(message: &str) -> ApiError {
    ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, message)
}
fn missing() -> ApiError {
    ApiError::detail(StatusCode::NOT_FOUND, "learn_resource_not_found")
}

fn safe_relative(value: &Value) -> Option<PathBuf> {
    let raw = value.as_str()?.trim().replace('\\', "/");
    if raw.is_empty() || raw.contains(':') || raw.starts_with('/') {
        return None;
    }
    let path = PathBuf::from(raw);
    if path.components().any(|c| {
        matches!(
            c,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return None;
    }
    if path
        .components()
        .next()?
        .as_os_str()
        .to_str()?
        .eq_ignore_ascii_case("assessments")
    {
        return None;
    }
    Some(path)
}

fn pending_path(pending: &Value) -> Option<PathBuf> {
    let path = safe_relative(&pending["lesson_file"])?;
    if path.components().next()?.as_os_str() != "practice" {
        return None;
    }
    Some(path)
}

fn read(root: &FilePath, path: &FilePath, label: &str) -> Result<String, ApiError> {
    let target = root
        .join(path)
        .canonicalize()
        .map_err(|_| unavailable(&format!("{label} is unavailable")))?;
    // Manifest paths must remain inside the education root after symlink resolution.
    if !target.starts_with(root) {
        return Err(unavailable(&format!("{label} is unavailable")));
    }
    std::fs::read_to_string(target)
        .map(|s| s.replace("\r\n", "\n").replace('\r', "\n"))
        .map_err(|_| unavailable(&format!("{label} is unavailable")))
}
fn load(root: &FilePath, file: &str, label: &str) -> Result<Value, ApiError> {
    let value: Value = serde_json::from_str(&read(root, FilePath::new(file), label)?)
        .map_err(|_| unavailable(&format!("{label} is unavailable")))?;
    if !value.is_object() {
        return Err(unavailable(&format!("{label} must be a JSON object")));
    }
    Ok(value)
}

pub(super) async fn dispatch(
    state: Arc<AppState>,
    scope: Workspace,
    action: String,
    id: Option<String>,
) -> Result<Value, ApiError> {
    let workspace = std::env::var("TW_V2_LEARN_WORKSPACE_ID")
        .ok()
        .filter(|s| !s.is_empty());
    let root = std::env::var("TW_V2_EDUCATION_ROOT")
        .ok()
        .filter(|s| !s.is_empty());
    if workspace.is_some() != root.is_some() {
        return Err(unavailable(
            "TW_V2_LEARN_WORKSPACE_ID and TW_V2_EDUCATION_ROOT must be configured together",
        ));
    }
    if workspace.as_deref().map(str::trim) != Some(scope.workspace_id.trim()) || root.is_none() {
        return Err(ApiError::detail(
            StatusCode::NOT_FOUND,
            "learn_not_configured",
        ));
    }
    let root = PathBuf::from(root.unwrap());
    let permit = state
        .artifact_reads
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| unavailable("artifact_reader_unavailable"))?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        read_view(&root, &action, id.as_deref())
    })
    .await
    .map_err(|_| unavailable("learn_reader_failed"))?
}

pub(super) fn read_view(
    root: &FilePath,
    action: &str,
    id: Option<&str>,
) -> Result<Value, ApiError> {
    let root = root
        .canonicalize()
        .or_else(|_| std::path::absolute(root))
        .map_err(|_| unavailable("learn root is unavailable"))?;
    match action {
        "overview" => overview(&root),
        "glossary" => {
            let reference = read(&root, FilePath::new("reference.md"), "course reference")?;
            let mut active = false;
            let mut items = vec![];
            for raw in reference.lines() {
                let line = raw.trim();
                if line.starts_with("## ") {
                    if active {
                        break;
                    }
                    active = line.contains("Thuật ngữ theo ngữ cảnh");
                    continue;
                }
                if !active || !line.starts_with('|') {
                    continue;
                }
                let cells = line
                    .trim_matches('|')
                    .split('|')
                    .map(str::trim)
                    .collect::<Vec<_>>();
                if cells.len() != 2
                    || cells[0] == "Thuật ngữ"
                    || cells[0] == "---"
                    || (!cells[0].is_empty() && cells[0].chars().all(|c| c == '-'))
                {
                    continue;
                }
                items.push(json!({"term":cells[0],"meaning_vi":cells[1]}));
            }
            Ok(
                json!({"schema_version":"learn-glossary-v1","primary_language":"vi","english_role":"trading_terminology_support_only","count":items.len(),"items":items}),
            )
        }
        "resource" => {
            let id = id.ok_or_else(missing)?;
            let relative = match id {
                "course" => PathBuf::from("COURSE.md"),
                "workbook" => PathBuf::from("practice/workbook.md"),
                "pending-activity" => pending_path(
                    &load(&root, "progress.json", "course progress")?["pending_activity"],
                )
                .ok_or_else(missing)?,
                _ => {
                    let module = id.strip_prefix("module:").ok_or_else(missing)?;
                    let course = load(&root, "course.json", "course manifest")?;
                    course["modules"]
                        .as_array()
                        .and_then(|items| items.iter().find(|m| m["id"] == module))
                        .and_then(|m| safe_relative(&m["file"]))
                        .ok_or_else(missing)?
                }
            };
            Ok(
                json!({"resource_id":id,"format":"markdown","content":read(&root,&relative,"learn resource")?}),
            )
        }
        _ => Err(missing()),
    }
}

fn overview(root: &FilePath) -> Result<Value, ApiError> {
    let course = load(root, "course.json", "course manifest")?;
    let progress = load(root, "progress.json", "course progress")?;
    let mut modules = vec![];
    let mut count = 0;
    for module in course["modules"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| m.is_object())
    {
        let lessons = module["lessons"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|l| l.is_object())
            .map(|l| json!({"id":l["id"],"title":l["title"]}))
            .collect::<Vec<_>>();
        count += lessons.len();
        let mut item = json!({"id":module["id"],"title":module["title"],"lessons":lessons});
        if let Some(id) = module["id"].as_str().filter(|s| !s.is_empty()) {
            if safe_relative(&module["file"]).is_some() {
                item["href"] = json!(format!("/api/v2/learn/resources/module:{id}"));
            }
        }
        modules.push(item);
    }
    let main = &progress["main_course"];
    let pending = &progress["pending_activity"];
    let mut links = json!({"course":"/api/v2/learn/resources/course","glossary":"/api/v2/learn/glossary","workbook":"/api/v2/learn/resources/workbook"});
    if pending_path(pending).is_some() {
        links["pending_activity"] = json!("/api/v2/learn/resources/pending-activity");
    }
    let mut activity = serde_json::Map::new();
    for key in ["id", "objective", "lesson_file", "variant"] {
        if !pending[key].is_null() {
            activity.insert(key.into(), pending[key].clone());
        }
    }
    Ok(
        json!({"schema_version":"learn-overview-v2","course":{"version":course["version"],"title":course["title"],"status":course["status"],"primary_language":course["primary_language"],"start_lesson":course["start_lesson"],"module_count":modules.len(),"lesson_count":count,"modules":modules},"progress":{"phase":progress["phase"],"course_version":progress["course_version"],"updated_on":progress["updated_on"],"status":main["status"],"current_lesson_id":main["current_lesson_id"],"completed_lessons":main["completed_lessons"].as_array().cloned().unwrap_or_default(),"completed_modules":main["completed_modules"].as_array().cloned().unwrap_or_default(),"pending_status":progress["pending_status"],"pending_activity":activity},"links":links,"safety":{"read_only":true,"progress_owner":"education/progress.json","answer_keys_exposed":false,"auto_completion_enabled":false}}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_answer_keys_and_traversal() {
        for path in [
            "assessments/answers.json",
            "Assessments/answers.json",
            "../secret",
            "C:\\secret",
            "/secret",
            "practice/../../secret",
        ] {
            assert!(safe_relative(&json!(path)).is_none(), "{path}");
        }
        assert!(pending_path(&json!({"lesson_file":"modules/a.md"})).is_none());
        assert!(pending_path(&json!({"lesson_file":"practice/a.md"})).is_some());
    }
    #[test]
    fn reads_fixture_without_mutation() {
        let root = std::env::temp_dir().join(format!("rust-learn-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("practice")).unwrap();
        std::fs::write(root.join("course.json"),r#"{"title":"Khóa học","modules":[{"id":"one","file":"lesson.md","lessons":[{"id":"1","title":"Một"}]}]}"#).unwrap();
        std::fs::write(root.join("progress.json"),r#"{"main_course":{"current_lesson_id":"1"},"pending_activity":{"lesson_file":"practice/a.md"}}"#).unwrap();
        std::fs::write(root.join("reference.md"),"## Thuật ngữ theo ngữ cảnh\n| Thuật ngữ | Ý nghĩa |\n| --- | --- |\n| Bid | Giá bán |\n## Other\n| Hidden | No |\n").unwrap();
        std::fs::write(root.join("practice/a.md"), "Nội dung\r\n").unwrap();
        let progress = std::fs::read(root.join("progress.json")).unwrap();
        assert_eq!(
            read_view(&root, "overview", None).unwrap()["course"]["lesson_count"],
            1
        );
        assert_eq!(read_view(&root, "glossary", None).unwrap()["count"], 1);
        assert_eq!(
            read_view(&root, "resource", Some("pending-activity")).unwrap()["content"],
            "Nội dung\n"
        );
        assert_eq!(std::fs::read(root.join("progress.json")).unwrap(), progress);
        std::fs::remove_dir_all(root).unwrap();
    }
}
