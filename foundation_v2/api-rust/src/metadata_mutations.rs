use crate::{
    auth::{ApiError, Workspace},
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{MatchedPath, OriginalUri, Path, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::post,
};
use chrono::{SecondsFormat, Utc};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc};
use tokio_postgres::Transaction;
use uuid::Uuid;

pub const ROUTES: &[&str] = &[
    "/api/v2/playbooks",
    "/api/v2/playbooks/{record_id}/revisions",
    "/api/v2/playbooks/{record_id}/freeze",
    "/api/v2/playbooks/{record_id}/fork",
    "/api/v2/journal",
    "/api/v2/journal/{record_id}/revisions",
    "/api/v2/chart/annotations",
    "/api/v2/chart/annotations/{record_id}/revisions",
    "/api/v2/chart/annotations/{record_id}/delete",
];

pub fn native(method: &str, path: &str) -> bool {
    method == "POST" && ROUTES.contains(&path)
}

pub fn routes() -> Router<Arc<AppState>> {
    let mut router = Router::new();
    for path in ROUTES {
        router = router.route(path, post(invoke));
    }
    router
}

async fn invoke(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    matched: MatchedPath,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    path: Option<Path<HashMap<String, String>>>,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(body) = body.map_err(|e| invalid(&e.body_text()))?;
    let mut connection = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = connection
        .transaction()
        .await
        .map_err(|_| ApiError::database())?;
    let mutation = match crate::native_mutation::begin(
        &tx,
        &scope,
        "POST",
        uri.path(),
        uri.query(),
        &headers,
        &body,
    )
    .await?
    {
        crate::native_mutation::MutationStart::Replay(response) => return Ok(response),
        crate::native_mutation::MutationStart::New(mutation) => mutation,
    };
    let id = path
        .as_ref()
        .and_then(|p| p.get("record_id"))
        .map(String::as_str);
    tx.batch_execute("SAVEPOINT metadata_domain")
        .await
        .map_err(|_| ApiError::database())?;
    let (status, value) = match execute(&tx, &scope, matched.as_str(), id, body).await {
        Ok(result) => result,
        Err(error) => {
            tx.batch_execute("ROLLBACK TO SAVEPOINT metadata_domain")
                .await
                .map_err(|_| ApiError::database())?;
            (error.0, error.1)
        }
    };
    let response = crate::native_mutation::finish(&tx, mutation, status, value).await?;
    crate::native_mutation::commit(tx, response).await
}

fn error(status: StatusCode, text: &str) -> ApiError {
    ApiError::detail(status, text)
}
fn invalid(text: &str) -> ApiError {
    error(StatusCode::UNPROCESSABLE_ENTITY, text)
}
fn conflict(text: &str) -> ApiError {
    error(StatusCode::CONFLICT, text)
}

fn validate(path: &str, value: Value) -> Result<Value, ApiError> {
    let handler = match path {
        "/api/v2/playbooks" => "create_playbook",
        "/api/v2/playbooks/{record_id}/revisions" => "revise_playbook",
        "/api/v2/playbooks/{record_id}/freeze" => "freeze_playbook",
        "/api/v2/playbooks/{record_id}/fork" => "fork_playbook",
        "/api/v2/journal" => "create_journal",
        "/api/v2/journal/{record_id}/revisions" => "revise_journal",
        "/api/v2/chart/annotations" => "create_annotation",
        "/api/v2/chart/annotations/{record_id}/revisions" => "revise_annotation",
        "/api/v2/chart/annotations/{record_id}/delete" => "delete_annotation",
        _ => return Err(invalid("metadata_contract_missing")),
    };
    crate::native_contracts::validate_body(handler, value)
}

fn draft(kind: &str, value: Value) -> Result<Value, ApiError> {
    let path = match kind {
        "playbook" => ROUTES[0],
        "journal" => ROUTES[4],
        _ => ROUTES[6],
    };
    let value = validate(path, value)?;
    if kind == "journal" {
        for key in ["kind", "id"] {
            if py_text(&value["source"][key]).trim().is_empty() {
                return Err(invalid("source requires kind and id"));
            }
        }
    } else if kind == "annotation" {
        let cutoff = value["cutoff_timestamp"]
            .as_i64()
            .ok_or_else(|| invalid("cutoff_timestamp outside supported timestamp range"))?;
        for anchor in value["anchors"].as_array().unwrap() {
            let timestamp = py_int(&anchor["timestamp"])
                .ok_or_else(|| invalid("anchor timestamp/price must be numeric"))?;
            if py_number(&anchor["price"]).is_none() {
                return Err(invalid("anchor timestamp/price must be numeric"));
            }
            if timestamp > cutoff {
                return Err(invalid("annotation anchor exceeds replay cutoff"));
            }
        }
    } else if let Some(spec) = value.get("strategy_spec").filter(|v| !v.is_null()) {
        validate_strategy(spec)?;
    }
    Ok(value)
}

