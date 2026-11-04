//! Read-only bounded broker-history pages; requested range is not proven coverage.
use super::*;

pub(super) const PATH: &str = "/api/v2/live/trading/ticks";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TickQuery {
    connection_id: Uuid,
    generation: i64,
    symbol: String,
    from_msc: i64,
    to_msc: i64,
}

impl TickQuery {
    fn validate(&self, now_msc: i64) -> Result<(), ApiError> {
        if self.generation < 1
            || self.from_msc < 0
            || self.to_msc <= self.from_msc
            || self.to_msc - self.from_msc > 60_000
            || self.from_msc % 1000 != 0
            || self.to_msc % 1000 != 0
            || self.to_msc > now_msc - 2000
            || !plain(&self.symbol, 64)
        {
            return Err(error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "mt5_tick_range_invalid",
            ));
        }
        Ok(())
    }
}

pub(super) async fn read(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    headers: HeaderMap,
    Query(query): Query<TickQuery>,
) -> Result<Json<Value>, ApiError> {
    local_origin(&headers)?;
    query.validate(chrono::Utc::now().timestamp_millis())?;
    if !state.native_runtime {
        return Err(denied("mt5_native_runtime_required"));
    }
    let p = context(&state, &scope, Some(query.connection_id), true).await?;
    let Context::Managed(m) = &p else {
        return Err(denied("mt5_connection_not_available"));
    };
    if query.generation != m.generation {
        return Err(denied("mt5_connection_changed"));
    }
    let mut result = adapter_for(
        &state,
        &p,
        p.input(
            "ticks",
            json!({
                "symbol":query.symbol,"from_msc":query.from_msc,"to_msc":query.to_msc
            }),
        ),
    )
    .await
    .map_err(|code| error(StatusCode::SERVICE_UNAVAILABLE, &code))?;
    if let Some(code) = result["error"].as_str() {
        return Err(error(StatusCode::SERVICE_UNAVAILABLE, code));
    }
    if result["schema_version"] != "mt5-tick-range-v1" || result["status"] != "ready" {
        return Err(error(
            StatusCode::SERVICE_UNAVAILABLE,
            "mt5_tick_history_unavailable",
        ));
    }
    result["binding"] = json!({"workspace_id":scope.workspace_id,
        "connection_id":m.connection_id,"generation":m.generation,
        "login":m.login,"server":m.server,"environment":m.environment});
    Ok(Json(result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range_is_bounded_closed_aligned_and_requires_generation() {
        let mut q = TickQuery {
            connection_id: Uuid::nil(),
            generation: 1,
            symbol: "EURUSDm".into(),
            from_msc: 100_000,
            to_msc: 110_000,
        };
        assert!(q.validate(112_000).is_ok());
        assert!(q.validate(111_999).is_err());
        q.from_msc = -1000;
        assert!(q.validate(112_000).is_err());
        q.from_msc = 100_001;
        assert!(q.validate(112_000).is_err());
        q.from_msc = 100_000;
        q.to_msc = 161_000;
        assert!(q.validate(163_000).is_err());
        q.to_msc = q.from_msc;
        assert!(q.validate(163_000).is_err());
        q.to_msc = 110_000;
        q.generation = 0;
        assert!(q.validate(112_000).is_err());
    }
}
