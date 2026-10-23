//! Explicit, read-only evidence snapshots. Request identity contains references,
//! while admitted runs pin the server-built data and its checksum.
use crate::{
    auth::{ApiError, Workspace},
    state::AppState,
};
use axum::{Json, extract::State, http::StatusCode};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::Arc;

fn invalid() -> ApiError {
    ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, "invalid_ai_source")
}
pub(crate) fn validate(source: &Value) -> Result<(), ApiError> {
    if source.as_object().is_none_or(|v| v.len() != 2)
        || !source["kind"]
            .as_str()
            .is_some_and(|v| ["replay", "journal", "research"].contains(&v))
        || !source["id"].as_str().is_some_and(|v| {
            !v.is_empty()
                && v.len() <= 128
                && v.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        })
    {
        return Err(invalid());
    }
    Ok(())
}
pub(crate) async fn sources(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
) -> Result<Json<Value>, ApiError> {
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let rows=conn.query("SELECT r.record_id,v.payload_json->>'name',r.current_revision FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id=$1 AND r.kind='replay' AND NOT v.deleted ORDER BY r.updated_at_utc DESC,r.record_id LIMIT 50",&[&scope.workspace_id]).await.map_err(|_|ApiError::database())?;
    let mut items = Vec::new();
    for r in rows {
        let id: String = r.get(0);
        let name: Option<String> = r.get(1);
        for kind in ["replay", "journal"] {
            items.push(json!({"kind":kind,"id":id,"name":name.as_deref().filter(|n|!n.is_empty()).unwrap_or(&id),"revision":r.get::<_,i32>(2)}));
        }
    }
    let jobs=conn.query("SELECT job_id,dataset_id FROM research_jobs WHERE workspace_id=$1 AND status='completed' ORDER BY job_id DESC LIMIT 50",&[&scope.workspace_id]).await.map_err(|_|ApiError::database())?;
    for r in jobs {
        items
            .push(json!({"kind":"research","id":r.get::<_,String>(0),"name":r.get::<_,String>(1)}));
    }
    Ok(Json(json!({"items":items})))
}
pub(crate) async fn snapshot(
    state: &AppState,
    scope: &Workspace,
    source: &Value,
) -> Result<Value, ApiError> {
    validate(source)?;
    let mut conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = conn
        .build_transaction()
        .isolation_level(tokio_postgres::IsolationLevel::RepeatableRead)
        .read_only(true)
        .start()
        .await
        .map_err(|_| ApiError::database())?;
    let id = source["id"].as_str().unwrap();
    let mut data = if source["kind"] == "research" {
        let row = tx
            .query_opt(crate::jobs::JOB_QUERY, &[&scope.workspace_id, &id])
            .await
            .map_err(|_| ApiError::database())?
            .ok_or_else(invalid)?;
        if row.get::<_, String>("status") != "completed" {
            return Err(invalid());
        }
        let path: Option<String> = row.get("result_path");
        let hash: Option<String> = row.get("result_sha256");
        let (path, hash) = (path.ok_or_else(invalid)?, hash.ok_or_else(invalid)?);
        let identity = crate::jobs::StoredResultIdentity::from_row(&row);
        let root = state.config.artifact_root.clone();
        let permit = state
            .artifact_reads
            .clone()
            .try_acquire_owned()
            .map_err(|_| {
                ApiError::detail(
                    StatusCode::TOO_MANY_REQUESTS,
                    "artifact_read_capacity_exceeded",
                )
            })?;
        tokio::task::spawn_blocking(move || {
            let _permit=permit;
            let result=crate::jobs::read_job_result(root,&path,&hash,&identity)?;
            // Consume only completed, validated research outputs; never open a new dataset or holdout.
            Ok::<_,ApiError>(json!({"kind":"research","id":result["job_id"],"result_sha256":hash,"dataset_id":result["dataset_id"],"dataset_sha256":result["dataset_sha256"],"strategy_version":result["strategy_version"],"engine_version":result["engine_version"],"split":result["split"],"observed_range":result["observed_range"],"metrics":result["metrics"],"outcome_summary":result["outcome_summary"]}))
        }).await.map_err(|_|invalid())??
    } else {
        let mut chart =
            crate::replay_service::ai_snapshot(&tx, state, &scope.workspace_id, id).await?;
        if source["kind"] == "journal" {
            let rows=tx.query("SELECT r.record_id,r.current_revision,v.payload_json FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id=$1 AND r.kind='journal' AND NOT v.deleted AND (v.payload_json->'source'->>'session_id'=$2 OR v.payload_json->'source'->>'replay_session_id'=$2) ORDER BY r.updated_at_utc DESC,r.record_id LIMIT 100",&[&scope.workspace_id,&id]).await.map_err(|_|ApiError::database())?;
            let mut remaining = 24576;
            let entries:Vec<Value>=rows.iter().filter_map(|r|{
                let p:Value=r.get(2);let s=&p["source"];
                // Unanchored notes can describe future outcomes. Exclude unknown cutoffs.
                let cursor=s["cursor_index"].as_i64()?;
                if cursor<0 || cursor>chart["cursor_index"].as_i64()? || s["dataset_id"]!=chart["dataset_id"] {return None;}
                let mut note=json!({"id":r.get::<_,String>(0),"revision":r.get::<_,i32>(1),"cursor_index":cursor});
                let mut truncated=Vec::new();
                for key in ["title","note","notes","observation","hypothesis","decision","plan","tags"] {
                    if let Some(text)=p[key].as_str() {
                        let mut end=text.len().min(2048);while !text.is_char_boundary(end){end-=1;}
                        note[key]=json!(&text[..end]);if end<text.len(){truncated.push(key);}
                    }else if !p[key].is_null() && p[key].to_string().len()<=2048 {note[key]=p[key].clone();}
                }
                if !truncated.is_empty(){note["truncated_fields"]=json!(truncated);}
                let bytes=note.to_string().len();if bytes>remaining{return None;}remaining-=bytes;
                Some(note)
            }).take(20).collect();
            chart["kind"] = json!("journal");
            chart["entries"] = json!(entries);
        }
        chart
    };
    data["workspace_id"] = json!(scope.workspace_id);
    if serde_json::to_vec(&data).map_err(|_| invalid())?.len() > 65536 {
        return Err(ApiError::detail(
            StatusCode::UNPROCESSABLE_ENTITY,
            "ai_source_too_large",
        ));
    }
    let hash = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&data).map_err(|_| invalid())?)
    );
    let provenance = json!({"kind":data["kind"],"id":data["id"],"revision":data["revision"],"cursor_index":data["cursor_index"],"cutoff_timestamp":data["cutoff_timestamp"],"sha256":hash,"read_only":true});
    tx.commit().await.map_err(|_| ApiError::database())?;
    Ok(json!({"provenance":provenance,"data":data}))
}