fn py_text(value: &Value) -> String {
    match value {
        Value::Null | Value::Bool(false) => String::new(),
        Value::Number(n) if n.as_f64() == Some(0.0) => String::new(),
        Value::Array(items) if items.is_empty() => String::new(),
        Value::Object(map) if map.is_empty() => String::new(),
        Value::Bool(true) => "True".into(),
        Value::String(s) => s.clone(),
        _ => value.to_string(),
    }
}
fn py_number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.trim().parse().ok())
        .or_else(|| value.as_bool().map(|v| if v { 1.0 } else { 0.0 }))
}
fn py_int(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str()?.trim().parse().ok())
        .or_else(|| value.as_bool().map(i64::from))
        .or_else(|| value.as_f64().map(|v| v as i64))
}

fn validate_strategy(spec: &Value) -> Result<(), ApiError> {
    if spec["execution_capability"] == "engine-supported"
        && spec["definition_mode"] != "deterministic"
    {
        return Err(invalid(
            "engine-supported strategy specs require deterministic definitions",
        ));
    }
    if spec["edge_status"] != "unproven"
        && spec["evidence_refs"].as_array().is_none_or(Vec::is_empty)
    {
        return Err(invalid("non-unproven edge status requires evidence_refs"));
    }
    let evaluation = &spec["evaluation"];
    let metrics = evaluation["required_metrics"].as_array().unwrap();
    let mut seen = std::collections::HashSet::new();
    for metric in metrics {
        let name = metric.as_str().unwrap();
        if name.trim().is_empty() {
            return Err(invalid("required_metrics must contain non-empty names"));
        }
        if !seen.insert(name) {
            return Err(invalid("required_metrics must be unique"));
        }
    }
    if evaluation["split_policy"] == "chronological_oos"
        && evaluation["walk_forward_required"] == false
    {
        return Err(invalid("chronological_oos requires walk_forward_required"));
    }
    Ok(())
}

async fn load(
    tx: &Transaction<'_>,
    scope: &Workspace,
    kind: &str,
    id: &str,
) -> Result<Value, ApiError> {
    // Lock the head first, then read its revision with a fresh READ COMMITTED statement.
    let row = tx.query_opt("SELECT current_revision,source_key,created_at_utc,updated_at_utc FROM workspace_records WHERE workspace_id=$1 AND kind=$2 AND record_id=$3 FOR UPDATE", &[&scope.workspace_id, &kind, &id]).await.map_err(|_| ApiError::database())?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, &format!("{kind}_not_found")))?;
    let revision: i32 = row.get("current_revision");
    let version = tx.query_one("SELECT payload_json,deleted FROM workspace_record_revisions WHERE workspace_id=$1 AND kind=$2 AND record_id=$3 AND revision=$4", &[&scope.workspace_id, &kind, &id, &revision]).await.map_err(|_| ApiError::database())?;
    Ok(
        json!({"record_id":id,"source_key":row.get::<_,Option<String>>("source_key"),"revision":revision,"payload":version.get::<_,Value>("payload_json"),"deleted":version.get::<_,bool>("deleted"),"created_at_utc":row.get::<_,String>("created_at_utc"),"updated_at_utc":row.get::<_,String>("updated_at_utc")}),
    )
}

async fn create(
    tx: &Transaction<'_>,
    scope: &Workspace,
    kind: &str,
    payload: Value,
    source_key: Option<String>,
) -> Result<Value, ApiError> {
    let id = Uuid::new_v4().simple().to_string();
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true);
    tx.execute(
        "INSERT INTO workspaces(workspace_id,created_at_utc) VALUES($1,$2) ON CONFLICT DO NOTHING",
        &[&scope.workspace_id, &now],
    )
    .await
    .map_err(|_| ApiError::database())?;
    tx.execute("INSERT INTO workspace_records(workspace_id,kind,record_id,source_key,current_revision,created_at_utc,updated_at_utc) VALUES($1,$2,$3,$4,1,$5,$5)", &[&scope.workspace_id,&kind,&id,&source_key,&now]).await.map_err(|e| if e.code() == Some(&tokio_postgres::error::SqlState::UNIQUE_VIOLATION) && kind == "journal" { conflict("journal_source_exists") } else { ApiError::database() })?;
    tx.execute("INSERT INTO workspace_record_revisions(workspace_id,kind,record_id,revision,payload_json,deleted,created_at_utc) VALUES($1,$2,$3,1,$4,false,$5)", &[&scope.workspace_id,&kind,&id,&payload,&now]).await.map_err(|_| ApiError::database())?;
    Ok(
        json!({"record_id":id,"source_key":source_key,"revision":1,"payload":payload,"deleted":false,"created_at_utc":now,"updated_at_utc":now}),
    )
}

