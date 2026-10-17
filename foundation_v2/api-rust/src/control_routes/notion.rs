//! Local PREP_ONLY ledger; no OAuth or provider network calls occur here.
use super::*;
use axum::{
    extract::{MatchedPath, OriginalUri},
    http::{HeaderMap, Method},
    response::Response,
};
use chrono::{SecondsFormat, Utc};
use std::collections::HashMap;
use tokio_postgres::{Row, Transaction, types::Type};

const CONNECTIONS: &str = "/api/v2/connectors/notion/connections";
const CONNECTION: &str = "/api/v2/connectors/notion/connections/{connection_id}";
const INTENTS: &str = "/api/v2/connectors/notion/intents";
const INTENT: &str = "/api/v2/connectors/notion/intents/{intent_id}";
const RECEIPT: &str = "/api/v2/connectors/notion/intents/{intent_id}/receipt";

pub fn native(method: &str, path: &str) -> bool {
    match method {
        "GET" => [CONNECTIONS, CONNECTION, INTENTS, INTENT, RECEIPT].contains(&path),
        "POST" => [CONNECTIONS, INTENTS].contains(&path),
        "PATCH" => [CONNECTION, RECEIPT].contains(&path),
        _ => false,
    }
}
pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(CONNECTIONS, get(read_route).post(write_route))
        .route(CONNECTION, get(read_route).patch(write_route))
        .route(INTENTS, get(read_route).post(write_route))
        .route(INTENT, get(read_route))
        .route(RECEIPT, get(read_route).patch(write_route))
}
fn conflict(s: &str) -> ApiError {
    ApiError::detail(StatusCode::CONFLICT, s)
}
fn bounded(v: &Value, field: &str, max: usize) -> Result<String, ApiError> {
    let s = v
        .as_str()
        .filter(|s| !s.is_empty() && s.chars().count() <= max && !s.chars().any(|c| c < ' '))
        .ok_or_else(|| invalid(&format!("{field} must be a bounded non-empty string")))?;
    Ok(s.into())
}
fn opaque(v: &Value, field: &str) -> Result<String, ApiError> {
    let s = bounded(v, field, 128)?;
    if !s.as_bytes()[0].is_ascii_alphanumeric()
        || !s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
    {
        return Err(invalid(&format!("{field} must be an opaque identifier")));
    }
    Ok(s)
}
fn optional(v: &Value, field: &str) -> Result<Option<String>, ApiError> {
    if v.is_null() {
        Ok(None)
    } else {
        opaque(v, field).map(Some)
    }
}
fn sensitive(value: &Value, path: &str) -> Result<(), ApiError> {
    match value {
        Value::Object(m) => {
            for (k, v) in m {
                let key = k.trim().to_lowercase().replace('-', "_");
                let child = format!("{path}.{key}");
                if [
                    "token",
                    "secret",
                    "password",
                    "credential",
                    "api_key",
                    "private_key",
                    "authorization",
                    "refresh",
                    "broker",
                    "account_id",
                    "account_ref",
                    "account_number",
                    "holdout",
                ]
                .iter()
                .any(|marker| key.contains(marker))
                {
                    return Err(invalid(&format!("sensitive field is not allowed: {child}")));
                }
                sensitive(v, &child)?;
            }
        }
        Value::Array(a) => {
            for (i, v) in a.iter().enumerate() {
                sensitive(v, &format!("{path}[{i}]"))?;
            }
        }
        Value::Number(n) if n.to_string().contains(['.', 'e', 'E']) && n.as_f64().is_none() => {
            return Err(invalid("connector payload must be JSON serializable"));
        }
        _ => {}
    }
    Ok(())
}
fn object(v: &Value, field: &str) -> Result<Value, ApiError> {
    if !v.is_object() {
        return Err(invalid(&format!("{field} must be an object")));
    }
    sensitive(v, field)?;
    Ok(v.clone())
}
pub fn fingerprint(v: &Value) -> String {
    let mut unicode = String::new();
    super::canonical_json(v, &mut unicode, false);
    format!("sha256:{:x}", Sha256::digest(unicode.as_bytes()))
}

