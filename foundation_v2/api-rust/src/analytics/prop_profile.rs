use super::*;
use chrono::NaiveDate;
fn finite(v: &Value, label: &str, minimum: Option<f64>) -> R<f64> {
    let n = number(v).map_err(|_| format!("{label} must be a finite number"))?;
    if minimum.is_some_and(|m| n < m) {
        return Err(format!("{label} must be at least {:.1}", minimum.unwrap()));
    }
    Ok(n)
}
fn norm(v: &Value) -> String {
    if truth(v) {
        trades::python_str(v).trim().to_string()
    } else {
        String::new()
    }
}
fn optional(snapshot: &Value, k: &str, blockers: &mut BTreeSet<String>) -> R<Option<f64>> {
    if snapshot[k].is_null() || snapshot[k] == "" {
        blockers.insert(format!("missing_{k}"));
        Ok(None)
    } else {
        finite(&snapshot[k], k, None).map(Some)
    }
}
pub fn evaluate_prop_profile(profile: &Value, snapshot: &Value) -> R<Value> {
    if !profile.is_object() {
        return Err("profile must be an object".into());
    }
    let id = norm(&profile["profile_id"]);
    let terms = norm(&profile["terms_version"]);
    let effective = norm(&profile["effective_from"]);
    let zone = norm(&profile["reset_timezone"]);
    if [
        id.as_str(),
        terms.as_str(),
        effective.as_str(),
        zone.as_str(),
    ]
    .contains(&"")
    {
        return Err(
            "profile_id, terms_version, effective_from and reset_timezone are required".into(),
        );
    }
    // The retained evaluator records the declared timezone; it does not invent day-reset data.
    if NaiveDate::parse_from_str(&effective, "%Y-%m-%d").is_err() {
        return Err("effective_from must be YYYY-MM-DD".into());
    }
    if zone != "UTC" {
        let parts = zone.split('/').collect::<Vec<_>>();
        if parts.len() < 2
            || parts[0].is_empty()
            || !parts[0]
                .chars()
                .all(|c| c.is_ascii_alphabetic() || "_+-".contains(c))
            || parts[1..].iter().any(|s| {
                s.is_empty()
                    || !s
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || "_+.-".contains(c))
            })
        {
            return Err("reset_timezone must be UTC or an IANA-style timezone id".into());
        }
    }
    let total = &profile["total_drawdown"];
    let daily = &profile["daily_loss"];
    if !total.is_object() || !daily.is_object() {
        return Err("total_drawdown and daily_loss must be objects".into());
    }
    let kind = norm(&total["type"]).to_lowercase();
    if !["static", "trailing"].contains(&kind.as_str()) {
        return Err("total_drawdown.type must be static or trailing".into());
    }
    let tb = norm(&total["basis"]).to_lowercase();
    let db = norm(&daily["basis"]).to_lowercase();
    if !["balance", "equity"].contains(&tb.as_str())
        || !["balance", "equity"].contains(&db.as_str())
    {
        return Err("drawdown basis must be balance or equity".into());
    }
    let cost = if truth(&profile["cost_basis"]) {
        norm(&profile["cost_basis"]).to_lowercase()
    } else {
        "included".into()
    };
    if !["included", "separate"].contains(&cost.as_str()) {
        return Err("cost_basis must be included or separate".into());
    }
    let boundary = profile
        .get("breach_at_boundary")
        .cloned()
        .unwrap_or(json!(true));
    let boundary = boundary
        .as_bool()
        .ok_or("breach_at_boundary must be boolean")?;
    let ta = finite(&total["amount"], "total_drawdown.amount", Some(0.0))?;
    let da = finite(&daily["amount"], "daily_loss.amount", Some(0.0))?;
    let normalized = json!({"profile_id":id,"terms_version":terms,"effective_from":effective,"reset_timezone":zone,"total_drawdown":{"type":kind,"amount":ta,"basis":tb},"daily_loss":{"amount":da,"basis":db},"cost_basis":cost,"breach_at_boundary":boundary});
    if !snapshot.is_object() {
        return Err("snapshot must be an object".into());
    }
    let mut blockers = BTreeSet::new();
    let start = optional(snapshot, "starting_balance", &mut blockers)?;
    let balance = optional(snapshot, "balance", &mut blockers)?;
    let equity = if tb == "equity" || db == "equity" {
        optional(snapshot, "equity", &mut blockers)?
    } else {
        None
    };
    let hwm = if kind == "trailing" {
        optional(snapshot, "high_water_mark", &mut blockers)?
    } else {
        None
    };
    let daily_start = optional(snapshot, &format!("daily_start_{db}"), &mut blockers)?;
    let (ct, cd) = if cost == "separate" {
        (
            optional(snapshot, "costs_total", &mut blockers)?,
            optional(snapshot, "costs_today", &mut blockers)?,
        )
    } else {
        (Some(0.0), Some(0.0))
    };
    if !blockers.is_empty() {
        return Ok(
            json!({"schema_version":"prop-profile-evaluation-v1","status":"blocked_by_data","profile":normalized,"blocked_by_data":blockers,"total_drawdown":null,"daily_loss":null}),
        );
    }
    let total_current = if tb == "balance" {
        balance.unwrap()
    } else {
        equity.unwrap()
    } - ct.unwrap();
    let daily_current = if db == "balance" {
        balance.unwrap()
    } else {
        equity.unwrap()
    } - cd.unwrap();
    let tr = if kind == "static" {
        start.unwrap()
    } else {
        hwm.unwrap()
    };
    let dr = daily_start.unwrap();
    let (tf, df) = (tr - ta, dr - da);
    let total_breached = if boundary {
        total_current <= tf
    } else {
        total_current < tf
    };
    let daily_breached = if boundary {
        daily_current <= df
    } else {
        daily_current < df
    };
    Ok(
        json!({"schema_version":"prop-profile-evaluation-v1","status":if total_breached||daily_breached{"breached"}else{"within_limits"},"profile":normalized,"blocked_by_data":[],"total_drawdown":{"basis":tb,"reference":tr,"floor":tf,"current":total_current,"remaining":total_current-tf,"breached":total_breached},"daily_loss":{"basis":db,"reference":dr,"floor":df,"current":daily_current,"remaining":daily_current-df,"breached":daily_breached},"assumptions":{"cost_basis":cost,"cashflow_adjustment":"not_modeled","payout_probability":"not_estimated"}}),
    )
}
