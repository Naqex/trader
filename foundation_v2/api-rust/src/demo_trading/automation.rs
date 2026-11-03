//! Restricted endpoints; all sends reuse the native receipt and managed adapter.
use super::*;
use crate::auth::{Actor, AutomationIdentity};
use axum::{Extension, extract::Path as AxumPath};

pub(super) struct Submission {
    pub identity: Arc<AutomationIdentity>,
    pub artifact_sha256: String,
}
impl Submission {
    pub fn fingerprint_context(&self) -> Value {
        json!({"grant_id":self.identity.grant_id,"credential_id":self.identity.credential_id,
            "artifact_sha256":self.artifact_sha256})
    }
}

pub(super) fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v2/automation/grants", post(create_grant))
        .route(
            "/api/v2/automation/grants/{grant_id}/revoke",
            post(revoke_grant),
        )
        .route("/api/v2/automation/trading/commands", post(command))
        .route("/api/v2/automation/trading/reconcile", post(reconcile))
        .route(
            "/api/v2/automation/trading/requests/{request_id}",
            get(receipt),
        )
}

fn enabled(state: &AppState) -> Result<(), ApiError> {
    if !state.native_runtime || !state.authorization.is_capability_mode() {
        return Err(denied("automation_capability_mode_required"));
    }
    Ok(())
}

fn parse<T: serde::de::DeserializeOwned>(headers: &HeaderMap, bytes: &[u8]) -> Result<T, ApiError> {
    if bytes.len() > 16384
        || !headers.get("content-type").is_some_and(|value| {
            value
                .to_str()
                .is_ok_and(|s| s.split(';').next() == Some("application/json"))
        })
    {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "automation_request_invalid",
        ));
    }
    serde_json::from_slice(bytes).map_err(|_| {
        error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "automation_request_invalid",
        )
    })
}

async fn create_grant(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Extension(actor): Extension<Actor>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<Value>, ApiError> {
    enabled(&state)?;
    actor.require_owner()?;
    let policy: crate::automation_grants::AutomationGrantPolicy = parse(&headers, &bytes)?;
    let mut secret = [0u8; 32];
    getrandom::fill(&mut secret).map_err(|_| {
        error(
            StatusCode::SERVICE_UNAVAILABLE,
            "automation_entropy_unavailable",
        )
    })?;
    use base64::Engine;
    let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(secret);
    let token_sha256 = digest(token.as_bytes());
    let grant =
        crate::automation_grants::create_grant(&state.pool, &scope, &actor, policy, &token_sha256)
            .await?;
    // This one-time response is owner-authenticated and no-store. Logs contain
    // matched routes and status only, never response bodies or bearer material.
    Ok(Json(
        json!({"grant_id":grant.grant_id,"credential_id":grant.credential_id,
        "policy_sha256":grant.policy_sha256,"expires_at":grant.policy.expires_at,"credential":token}),
    ))
}

async fn revoke_grant(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Extension(actor): Extension<Actor>,
    AxumPath(id): AxumPath<Uuid>,
) -> Result<Json<Value>, ApiError> {
    enabled(&state)?;
    crate::automation_grants::revoke(&state.pool, &scope, &actor, id).await?;
    Ok(Json(
        json!({"grant_id":id,"status":"revoked","new_sends_enabled":false}),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Command {
    artifact_sha256: String,
    command: Draft,
}
async fn command(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Extension(actor): Extension<Actor>,
    identity: Option<Extension<Arc<AutomationIdentity>>>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<Value>, ApiError> {
    enabled(&state)?;
    let identity = identity
        .ok_or_else(|| denied("automation_credential_required"))?
        .0;
    if actor
        != (Actor::Automation {
            grant_id: identity.grant_id,
            credential_id: identity.credential_id,
        })
    {
        return Err(denied("automation_credential_required"));
    }
    let body: Command = parse(&headers, &bytes)?;
    let command = draft(
        &headers,
        &serde_json::to_vec(&body.command).map_err(|_| ApiError::database())?,
    )?;
    super::submit(
        &state,
        &scope,
        command,
        Some(Submission {
            identity,
            artifact_sha256: body.artifact_sha256,
        }),
    )
    .await
}

async fn owned_request(
    state: &AppState,
    scope: &Workspace,
    actor: &Actor,
    id: Uuid,
) -> Result<Value, ApiError> {
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let row=conn.query_opt("SELECT r.result,r.command_body,a.grant_id,a.credential_id FROM mt5_demo_requests r JOIN automation_grant_requests a USING(workspace_id,request_id) WHERE r.workspace_id=$1 AND r.request_id=$2",
        &[&scope.workspace_id,&id]).await.map_err(|_|ApiError::database())?
        .ok_or_else(||error(StatusCode::NOT_FOUND,"automation_request_not_found"))?;
    if let Actor::Automation {
        grant_id,
        credential_id,
    } = actor
    {
        if *grant_id != row.get::<_, Uuid>("grant_id")
            || *credential_id != row.get::<_, Uuid>("credential_id")
        {
            return Err(error(StatusCode::NOT_FOUND, "automation_request_not_found"));
        }
    }
    Ok(json!({"result":row.get::<_,Value>("result"),"command":row.get::<_,Value>("command_body")}))
}
async fn receipt(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Extension(actor): Extension<Actor>,
    AxumPath(id): AxumPath<Uuid>,
) -> Result<Json<Value>, ApiError> {
    enabled(&state)?;
    Ok(Json(
        owned_request(&state, &scope, &actor, id).await?["result"].clone(),
    ))
}

async fn reconcile(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Extension(actor): Extension<Actor>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<Value>, ApiError> {
    enabled(&state)?;
    let request: super::Reconcile = parse(&headers, &bytes)?;
    let owned = owned_request(&state, &scope, &actor, request.request_id).await?;
    let connection = owned["command"]["connection_id"].clone();
    if request.connection_id.is_some() && json!(request.connection_id) != connection {
        return Err(denied("automation_scope_denied"));
    }
    let bytes =
        serde_json::to_vec(&json!({"request_id":request.request_id,"connection_id":connection}))
            .map_err(|_| ApiError::database())?;
    // Read/receipt reconciliation stays available after grant expiry/revocation;
    // this native method has no order_send path.
    super::reconcile(State(state), scope, headers, Bytes::from(bytes)).await
}