pub fn connection_request(scope: &str, body: &Value) -> Result<Value, ApiError> {
    let workspace = opaque(&json!(scope), "workspace_id")?;
    let connection = opaque(&body["connection_id"], "connection_id")?;
    let request = opaque(&body["request_id"], "request_id")?;
    let key = opaque(&body["idempotency_key"], "idempotency_key")?;
    let account = optional(&body["account_ref"], "account_ref")?;
    let raw = body["scopes"]
        .as_array()
        .filter(|a| !a.is_empty())
        .ok_or_else(|| invalid("scopes must be a non-empty list"))?;
    let mut scopes = vec![];
    for value in raw {
        let s = bounded(value, "scope", 64)?;
        if !["read", "write", "read_write"].contains(&s.as_str()) {
            return Err(invalid("unsupported connector scope"));
        }
        if !scopes.contains(&s) {
            scopes.push(s);
        }
    }
    let metadata = object(&body["metadata"], "metadata")?;
    let hash = fingerprint(
        &json!({"connector":"notion","connection_id":connection,"request_id":request,"account_ref":account,"scopes":scopes,"metadata":metadata}),
    );
    Ok(
        json!({"workspace_id":workspace,"connector":"notion","connection_id":connection,"request_id":request,"idempotency_key":key,"account_ref":account,"scopes":scopes,"metadata":metadata,"fingerprint":hash}),
    )
}

pub fn intent_request(scope: &str, body: &Value) -> Result<Value, ApiError> {
    let workspace = opaque(&json!(scope), "workspace_id")?;
    let id = opaque(&body["intent_id"], "intent_id")?;
    let request = opaque(&body["request_id"], "request_id")?;
    let key = opaque(&body["idempotency_key"], "idempotency_key")?;
    let connection = optional(&body["connection_id"], "connection_id")?;
    let intent = object(&body["intent"], "intent")?;
    if intent["schema_version"] != "mt5-notion-export-intent-v1" {
        return Err(invalid("intent schema is invalid"));
    }
    if intent["status"] != "PREP_ONLY" || intent["cloud_io"] != false {
        return Err(invalid("intent must remain PREP_ONLY with cloud_io=false"));
    }
    if intent["provider"] != "notion" {
        return Err(invalid("intent provider must be notion"));
    }
    let destination = intent["destination"]
        .as_object()
        .ok_or_else(|| invalid("intent destination is invalid"))?;
    let selected = destination
        .get("user_selected")
        .and_then(Value::as_bool)
        .ok_or_else(|| invalid("intent destination selection is invalid"))?;
    let dest = match destination.get("ref").filter(|v| !v.is_null()) {
        None => None,
        Some(v) => {
            let s = bounded(v, "destination_ref", 256)?;
            let tail = s
                .strip_prefix("user-selected:")
                .filter(|s| {
                    !s.is_empty()
                        && s.as_bytes()[0].is_ascii_alphanumeric()
                        && s.bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
                })
                .ok_or_else(|| {
                    invalid("destination_ref must be a bounded user-selected reference")
                })?;
            let _ = tail;
            Some(s)
        }
    };
    if selected != dest.is_some() {
        return Err(invalid("intent destination selection does not match ref"));
    }
    let source = intent["source"]
        .as_object()
        .ok_or_else(|| invalid("intent source is invalid"))?;
    let mut revisions = serde_json::Map::new();
    for (key, field) in [
        ("session", "session_revision"),
        ("attempt", "attempt_revision"),
    ] {
        let v = source.get(field).unwrap_or(&Value::Null);
        if v.is_boolean()
            || !(v.as_u64().is_some()
                || v.as_i64().is_some_and(|v| v >= 0)
                || v.as_number()
                    .is_some_and(|n| !n.to_string().contains(['.', 'e', 'E', '-'])))
        {
            return Err(invalid(&format!(
                "source_revision.{key} must be a non-negative integer"
            )));
        }
        revisions.insert(key.into(), v.clone());
    }
    let payload = intent["payload"]
        .as_object()
        .ok_or_else(|| invalid("intent payload is invalid"))?;
    let content = bounded(
        payload.get("content_sha256").unwrap_or(&Value::Null),
        "content_sha256",
        71,
    )?;
    if !content.strip_prefix("sha256:").is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    }) {
        return Err(invalid("content_sha256 must be a sha256 digest"));
    }
    if intent["intent_fingerprint"]
        != fingerprint(
            &json!({"provider":"notion","source":source,"destination":destination,"payload":payload,"write_policy":intent["write_policy"]}),
        )
    {
        return Err(invalid("intent fingerprint does not match payload"));
    }
    let hash = fingerprint(
        &json!({"intent_id":id,"request_id":request,"connection_id":connection,"intent":intent}),
    );
    Ok(
        json!({"workspace_id":workspace,"connector":"notion","intent_id":id,"request_id":request,"idempotency_key":key,"connection_id":connection,"intent":intent,"source_revision":revisions,"content_sha256":content,"destination_ref":dest,"fingerprint":hash}),
    )
}

