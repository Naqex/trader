//! Native writes and their retry receipts share one PostgreSQL transaction.
use crate::{auth::{ApiError, Workspace}, commands};
use axum::{Json, http::{HeaderMap, HeaderName, HeaderValue, StatusCode}, response::{IntoResponse, Response}};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio_postgres::Transaction;
use uuid::Uuid;

pub struct NativeMutation { id: Uuid }
pub enum MutationStart { Replay(Response), New(NativeMutation) }

pub async fn commit(tx: deadpool_postgres::Transaction<'_>, response: Response) -> Result<Response, ApiError> {
    let id = response.headers().get("x-command-id").and_then(|v|v.to_str().ok()).map(str::to_owned);
    tx.commit().await.map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE,json!({
        "detail":"command_commit_outcome_unknown", "command_id":id,
        "status_url":id.as_ref().map(|id|format!("/api/v2/commands/{id}")), "outcome_known":false
    })))?;
    Ok(response)
}

pub(crate) fn idempotency_lock(scope: &Workspace, key: &str) -> i64 {
    let framed = serde_json::to_vec(&json!([scope.workspace_id, scope.subject, key])).unwrap();
    let hash = Sha256::digest(framed);
    i64::from_be_bytes(hash[..8].try_into().unwrap())
}

pub async fn begin(tx: &Transaction<'_>, scope: &Workspace, method: &str, path: &str,
    query: Option<&str>, headers: &HeaderMap, body: &Value) -> Result<MutationStart, ApiError> {
    let key = commands::idempotency(headers)?;
    let pairs = commands::query_pairs(query);
    let origin = headers.get("origin").and_then(|v|v.to_str().ok()).map(str::to_owned);
    let hash = commands::fingerprint(method,path,&pairs,&Some(body.clone()),&origin);
    tx.execute("INSERT INTO workspaces(workspace_id,created_at_utc) VALUES($1,$2) ON CONFLICT DO NOTHING", &[&scope.workspace_id,&chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros,true)])
        .await.map_err(|_|ApiError::database())?;
    if let Some(key) = &key {
        tx.query_one("SELECT pg_advisory_xact_lock($1)",&[&idempotency_lock(scope,key)])
            .await.map_err(|_|ApiError::database())?;
        let row=tx.query_opt("SELECT command_id,request_hash,status,result_status,result_headers,result_body,result_text FROM api_commands WHERE workspace_id=$1 AND identity_id=$2 AND idempotency_key=$3 AND (expires_at_utc>CURRENT_TIMESTAMP OR status IN ('queued','running'))",&[&scope.workspace_id,&scope.subject,key])
            .await.map_err(|_|ApiError::database())?;
        if let Some(row)=row {
            if row.get::<_,String>("request_hash")!=hash {
                return Err(ApiError::detail(StatusCode::CONFLICT,"command_idempotency_conflict"));
            }
            let id:Uuid=row.get("command_id");
            let status:String=row.get("status");
            let mut response=if matches!(status.as_str(),"completed"|"failed") {
                let code=row.get::<_,Option<i32>>("result_status").and_then(|v|StatusCode::from_u16(v as u16).ok())
                    .filter(|s|s.as_u16()>=200).ok_or_else(||ApiError::detail(StatusCode::SERVICE_UNAVAILABLE,"command_result_untrusted"))?;
                let mut response=if let Some(text)=row.get::<_,Option<String>>("result_text") {
                    (code,text).into_response()
                } else { (code,Json(row.get::<_,Option<Value>>("result_body").unwrap_or(Value::Null))).into_response() };
                for (name,value) in commands::reviewed_headers(row.get("result_headers")) {
                    response.headers_mut().insert(HeaderName::from_bytes(name.as_bytes()).unwrap(),HeaderValue::from_str(value.as_str().unwrap()).unwrap());
                }
                response
            } else {
                let mut response=(StatusCode::GATEWAY_TIMEOUT,Json(json!({"detail":"command_pending","command_id":id,"status_url":format!("/api/v2/commands/{id}"),"outcome_known":false}))).into_response();
                response.headers_mut().insert("retry-after",HeaderValue::from_static("1")); response
            };
            response.headers_mut().insert("x-command-id",HeaderValue::from_str(&id.to_string()).unwrap());
            return Ok(MutationStart::Replay(response));
        }
        tx.execute("DELETE FROM api_commands WHERE workspace_id=$1 AND identity_id=$2 AND idempotency_key=$3 AND expires_at_utc<=CURRENT_TIMESTAMP AND status IN ('completed','failed')",&[&scope.workspace_id,&scope.subject,key]).await.map_err(|_|ApiError::database())?;
    }
    let id=Uuid::new_v4();
    tx.execute("INSERT INTO api_commands(command_id,contract_version,workspace_id,identity_id,method,path,query,body,origin,request_hash,idempotency_key,max_attempts,deadline_at_utc,expires_at_utc) VALUES($1,'api-command-v1',$2,$3,$4,$5,$6,$7,$8,$9,$10,1,CURRENT_TIMESTAMP+interval '30 seconds',CURRENT_TIMESTAMP+interval '24 hours')",&[&id,&scope.workspace_id,&scope.subject,&method,&path,&pairs,body,&origin,&hash,&key]).await.map_err(|_|ApiError::database())?;
    Ok(MutationStart::New(NativeMutation{id}))
}

