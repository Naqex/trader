use super::{PropResult, date_time, integer, text};
use serde_json::{Value, json};
fn projected(v: &Value, keys: &[&str]) -> Value {
    Value::Object(
        keys.iter()
            .map(|k| ((*k).to_owned(), v[*k].clone()))
            .collect(),
    )
}
pub fn build_prop_attempt_report(
    session: &Value,
    attempt: &Value,
    phase: &Value,
    resume: &Value,
) -> PropResult {
    let objectives = &resume["prop_lifecycle"]["last_objectives"];
    let binding = if resume["replay_binding"].is_object() {
        resume["replay_binding"].clone()
    } else {
        Value::Null
    };
    let mut reasons = vec![];
    let mut breaches = vec![];
    for key in ["daily_loss", "overall_drawdown"] {
        let value = &objectives["money"][key];
        if value["breached"] == true {
            reasons.push(format!("{key}_breached"));
            breaches.push(json!({"rule":key,"current":value["current"],"floor":value["floor"],"reference":value["reference"]}));
        }
    }
    if objectives["technical_status"] == "blocked_by_data" {
        reasons.push("data_quality_incomplete".into())
    }
    match text(attempt, "status") {
        "expired" => reasons.push("virtual_cutoff_expired".into()),
        "abandoned" => reasons.push("attempt_abandoned".into()),
        "completed_pass" => reasons.push("declared_objectives_satisfied".into()),
        _ => {}
    }
    let mut a = projected(
        attempt,
        &[
            "attempt_id",
            "status",
            "revision",
            "parent_attempt_id",
            "branch_kind",
            "data_version",
            "cost_version",
            "engine_version",
        ],
    );
    for k in ["virtual_start_utc", "virtual_cutoff_utc"] {
        a[k] = json!(date_time(attempt, k)?.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true));
    }
    let mut p = projected(
        phase,
        &[
            "phase_index",
            "initial_balance",
            "balance",
            "floating_pl",
            "equity",
            "high_water_mark",
            "daily_anchor",
            "qualifying_days",
            "last_event_sequence",
            "open_positions",
            "pending_orders",
            "evaluation_quality",
        ],
    );
    p["virtual_time_utc"] = json!(
        date_time(phase, "virtual_time_utc")?.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true)
    );
    let index = integer(phase, "phase_index")?;
    p["currency"] = session["profile"]["phases"]
        .as_array()
        .and_then(|v| v.get(index.wrapping_sub(1) as usize))
        .ok_or("phase state references an unknown frozen phase")?["currency"]
        .clone();
    Ok(
        json!({"schema_version":"prop-attempt-report-v1","mode":"simulation","result_source":if binding.is_null(){"simulation"}else{"replay_simulation"},"broker_execution_capability":false,
      "session":projected(session,&["session_id","session_type","status","revision"]),"profile":projected(&session["profile"],&["profile_id","terms_version","profile_hash","effective_from","source_kind"]),"attempt":a,"phase":p,"objectives":objectives,
      "outcome":{"status":attempt["status"],"terminal":(["completed_pass","failed_breach","expired","abandoned"].contains(&text(attempt,"status"))),"technical_status":objectives["technical_status"],"terminal_action":objectives["terminal_action"],"reason_codes":reasons,"breaches":breaches},
      "provenance":{"hindsight_exploratory":attempt["branch_kind"]=="hindsight_exploratory","replay_binding":binding,"replay_cursor":if !binding.is_null()&&resume["cursor"].is_object(){resume["cursor"].clone()}else{Value::Null},"branch_provenance":if resume["branch_provenance"].is_object(){resume["branch_provenance"].clone()}else{Value::Null}},
      "tutorials":{"learn_view_href":"/?view=learn","learn_overview_href":"/api/v2/learn/overview","answer_keys_exposed":false,"auto_completion_enabled":false},
      "safety":{"simulation_only":true,"broker_results_included":false,"broker_credentials_included":false,"holdout_content_included":false}}),
    )
}
pub fn prop_attempt_report_csv(report: &Value) -> String {
    let columns = [
        ("schema_version", "schema_version"),
        ("mode", "mode"),
        ("result_source", "result_source"),
        ("session_id", "session.session_id"),
        ("session_status", "session.status"),
        ("session_revision", "session.revision"),
        ("attempt_id", "attempt.attempt_id"),
        ("attempt_status", "attempt.status"),
        ("attempt_revision", "attempt.revision"),
        ("branch_kind", "attempt.branch_kind"),
        ("data_version", "attempt.data_version"),
        ("cost_version", "attempt.cost_version"),
        ("engine_version", "attempt.engine_version"),
        ("phase_index", "phase.phase_index"),
        ("balance", "phase.balance"),
        ("equity", "phase.equity"),
        ("high_water_mark", "phase.high_water_mark"),
        ("qualifying_days", "phase.qualifying_days"),
        ("virtual_time_utc", "phase.virtual_time_utc"),
        ("evaluation_quality", "phase.evaluation_quality"),
        ("terminal", "outcome.terminal"),
        ("terminal_action", "outcome.terminal_action"),
        ("reason_codes", "outcome.reason_codes"),
        ("hindsight_exploratory", "provenance.hindsight_exploratory"),
        ("broker_execution_capability", "broker_execution_capability"),
    ];
    let strings = [
        "schema_version",
        "mode",
        "result_source",
        "session_id",
        "session_status",
        "attempt_id",
        "attempt_status",
        "branch_kind",
        "data_version",
        "cost_version",
        "engine_version",
        "virtual_time_utc",
        "evaluation_quality",
        "terminal_action",
        "reason_codes",
    ];
    let escape = |s: String| {
        if s.contains([',', '"', '\r', '\n']) {
            format!("\"{}\"", s.replace('"', "\"\""))
        } else {
            s
        }
    };
    let values: Vec<String> = columns
        .iter()
        .map(|(key, path)| {
            let mut value = report;
            for segment in path.split('.') {
                value = &value[segment];
            }
            let mut out = if *key == "reason_codes" {
                value
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join("|")
            } else {
                match value {
                    Value::Null => String::new(),
                    Value::String(v) => v.clone(),
                    Value::Bool(v) => {
                        if *v {
                            "True".into()
                        } else {
                            "False".into()
                        }
                    }
                    _ => value.to_string(),
                }
            };
            if strings.contains(key) && out.starts_with(['=', '+', '-', '@', '\t', '\r']) {
                out.insert(0, '\'');
            }
            escape(out)
        })
        .collect();
    format!(
        "{}\r\n{}\r\n",
        columns
            .iter()
            .map(|(k, _)| *k)
            .collect::<Vec<_>>()
            .join(","),
        values.join(",")
    )
}