fn row_json(row: &Row) -> Value {
    let mut out = serde_json::Map::new();
    for (i, column) in row.columns().iter().enumerate() {
        let value = match *column.type_() {
            Type::INT4 => row
                .get::<_, Option<i32>>(i)
                .map(|v| json!(v))
                .unwrap_or(Value::Null),
            Type::JSONB => row.get::<_, Option<Value>>(i).unwrap_or(Value::Null),
            _ => row
                .get::<_, Option<String>>(i)
                .map(Value::String)
                .unwrap_or(Value::Null),
        };
        out.insert(column.name().into(), value);
    }
    Value::Object(out)
}

async fn read_route(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    matched: MatchedPath,
    path: Option<Path<HashMap<String, String>>>,
) -> Result<Json<Value>, ApiError> {
    let (table, key, id, not_found) = match matched.as_str() {
        CONNECTIONS => (
            "connector_connections",
            "connection_id",
            None,
            "connector_connection_not_found",
        ),
        CONNECTION => (
            "connector_connections",
            "connection_id",
            path.as_ref().and_then(|p| p.get("connection_id")),
            "connector_connection_not_found",
        ),
        INTENTS => (
            "connector_intents",
            "intent_id",
            None,
            "connector_intent_not_found",
        ),
        INTENT => (
            "connector_intents",
            "intent_id",
            path.as_ref().and_then(|p| p.get("intent_id")),
            "connector_intent_not_found",
        ),
        _ => (
            "connector_receipts",
            "intent_id",
            path.as_ref().and_then(|p| p.get("intent_id")),
            "connector_receipt_not_found",
        ),
    };
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    if let Some(id) = id {
        let row=conn.query_opt(&format!("SELECT * FROM {table} WHERE workspace_id=$1 AND connector='notion' AND {key}=$2"),&[&scope.workspace_id,id]).await.map_err(|_|ApiError::database())?.ok_or_else(||ApiError::detail(StatusCode::NOT_FOUND,not_found))?;
        Ok(Json(row_json(&row)))
    } else {
        let rows=conn.query(&format!("SELECT * FROM {table} WHERE workspace_id=$1 AND connector='notion' ORDER BY updated_at_utc DESC,{key}"),&[&scope.workspace_id]).await.map_err(|_|ApiError::database())?;
        Ok(Json(
            json!({"items":rows.iter().map(row_json).collect::<Vec<_>>(),"mode":"PREP_ONLY","cloud_io":false}),
        ))
    }
}

async fn write_route(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    matched: MatchedPath,
    OriginalUri(uri): OriginalUri,
    method: Method,
    headers: HeaderMap,
    path: Option<Path<HashMap<String, String>>>,
    Json(body): Json<Value>,
) -> Result<Response, ApiError> {
    let mut conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = conn.transaction().await.map_err(|_| ApiError::database())?;
    let mutation = match crate::native_mutation::begin(
        &tx,
        &scope,
        method.as_str(),
        uri.path(),
        uri.query(),
        &headers,
        &body,
    )
    .await?
    {
        crate::native_mutation::MutationStart::Replay(response) => return Ok(response),
        crate::native_mutation::MutationStart::New(m) => m,
    };
    tx.batch_execute("SAVEPOINT notion_domain")
        .await
        .map_err(|_| ApiError::database())?;
    let id = path
        .as_ref()
        .and_then(|p| p.get("connection_id").or_else(|| p.get("intent_id")))
        .map(String::as_str);
    let (status, value) = match execute(&tx, &scope, matched.as_str(), id, body).await {
        Ok(v) => v,
        Err(e) => {
            tx.batch_execute("ROLLBACK TO SAVEPOINT notion_domain")
                .await
                .map_err(|_| ApiError::database())?;
            (e.0, e.1)
        }
    };
    let response = crate::native_mutation::finish(&tx, mutation, status, value).await?;
    crate::native_mutation::commit(tx, response).await
}

