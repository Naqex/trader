use crate::state::AppState;
use axum::{
    Json,
    extract::FromRequestParts,
    http::{HeaderMap, StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use std::{collections::HashSet, sync::Arc};

mod local_capability;
pub use local_capability::{
    BootstrapCapability, BootstrapSession, LocalCapabilityConfig, OwnerBearerCapability,
    OwnerSessionStatus,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Actor {
    Owner,
    Automation {
        grant_id: uuid::Uuid,
        credential_id: uuid::Uuid,
    },
}
impl Actor {
    pub fn require_owner(&self) -> Result<(), ApiError> {
        if matches!(self, Self::Owner) {
            Ok(())
        } else {
            Err(ApiError::detail(
                StatusCode::FORBIDDEN,
                "owner_capability_required",
            ))
        }
    }
}

/// Produced by trusted native grant storage, never deserialized from a request.
pub struct AutomationIdentity {
    pub workspace_id: String,
    pub grant_id: uuid::Uuid,
    pub credential_id: uuid::Uuid,
    pub token_sha256: String,
}

#[derive(Clone)]
pub struct LocalAuthorization {
    pub identity: String,
    workspaces: HashSet<String>,
    capabilities: Option<Arc<local_capability::LocalCapabilities>>,
}
#[derive(Clone, Debug)]
pub struct Workspace {
    pub workspace_id: String,
    pub subject: String,
}
#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub Value);
impl ApiError {
    pub fn detail(status: StatusCode, detail: &str) -> Self {
        Self(status, json!({"detail": detail}))
    }
    pub fn database() -> Self {
        Self::detail(StatusCode::SERVICE_UNAVAILABLE, "database_unavailable")
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(self.1)).into_response()
    }
}
impl LocalAuthorization {
    pub(crate) fn authorized_workspace_ids(&self) -> Vec<String> {
        if self.identity.is_empty() {
            return vec![];
        }
        self.workspaces.iter().cloned().collect()
    }
    pub fn new(identity: String, workspaces: Vec<String>) -> Self {
        Self {
            identity: identity.trim().into(),
            workspaces: workspaces
                .into_iter()
                .map(|v| v.trim().to_owned())
                .filter(|v| !v.is_empty())
                .collect(),
            capabilities: None,
        }
    }
    pub fn with_capabilities(
        identity: String,
        workspaces: Vec<String>,
        config: LocalCapabilityConfig,
    ) -> Result<Self, String> {
        let mut authorization = Self::new(identity, workspaces);
        if authorization.identity.is_empty() || authorization.workspaces.is_empty() {
            return Err("local capability identity/workspaces missing".into());
        }
        authorization.capabilities =
            Some(Arc::new(local_capability::LocalCapabilities::new(config)?));
        Ok(authorization)
    }
    pub fn with_capabilities_from_file(
        identity: String,
        workspaces: Vec<String>,
        path: &std::path::Path,
    ) -> Result<Self, String> {
        let mut authorization = Self::new(identity, workspaces);
        if authorization.identity.is_empty() || authorization.workspaces.is_empty() {
            return Err("local capability identity/workspaces missing".into());
        }
        authorization.capabilities = Some(Arc::new(
            local_capability::LocalCapabilities::from_file(path)?,
        ));
        Ok(authorization)
    }
    pub fn capability_mode(&self) -> bool {
        self.capabilities.is_some()
    }
    pub fn is_capability_mode(&self) -> bool {
        self.capability_mode()
    }
    pub fn authorize(&self, headers: &HeaderMap) -> Result<Workspace, ApiError> {
        if self.capabilities.is_some() {
            return Err(ApiError::detail(
                StatusCode::UNAUTHORIZED,
                "request_capability_required",
            ));
        }
        self.authorize_workspace(headers)
    }
    pub(crate) fn authorize_workspace(&self, headers: &HeaderMap) -> Result<Workspace, ApiError> {
        if self.capability_mode() && headers.get_all("x-workspace-id").iter().count() > 1 {
            return Err(ApiError::detail(
                StatusCode::UNAUTHORIZED,
                "invalid_local_capability",
            ));
        }
        let header = headers.get("x-workspace-id").and_then(|v| v.to_str().ok());
        let Some(raw) = header else {
            return Err(ApiError(
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({"detail":[{"type":"missing","loc":["header","x-workspace-id"],"msg":"Field required","input":null}]}),
            ));
        };
        if raw.is_empty() {
            return Err(ApiError(
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({"detail":[{"type":"string_too_short","loc":["header","x-workspace-id"],"msg":"String should have at least 1 character","input":"","ctx":{"min_length":1}}]}),
            ));
        }
        let workspace_id = raw.trim();
        if workspace_id.is_empty() {
            return Err(ApiError::detail(
                StatusCode::FORBIDDEN,
                "workspace_access_denied",
            ));
        }
        if self.identity.is_empty() {
            return Err(ApiError::detail(
                StatusCode::UNAUTHORIZED,
                "trusted_identity_missing",
            ));
        }
        if !self.workspaces.contains(workspace_id) {
            return Err(ApiError::detail(
                StatusCode::FORBIDDEN,
                "workspace_access_denied",
            ));
        }
        Ok(Workspace {
            workspace_id: workspace_id.into(),
            subject: self.identity.clone(),
        })
    }
    pub fn authorize_request(
        &self,
        headers: &HeaderMap,
        method: &str,
        matched_route: &str,
    ) -> Result<(Workspace, Actor), ApiError> {
        let scope = self.authorize_workspace(headers)?;
        let actor = match &self.capabilities {
            Some(capabilities) => {
                capabilities.authorize(headers, method, matched_route, None, &scope.workspace_id)?
            }
            None => Actor::Owner,
        };
        Ok((scope, actor))
    }
    pub fn authorize_request_with_automation(
        &self,
        headers: &HeaderMap,
        method: &str,
        matched_route: &str,
        identity: Option<AutomationIdentity>,
    ) -> Result<(Workspace, Actor), ApiError> {
        let scope = self.authorize_workspace(headers)?;
        let capabilities = self.capabilities.as_ref().ok_or_else(|| {
            ApiError::detail(StatusCode::UNAUTHORIZED, "request_capability_required")
        })?;
        let actor = capabilities.authorize(
            headers,
            method,
            matched_route,
            identity.as_ref(),
            &scope.workspace_id,
        )?;
        Ok((scope, actor))
    }
    pub fn automation_bearer_digest(
        &self,
        headers: &HeaderMap,
    ) -> Result<Option<String>, ApiError> {
        match &self.capabilities {
            Some(capabilities) => capabilities.automation_bearer_digest(headers),
            None => Ok(None),
        }
    }
    pub fn exchange_bootstrap(
        &self,
        headers: &HeaderMap,
        nonce: &str,
    ) -> Result<BootstrapSession, ApiError> {
        self.capabilities
            .as_ref()
            .ok_or_else(|| {
                ApiError::detail(StatusCode::UNAUTHORIZED, "request_capability_required")
            })?
            .exchange_bootstrap(headers, nonce)
    }
    pub fn owner_session(&self, headers: &HeaderMap) -> Result<OwnerSessionStatus, ApiError> {
        self.capabilities
            .as_ref()
            .ok_or_else(|| {
                ApiError::detail(StatusCode::UNAUTHORIZED, "request_capability_required")
            })?
            .owner_session(headers)
    }
    pub fn status(&self) -> Value {
        json!({"mode":if self.capability_mode(){"local-capability"}else{"local-trusted-identity"},"local_only":true,"trusted_identity_configured":!self.identity.is_empty(),"production_auth":false,"oauth_or_idp":false,"database_rls":false})
    }
    pub fn callback_scope(&self, configured: Option<&[String]>) -> Result<Workspace, ApiError> {
        let Some([workspace]) = configured else {
            return Err(ApiError::detail(
                StatusCode::SERVICE_UNAVAILABLE,
                "notion_oauth_callback_workspace_unconfigured",
            ));
        };
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-workspace-id",
            workspace.parse().map_err(|_| {
                ApiError::detail(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "notion_oauth_callback_workspace_unconfigured",
                )
            })?,
        );
        self.authorize_workspace(&headers)
    }
}
impl FromRequestParts<Arc<AppState>> for Workspace {
    type Rejection = ApiError;
    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        if let Some(scope) = parts.extensions.get::<Workspace>() {
            return Ok(scope.clone());
        }
        let route = parts
            .extensions
            .get::<axum::extract::MatchedPath>()
            .map(|path| path.as_str())
            .unwrap_or("");
        state
            .authorization
            .authorize_request(&parts.headers, parts.method.as_str(), route)
            .map(|(workspace, _)| workspace)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_cannot_choose_identity() {
        let auth = LocalAuthorization::new("owner".into(), vec!["tenant-a".into()]);
        let mut headers = HeaderMap::new();
        headers.insert("x-workspace-id", "tenant-b".parse().unwrap());
        headers.insert("x-user-id", "owner".parse().unwrap());
        assert_eq!(
            auth.authorize(&headers).unwrap_err().0,
            StatusCode::FORBIDDEN
        );
        headers.insert("x-workspace-id", " tenant-a ".parse().unwrap());
        assert_eq!(auth.authorize(&headers).unwrap().workspace_id, "tenant-a");
    }
    #[test]
    fn identity_missing_fails_closed() {
        let mut headers = HeaderMap::new();
        headers.insert("x-workspace-id", "tenant-a".parse().unwrap());
        assert_eq!(
            LocalAuthorization::new("".into(), vec!["tenant-a".into()])
                .authorize(&headers)
                .unwrap_err()
                .0,
            StatusCode::UNAUTHORIZED
        );
    }
}
