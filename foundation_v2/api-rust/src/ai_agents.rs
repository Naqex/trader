//! Workspace-owned assistant configuration; provider credentials and tool authority stay elsewhere.
use crate::{
    auth::{ApiError, Workspace},
    state::AppState,
};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde_json::{Value, json};
use std::sync::Arc;
use uuid::Uuid;

fn invalid() -> ApiError {
    ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, "invalid_ai_agent")
}
fn missing() -> ApiError {
    ApiError::detail(StatusCode::NOT_FOUND, "ai_agent_not_found")
}
pub(crate) fn reference(body: &Value) -> Result<(Option<Uuid>, i64), ApiError> {
    let Some(value) = body.get("agent") else {
        return Ok((None, 0));
    };
    if value.as_object().is_none_or(|v| v.len() != 2) {
        return Err(invalid());
    }
    let id = value["id"].as_str().ok_or_else(invalid)?;
    let revision = value["revision"].as_i64().ok_or_else(invalid)?;
    if id == "mentor" && revision == 0 {
        return Ok((None, 0));
    }
    if revision < 1 {
        return Err(invalid());
    }
    Ok((Some(Uuid::parse_str(id).map_err(|_| invalid())?), revision))
}
fn validate(body: &Value) -> Result<Value, ApiError> {
    if body.as_object().is_none_or(|v| {
        v.keys().any(|k| {
            ![
                "name",
                "description",
                "instructions",
                "knowledge",
                "revision",
            ]
            .contains(&k.as_str())
        })
    }) {
        return Err(invalid());
    }
    for (field, max, required) in [
        ("name", 40, true),
        ("description", 240, false),
        ("instructions", 8000, false),
    ] {
        if !body[field].as_str().is_some_and(|v| {
            v.chars().count() <= max && (!required || !v.trim().is_empty()) && !v.contains('\0')
        }) {
            return Err(invalid());
        }
    }
    let files = body["knowledge"].as_array().ok_or_else(invalid)?;
    if files.len() > 5 {
        return Err(invalid());
    }
    let mut bytes = 0;
    for file in files {
        if file.as_object().is_none_or(|v| v.len() != 2)
            || !file["name"].as_str().is_some_and(|v| {
                !v.trim().is_empty()
                    && v.len() <= 180
                    && [".txt", ".md"]
                        .iter()
                        .any(|ext| v.to_lowercase().ends_with(ext))
                    && !v.chars().any(char::is_control)
            })
        {
            return Err(invalid());
        }
        let text = file["text"].as_str().ok_or_else(invalid)?;
        if text.trim().is_empty() || text.contains('\0') {
            return Err(invalid());
        }
        bytes += text.len();
    }
    // Bounded plain text avoids an extraction service/RAG pipeline for short strategy notes.
    if bytes > 65536 {
        return Err(invalid());
    }
    let config = json!({"name":body["name"].as_str().unwrap().trim(),"description":body["description"].as_str().unwrap().trim(),"instructions":body["instructions"].as_str().unwrap().trim(),"knowledge":files});
    if config.to_string().len() > 100000 {
        return Err(invalid());
    }
    Ok(config)
}
fn mentor() -> Value {
    json!({"id":"mentor","name":"Mentor","description":"","revision":0,"builtin":true,"knowledge_count":0})
}
fn metadata(id: Uuid, revision: i64, config: &Value) -> Value {
    json!({"id":id,"name":config["name"],"description":config["description"],"revision":revision,"builtin":false,"knowledge_count":config["knowledge"].as_array().map_or(0,Vec::len)})
}
pub async fn list(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
) -> Result<Json<Value>, ApiError> {
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let rows = conn.query("SELECT agent_id,revision,config-'knowledge'-'instructions',jsonb_array_length(config->'knowledge') FROM ai_agents WHERE workspace_id=$1 AND subject=$2 ORDER BY created_at,agent_id LIMIT 32", &[&scope.workspace_id,&scope.subject]).await.map_err(|_|ApiError::database())?;
    let mut items = vec![mentor()];
    for row in rows {
        let mut value = metadata(row.get(0), row.get(1), &row.get::<_, Value>(2));
        value["knowledge_count"] = json!(row.get::<_, i32>(3));
        items.push(value);
    }
    Ok(Json(json!({"items":items})))
}
pub async fn read(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    if id == "mentor" {
        let mut value = mentor();
        value["instructions"] = json!(include_str!("ai-assistant-policy.md"));
        value["knowledge"] = json!([]);
        return Ok(Json(value));
    }
    let id = Uuid::parse_str(&id).map_err(|_| missing())?;
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let row=conn.query_opt("SELECT revision,config FROM ai_agents WHERE workspace_id=$1 AND subject=$2 AND agent_id=$3",&[&scope.workspace_id,&scope.subject,&id]).await.map_err(|_|ApiError::database())?.ok_or_else(missing)?;
    let config: Value = row.get(1);
    let mut value = metadata(id, row.get(0), &config);
    value["instructions"] = config["instructions"].clone();
    value["knowledge"] = config["knowledge"].clone();
    Ok(Json(value))
}
pub async fn create(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let config = validate(&body)?;
    if body.get("revision").is_some() {
        return Err(invalid());
    }
    let mut conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = conn.transaction().await.map_err(|_| ApiError::database())?;
    tx.query_one(
        "SELECT pg_advisory_xact_lock($1)",
        &[&crate::ai_runs::ADMISSION],
    )
    .await
    .map_err(|_| ApiError::database())?;
    let count: i64 = tx
        .query_one(
            "SELECT count(*) FROM ai_agents WHERE workspace_id=$1 AND subject=$2",
            &[&scope.workspace_id, &scope.subject],
        )
        .await
        .map_err(|_| ApiError::database())?
        .get(0);
    if count >= 32 {
        return Err(ApiError::detail(StatusCode::CONFLICT, "ai_agents_full"));
    }
    let id = Uuid::new_v4();
    tx.execute(
        "INSERT INTO ai_agents(workspace_id,subject,agent_id,config) VALUES($1,$2,$3,$4)",
        &[&scope.workspace_id, &scope.subject, &id, &config],
    )
    .await
    .map_err(|_| ApiError::database())?;
    tx.commit().await.map_err(|_| ApiError::database())?;
    Ok((StatusCode::CREATED, Json(metadata(id, 1, &config))))
}
pub async fn update(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    if id == "mentor" {
        return Err(ApiError::detail(StatusCode::CONFLICT, "ai_agent_readonly"));
    }
    let id = Uuid::parse_str(&id).map_err(|_| missing())?;
    let config = validate(&body)?;
    let revision = body["revision"]
        .as_i64()
        .filter(|v| *v >= 1)
        .ok_or_else(invalid)?;
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let count=conn.execute("UPDATE ai_agents SET config=$4,revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=$1 AND subject=$2 AND agent_id=$3 AND revision=$5",&[&scope.workspace_id,&scope.subject,&id,&config,&revision]).await.map_err(|_|ApiError::database())?;
    if count == 0 {
        return Err(ApiError::detail(StatusCode::CONFLICT, "ai_agent_changed"));
    }
    Ok(Json(metadata(id, revision + 1, &config)))
}
pub(crate) async fn snapshot(
    tx: &tokio_postgres::Transaction<'_>,
    scope: &Workspace,
    id: Option<Uuid>,
    revision: i64,
) -> Result<Value, ApiError> {
    let Some(id) = id else {
        return Ok(Value::Null);
    };
    let row=tx.query_opt("SELECT revision,config FROM ai_agents WHERE workspace_id=$1 AND subject=$2 AND agent_id=$3 FOR SHARE",&[&scope.workspace_id,&scope.subject,&id]).await.map_err(|_|ApiError::database())?.ok_or_else(missing)?;
    if row.get::<_, i64>(0) != revision {
        return Err(ApiError::detail(StatusCode::CONFLICT, "ai_agent_changed"));
    }
    let mut value: Value = row.get(1);
    value["id"] = json!(id);
    value["revision"] = json!(revision);
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_configuration_and_identity() {
        let valid = json!({"name":"Breakout","description":"Rules","instructions":"Explain entries","knowledge":[{"name":"setup.md","text":"One strategy"}]});
        assert!(validate(&valid).is_ok());
        for bad in [
            json!({"name":"x","description":"","instructions":"","knowledge":[{"name":"bad.pdf","text":"binary"}]}),
            json!({"name":"x","description":"","instructions":"","knowledge":[{"name":"large.txt","text":"a".repeat(65537)}]}),
        ] {
            assert!(validate(&bad).is_err());
        }
        assert!(reference(&json!({"agent":{"id":"mentor","revision":1}})).is_err());
        assert_eq!(reference(&json!({})).unwrap(), (None, 0));
    }
}