pub async fn finish(tx:&Transaction<'_>, mutation:NativeMutation,status:StatusCode,body:Value)->Result<Response,ApiError> {
    let state=if status.is_success(){"completed"}else{"failed"};
    let code=i32::from(status.as_u16());
    let count=tx.execute("UPDATE api_commands SET status=$2,result_status=$3,result_headers=$4,result_body=$5,updated_at_utc=CURRENT_TIMESTAMP WHERE command_id=$1 AND status='queued'",&[&mutation.id,&state,&code,&json!({"content-type":"application/json"}),&body]).await.map_err(|_|ApiError::database())?;
    if count!=1 {return Err(ApiError::detail(StatusCode::SERVICE_UNAVAILABLE,"native_receipt_conflict"));}
    let mut response=(status,Json(body)).into_response();
    response.headers_mut().insert("x-command-id",HeaderValue::from_str(&mutation.id.to_string()).unwrap());
    Ok(response)
}

/// Replay snapshots are opaque HTTP results, not SQL-queryable job metadata.
/// Persist their wire JSON once instead of parsing a multi-MB snapshot into a
/// second JSONB tree and serializing it again for the initial response/retry.
pub async fn finish_json_text(tx:&Transaction<'_>, mutation:NativeMutation,status:StatusCode,body:Value)->Result<Response,ApiError> {
    let text=serde_json::to_string(&body).map_err(|_|ApiError::detail(StatusCode::SERVICE_UNAVAILABLE,"native_response_serialization_failed"))?;
    drop(body);
    let state=if status.is_success(){"completed"}else{"failed"};
    let code=i32::from(status.as_u16());
    let headers=json!({"content-type":"application/json"});
    let count=tx.execute("UPDATE api_commands SET status=$2,result_status=$3,result_headers=$4,result_text=$5,result_body=NULL,updated_at_utc=CURRENT_TIMESTAMP WHERE command_id=$1 AND status='queued'",&[&mutation.id,&state,&code,&headers,&text]).await.map_err(|_|ApiError::database())?;
    if count!=1 {return Err(ApiError::detail(StatusCode::SERVICE_UNAVAILABLE,"native_receipt_conflict"));}
    let mut response=(status,text).into_response();
    response.headers_mut().insert("content-type",HeaderValue::from_static("application/json"));
    response.headers_mut().insert("x-command-id",HeaderValue::from_str(&mutation.id.to_string()).unwrap());
    Ok(response)
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn keys_are_framed_and_scoped(){
        let a=Workspace{workspace_id:"a".into(),subject:"owner".into()};
        let b=Workspace{workspace_id:"b".into(),subject:"owner".into()};
        assert_eq!(idempotency_lock(&a,"key"),idempotency_lock(&a,"key"));
        assert_ne!(idempotency_lock(&a,"key"),idempotency_lock(&b,"key"));
        assert_ne!(idempotency_lock(&a,"key"),idempotency_lock(&a,"other"));
    }
}
