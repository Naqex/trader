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

fn valid(feature: &str, role: &str) -> bool {
    matches!(
        (feature, role),
        ("system" | "chat" | "journal-summary", "default")
            | ("evidence-review", "default" | "analyst" | "facts" | "gaps" | "reviewer")
    )
}
pub(crate) async fn resolve(
    pool: &deadpool_postgres::Pool,
    scope: &Workspace,
    feature: &str,
    role: &str,
) -> Result<Option<Value>, ApiError> {
    let conn = pool.get().await.map_err(|_| ApiError::database())?;
    let row=conn.query_opt("SELECT selection,feature,role,revision FROM ai_profiles WHERE workspace_id=$1 AND subject=$2 AND ((feature=$3 AND role=$4) OR (feature=$3 AND role='analyst' AND $4 IN ('facts','gaps')) OR (feature=$3 AND role='default') OR (feature='system' AND role='default')) ORDER BY CASE WHEN feature=$3 AND role=$4 THEN 0 WHEN feature=$3 AND role='analyst' THEN 1 WHEN feature=$3 THEN 2 ELSE 3 END LIMIT 1",&[&scope.workspace_id,&scope.subject,&feature,&role]).await.map_err(|_|ApiError::database())?;
    Ok(row.map(|r|json!({"selection":r.get::<_,Value>(0),"feature":r.get::<_,String>(1),"role":r.get::<_,String>(2),"revision":r.get::<_,i64>(3)})))
}
pub async fn list(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
) -> Result<Json<Value>, ApiError> {
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let rows=conn.query("SELECT feature,role,selection,revision FROM ai_profiles WHERE workspace_id=$1 AND subject=$2 ORDER BY feature,role",&[&scope.workspace_id,&scope.subject]).await.map_err(|_|ApiError::database())?;
    let items=rows.iter().map(|r|json!({"feature":r.get::<_,String>(0),"role":r.get::<_,String>(1),"selection":r.get::<_,Value>(2),"revision":r.get::<_,i64>(3)})).collect::<Vec<_>>();
    drop(conn);
    Ok(Json(
        json!({"items":items,"chat_default":resolve(&state.pool,&scope,"chat","default").await?}),
    ))
}
pub async fn save(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Path((feature, role)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    if !valid(&feature, &role)
        || body
            .as_object()
            .is_none_or(|v| v.len() != 2 || !v.contains_key("selection"))
        || !body["revision"].as_i64().is_some_and(|v| v >= 0)
    {
        return Err(ApiError::detail(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_ai_profile",
        ));
    }
    let revision = body["revision"].as_i64().unwrap();
    if !body["selection"].is_null() {
        state
            .ai_assistant
            .validate_selection(&body["selection"])
            .await?;
    }
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let changed=if body["selection"].is_null() {
        conn.execute("DELETE FROM ai_profiles WHERE workspace_id=$1 AND subject=$2 AND feature=$3 AND role=$4 AND revision=$5",&[&scope.workspace_id,&scope.subject,&feature,&role,&revision]).await
    }else if revision==0 {
        conn.execute("INSERT INTO ai_profiles(workspace_id,subject,feature,role,selection) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",&[&scope.workspace_id,&scope.subject,&feature,&role,&body["selection"]]).await
    }else{
        conn.execute("UPDATE ai_profiles SET selection=$5,revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=$1 AND subject=$2 AND feature=$3 AND role=$4 AND revision=$6",&[&scope.workspace_id,&scope.subject,&feature,&role,&body["selection"],&revision]).await
    }.map_err(|_|ApiError::database())?;
    if changed == 0 {
        return Err(ApiError::detail(StatusCode::CONFLICT, "ai_profile_changed"));
    }
    Ok(Json(json!({"revision":revision+1})))
}