async fn update(
    tx: &Transaction<'_>,
    scope: &Workspace,
    kind: &str,
    mut current: Value,
    payload: Value,
    deleted: bool,
) -> Result<Value, ApiError> {
    if current["deleted"] == true {
        return Err(error(StatusCode::NOT_FOUND, &format!("{kind}_not_found")));
    }
    let id = current["record_id"].as_str().unwrap();
    let revision = current["revision"]
        .as_i64()
        .unwrap()
        .checked_add(1)
        .filter(|v| *v <= i32::MAX as i64)
        .ok_or_else(|| conflict("revision_exhausted"))? as i32;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true);
    tx.execute("INSERT INTO workspace_record_revisions(workspace_id,kind,record_id,revision,payload_json,deleted,created_at_utc) VALUES($1,$2,$3,$4,$5,$6,$7)", &[&scope.workspace_id,&kind,&id,&revision,&payload,&deleted,&now]).await.map_err(|_| ApiError::database())?;
    tx.execute("UPDATE workspace_records SET current_revision=$4,updated_at_utc=$5 WHERE workspace_id=$1 AND kind=$2 AND record_id=$3", &[&scope.workspace_id,&kind,&id,&revision,&now]).await.map_err(|_| ApiError::database())?;
    current["revision"] = json!(revision);
    current["payload"] = payload;
    current["deleted"] = json!(deleted);
    current["updated_at_utc"] = json!(now);
    Ok(current)
}

pub async fn execute(
    tx: &Transaction<'_>,
    scope: &Workspace,
    template: &str,
    id: Option<&str>,
    body: Value,
) -> Result<(StatusCode, Value), ApiError> {
    let body = validate(template, body)?;
    let kind = if template.starts_with("/api/v2/playbooks") {
        "playbook"
    } else if template.starts_with("/api/v2/journal") {
        "journal"
    } else {
        "annotation"
    };
    let Some(id) = id else {
        let payload = draft(kind, body)?;
        if kind == "playbook" {
            if !payload["parent_playbook_id"].is_null() || !payload["parent_revision"].is_null() {
                return Err(invalid("playbook lineage is server-managed"));
            }
            if payload["status"] != "draft" {
                return Err(conflict("new playbooks must start as draft"));
            }
        }
        let source_key = if kind == "journal" {
            Some(format!(
                "{}:{}",
                py_text(&payload["source"]["kind"]),
                py_text(&payload["source"]["id"])
            ))
        } else {
            None
        };
        return Ok((
            StatusCode::CREATED,
            create(tx, scope, kind, payload, source_key).await?,
        ));
    };
    // Annotation revisions validate the draft before looking up the record, matching the API.
    let mut payload = if template.ends_with("/revisions") {
        Some(if kind == "annotation" {
            draft(kind, body["payload"].clone())?
        } else {
            body["payload"].clone()
        })
    } else {
        None
    };
    let current = load(tx, scope, kind, id).await?;
    if kind == "annotation" && current["deleted"] == true {
        return Err(error(StatusCode::NOT_FOUND, "annotation_not_found"));
    }
    if current["revision"] != body["expected_revision"] {
        return Err(conflict("revision_conflict"));
    }
    if template.ends_with("/freeze") {
        if current["payload"]["status"] == "frozen" {
            return Ok((StatusCode::OK, current));
        }
        let mut p = current["payload"].clone();
        p["status"] = json!("frozen");
        payload = Some(draft(kind, p)?);
    } else if template.ends_with("/fork") {
        if current["payload"]["status"] != "frozen" {
            return Err(conflict("freeze the source playbook before forking it"));
        }
        let mut p = current["payload"].clone();
        p["status"] = json!("draft");
        p["parent_playbook_id"] = json!(id);
        p["parent_revision"] = body["expected_revision"].clone();
        for key in ["name", "execution_capability", "rules", "strategy_spec"] {
            if !body[key].is_null() {
                p[key] = body[key].clone();
            }
        }
        let p = draft(kind, p)?;
        return Ok((StatusCode::CREATED, create(tx, scope, kind, p, None).await?));
    } else if template.ends_with("/delete") {
        payload = Some(current["payload"].clone());
    } else if kind == "playbook" {
        if current["payload"]["status"] == "frozen" {
            return Err(conflict("frozen playbooks are immutable"));
        }
        let p = draft(kind, payload.take().unwrap())?;
        if p["status"] != "draft" {
            return Err(conflict("use the freeze transition to freeze a playbook"));
        }
        if p["parent_playbook_id"] != current["payload"]["parent_playbook_id"] {
            return Err(conflict("playbook parent id is immutable"));
        }
        if p["parent_revision"] != current["payload"]["parent_revision"] {
            return Err(conflict("playbook parent revision is immutable"));
        }
        payload = Some(p);
    } else if kind == "journal" {
        let p = draft(kind, payload.take().unwrap())?;
        if p["source"] != current["payload"]["source"] {
            return Err(conflict("journal source is immutable"));
        }
        payload = Some(p);
    }
    Ok((
        StatusCode::OK,
        update(
            tx,
            scope,
            kind,
            current,
            payload.unwrap(),
            template.ends_with("/delete"),
        )
        .await?,
    ))
}