fn opt_text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v[key].as_str()
}
fn status(v: &Value) -> Result<&str, ApiError> {
    let s = v.as_str().unwrap_or("");
    if [
        "pending",
        "unknown",
        "succeeded",
        "failed",
        "revoked",
        "cancelled",
    ]
    .contains(&s)
    {
        Ok(s)
    } else {
        Err(invalid(
            "receipt status is not a supported connector status",
        ))
    }
}
fn error_code(body: &Value) -> Result<Option<&str>, ApiError> {
    let code = opt_text(body, "error_code");
    if code.is_some_and(|s| s.is_empty() || s.chars().count() > 128) {
        Err(invalid("error_code must be a bounded non-empty string"))
    } else {
        Ok(code)
    }
}
async fn execute(
    tx: &Transaction<'_>,
    scope: &Workspace,
    path: &str,
    id: Option<&str>,
    body: Value,
) -> Result<(StatusCode, Value), ApiError> {
    let handler = match path {
        CONNECTIONS => "create_notion_connection",
        CONNECTION => "update_notion_connection",
        INTENTS => "create_notion_intent",
        _ => "update_notion_receipt",
    };
    let body = crate::native_contracts::validate_body(handler, body)?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true);
    let workspace = &scope.workspace_id;
    if path == CONNECTIONS {
        let r = connection_request(workspace, &body)?;
        let connection = r["connection_id"].as_str().unwrap();
        let request = r["request_id"].as_str().unwrap();
        let key = r["idempotency_key"].as_str().unwrap();
        let hash = r["fingerprint"].as_str().unwrap();
        let account = opt_text(&r, "account_ref");
        tx.execute("INSERT INTO workspaces(workspace_id,created_at_utc) VALUES($1,$2) ON CONFLICT DO NOTHING",&[workspace,&now]).await.map_err(|_|ApiError::database())?;
        let inserted=tx.execute("INSERT INTO connector_connections(workspace_id,connector,connection_id,request_id,idempotency_key,fingerprint,account_ref,scopes_json,metadata_json,status,revision,created_at_utc,updated_at_utc) VALUES($1,'notion',$2,$3,$4,$5,$6,$7,$8,'pending',1,$9,$9) ON CONFLICT DO NOTHING",&[workspace,&connection,&request,&key,&hash,&account,&r["scopes"],&r["metadata"],&now]).await.map_err(|_|ApiError::database())?;
        let row=tx.query_opt("SELECT * FROM connector_connections WHERE workspace_id=$1 AND connector='notion' AND (connection_id=$2 OR idempotency_key=$3) ORDER BY connection_id LIMIT 1",&[workspace,&connection,&key]).await.map_err(|_|ApiError::database())?.ok_or_else(||invalid("connector connection was not persisted"))?;
        if row.get::<_, String>("fingerprint") != hash {
            return Err(conflict("connector_idempotency_conflict"));
        }
        return Ok((
            StatusCode::CREATED,
            json!({"duplicate":inserted!=1,"connection":row_json(&row)}),
        ));
    }
    if path == INTENTS {
        let r = intent_request(workspace, &body)?;
        let id = r["intent_id"].as_str().unwrap();
        let request = r["request_id"].as_str().unwrap();
        let key = r["idempotency_key"].as_str().unwrap();
        let hash = r["fingerprint"].as_str().unwrap();
        let connection = opt_text(&r, "connection_id");
        let content = r["content_sha256"].as_str().unwrap();
        let destination = opt_text(&r, "destination_ref");
        tx.execute("INSERT INTO workspaces(workspace_id,created_at_utc) VALUES($1,$2) ON CONFLICT DO NOTHING",&[workspace,&now]).await.map_err(|_|ApiError::database())?;
        if let Some(connection) = connection {
            let row=tx.query_opt("SELECT status FROM connector_connections WHERE workspace_id=$1 AND connector='notion' AND connection_id=$2",&[workspace,&connection]).await.map_err(|_|ApiError::database())?.ok_or_else(||invalid("connector connection does not exist"))?;
            if ["revoked", "cancelled"].contains(&row.get::<_, String>(0).as_str()) {
                return Err(invalid("connector connection is not usable"));
            }
        }
        let inserted=tx.execute("INSERT INTO connector_intents(workspace_id,connector,intent_id,request_id,idempotency_key,fingerprint,connection_id,source_revision_json,source_content_sha256,destination_ref,intent_json,status,mode,created_at_utc,updated_at_utc) VALUES($1,'notion',$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending','PREP_ONLY',$11,$11) ON CONFLICT DO NOTHING",&[workspace,&id,&request,&key,&hash,&connection,&r["source_revision"],&content,&destination,&r["intent"],&now]).await.map_err(|_|ApiError::database())?;
        let row=tx.query_opt("SELECT * FROM connector_intents WHERE workspace_id=$1 AND connector='notion' AND (intent_id=$2 OR idempotency_key=$3) ORDER BY intent_id LIMIT 1",&[workspace,&id,&key]).await.map_err(|_|ApiError::database())?.ok_or_else(||invalid("connector intent was not persisted"))?;
        if row.get::<_, String>("fingerprint") != hash {
            return Err(conflict("connector_idempotency_conflict"));
        }
        let saved_id: String = row.get("intent_id");
        let receipt_id = format!("receipt:{id}");
        tx.execute("INSERT INTO connector_receipts(workspace_id,connector,receipt_id,intent_id,status,revision,source_revision_json,source_content_sha256,created_at_utc,updated_at_utc) VALUES($1,'notion',$2,$3,'pending',1,$4,$5,$6,$6) ON CONFLICT DO NOTHING",&[workspace,&receipt_id,&saved_id,&r["source_revision"],&content,&now]).await.map_err(|_|ApiError::database())?;
        let receipt=tx.query_one("SELECT * FROM connector_receipts WHERE workspace_id=$1 AND connector='notion' AND intent_id=$2",&[workspace,&saved_id]).await.map_err(|_|ApiError::database())?;
        return Ok((
            StatusCode::CREATED,
            json!({"duplicate":inserted!=1,"intent":row_json(&row),"receipt":row_json(&receipt)}),
        ));
    }
    let status = status(&body["status"])?;
    let revision = body["expected_revision"]
        .as_i64()
        .ok_or_else(|| invalid("expected_revision must be a positive integer"))?;
    let error = error_code(&body)?;
    let id = id.ok_or_else(|| invalid("connector identifier is required"))?;
    let (table, key, noun, conflict_code) = if path == CONNECTION {
        (
            "connector_connections",
            "connection_id",
            "connection",
            "connector_connection_conflict",
        )
    } else {
        (
            "connector_receipts",
            "intent_id",
            "receipt",
            "connector_receipt_conflict",
        )
    };
    if path == RECEIPT {
        for (field, max, msg) in [
            (
                "external_id",
                256,
                "external_id must be a bounded opaque reference",
            ),
            (
                "remote_revision",
                128,
                "remote_revision must be a bounded reference",
            ),
        ] {
            if let Some(s) = body.get(field).filter(|v| !v.is_null()) {
                if bounded(s, field, max).is_err() {
                    return Err(invalid(msg));
                }
            }
        }
        if status == "succeeded" && opt_text(&body, "external_id").is_none() {
            return Err(invalid("succeeded receipts require external_id"));
        }
        object(&body["response"], "response")?;
    }
    let current=tx.query_opt(&format!("SELECT * FROM {table} WHERE workspace_id=$1 AND connector='notion' AND {key}=$2 FOR UPDATE"),&[workspace,&id]).await.map_err(|_|ApiError::database())?.ok_or_else(||invalid(&format!("connector {noun} does not exist")))?;
    if i64::from(current.get::<_, i32>("revision")) != revision {
        return Err(conflict(conflict_code));
    }
    let old = current.get::<_, String>("status");
    if ["succeeded", "revoked", "cancelled"].contains(&old.as_str()) && old != status {
        return Err(conflict(conflict_code));
    }
    let updated=if path==CONNECTION{tx.query_one("UPDATE connector_connections SET status=$1,error_code=$2,revision=revision+1,updated_at_utc=$3 WHERE workspace_id=$4 AND connector='notion' AND connection_id=$5 RETURNING *",&[&status,&error,&now,workspace,&id]).await}else{let external=opt_text(&body,"external_id");let remote=opt_text(&body,"remote_revision");tx.query_one("UPDATE connector_receipts SET status=$1,external_id=$2,remote_revision=$3,response_json=$4,error_code=$5,revision=revision+1,updated_at_utc=$6 WHERE workspace_id=$7 AND connector='notion' AND intent_id=$8 RETURNING *",&[&status,&external,&remote,&body["response"],&error,&now,workspace,&id]).await}.map_err(|_|ApiError::database())?;
    if path == RECEIPT {
        tx.execute("UPDATE connector_intents SET status=$1,updated_at_utc=$2 WHERE workspace_id=$3 AND connector='notion' AND intent_id=$4",&[&status,&now,workspace,&id]).await.map_err(|_|ApiError::database())?;
    }
    let mut result = json!({"duplicate":false});
    result[noun] = row_json(&updated);
    Ok((StatusCode::OK, result))
}
