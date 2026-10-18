//! Pure Prop simulation transforms. Persistence and authority checks remain with the caller.
use bigdecimal::{BigDecimal, RoundingMode};
use chrono::{DateTime, Duration, NaiveDate, NaiveTime, Offset, SecondsFormat, TimeZone, Utc};
use chrono_tz::Tz;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, str::FromStr};

pub type PropResult = Result<Value, String>;
#[path = "prop_core/paper.rs"]
pub mod paper;
#[path = "prop_core/report.rs"]
pub mod report;

/// Cross-field checks complement the frozen command JSON schemas and defaults.
pub fn validate_phase_spec(phase: &Value) -> Result<(), String> {
    if num(phase, "initial_capital")? <= zero() {
        return Err("initial_capital must be positive".into());
    }
    for key in ["profit_target", "daily_loss", "overall_drawdown"] {
        let threshold = &phase[key]["threshold"];
        if threshold["amount"].is_null() == threshold["percent"].is_null() {
            return Err("exactly one of amount or percent is required".into());
        }
        let field = if threshold["amount"].is_null() {
            "percent"
        } else {
            "amount"
        };
        if num(threshold, field)? < zero() {
            return Err(format!("{key} threshold must be nonnegative"));
        }
    }
    let dd = &phase["overall_drawdown"];
    if dd["kind"] == "trailing" && dd["trailing_granularity"].is_null() {
        return Err("trailing drawdown requires trailing_granularity".into());
    }
    if dd["kind"] == "static" && !dd["trailing_granularity"].is_null() {
        return Err("static drawdown cannot declare trailing_granularity".into());
    }
    text(phase, "reset_timezone")
        .parse::<Tz>()
        .map_err(|_| "reset_timezone must be a valid IANA timezone".to_string())?;
    Ok(())
}
pub fn validate_profile_snapshot(profile: &Value) -> Result<(), String> {
    let phases = profile["phases"]
        .as_array()
        .ok_or("profile phases required")?;
    if phases.is_empty() || phases.len() > 16 {
        return Err("profile requires 1 to 16 phases".into());
    }
    let mut currencies = BTreeSet::new();
    for (index, phase) in phases.iter().enumerate() {
        validate_phase_spec(phase)?;
        if phase["phase_index"] != json!(index + 1) {
            return Err("phase indexes must be ordered and contiguous from 1".into());
        }
        currencies.insert(text(phase, "currency").to_uppercase());
    }
    if currencies.len() != 1 {
        return Err("all phases in one profile snapshot must use one currency".into());
    }
    if profile["source_kind"] == "named_provider" && text(profile, "source_url").is_empty() {
        return Err("named_provider profile snapshots require source_url".into());
    }
    Ok(())
}
pub fn validate_attempt_snapshot(attempt: &Value) -> Result<(), String> {
    let start = date_time(attempt, "virtual_start_utc")?;
    let cutoff = date_time(attempt, "virtual_cutoff_utc")?;
    if cutoff < start {
        return Err("virtual_cutoff_utc must not precede virtual_start_utc".into());
    }
    Ok(())
}
pub fn validate_phase_snapshot(phase: &Value) -> Result<(), String> {
    if num(phase, "equity")? != rounded(num(phase, "balance")? + num(phase, "floating_pl")?) {
        return Err("equity must equal balance plus floating_pl".into());
    }
    date_time(phase, "virtual_time_utc")?;
    Ok(())
}
fn text<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}
fn num(v: &Value, k: &str) -> Result<BigDecimal, String> {
    let x = &v[k];
    let raw = x.as_str().map(str::to_owned).unwrap_or_else(|| x.to_string());
    if raw.len() > 512 {
        return Err(format!("{k} exceeds supported decimal bounds"));
    }
    let value = BigDecimal::from_str(&raw).map_err(|_| format!("{k} must be a decimal value"))?;
    if value.as_bigint_and_exponent().1.unsigned_abs() > 512 {
        return Err(format!("{k} exceeds supported decimal bounds"));
    }
    Ok(value)
}
fn dec(v: &BigDecimal) -> Value {
    let (coefficient, scale) = v.as_bigint_and_exponent();
    let signed = coefficient.to_string();
    let (sign, digits) = signed.strip_prefix('-').map(|s| ("-", s)).unwrap_or(("", signed.as_str()));
    let adjusted = digits.len() as i64 - scale - 1;
    let text = if scale < 0 || adjusted < -6 {
        let mantissa = if digits.len() == 1 { digits.to_owned() } else { format!("{}.{}", &digits[..1], &digits[1..]) };
        format!("{sign}{mantissa}E{adjusted:+}")
    } else {
        v.to_plain_string()
    };
    Value::String(text)
}
fn zero() -> BigDecimal {
    BigDecimal::from(0)
}
fn rounded(value: BigDecimal) -> BigDecimal {
    if value.digits() <= 28 { return value; }
    let value = value.with_precision_round(std::num::NonZeroU64::new(28).unwrap(), RoundingMode::HalfEven);
    if value.digits() > 28 {
        value.with_precision_round(std::num::NonZeroU64::new(28).unwrap(), RoundingMode::HalfEven)
    } else { value }
}
fn d0(v: &Value, k: &str) -> Result<BigDecimal, String> {
    if v[k].is_null() {
        Ok(zero())
    } else {
        num(v, k)
    }
}
fn integer(v: &Value, k: &str) -> Result<i64, String> {
    v[k].as_i64()
        .ok_or_else(|| format!("{k} must be an integer"))
}
fn date_time(v: &Value, k: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(text(v, k))
        .map(|x| x.with_timezone(&Utc))
        .map_err(|_| format!("{k} must be timezone-aware"))
}
fn iso(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::AutoSi, false)
}
fn obj(v: &Value) -> Value {
    if v.is_object() { v.clone() } else { json!({}) }
}
fn threshold(
    rule: &Value,
    initial: &BigDecimal,
    anchor: &BigDecimal,
    hwm: &BigDecimal,
) -> Result<BigDecimal, String> {
    let r = &rule["threshold"];
    if !r["amount"].is_null() {
        return num(r, "amount");
    }
    let base = match text(r, "percent_base") {
        "daily_anchor" => anchor,
        "high_water_mark" => hwm,
        _ => initial,
    };
    let percent = num(r, "percent")?;
    let percent = if percent == zero() { zero() } else { percent };
    let (base_coefficient, base_scale) = base.as_bigint_and_exponent();
    let (percent_coefficient, percent_scale) = percent.as_bigint_and_exponent();
    let product = rounded(BigDecimal::new(base_coefficient * percent_coefficient, base_scale + percent_scale));
    let (mut coefficient, scale) = product.as_bigint_and_exponent();
    let mut quotient_scale = scale + 2;
    // Decimal division prefers the dividend's exponent, retaining its significant
    // zeros; an exact /100 only needs extra fractional places when not divisible.
    for _ in 0..2 {
        if &coefficient % 10 != num_bigint::BigInt::from(0) { break; }
        coefficient /= 10;
        quotient_scale -= 1;
    }
    Ok(rounded(BigDecimal::new(coefficient, quotient_scale)))
}

pub fn money_oracle(phase: &Value, values: &Value) -> PropResult {
    let initial = num(values, "initial_capital")?;
    if initial != num(phase, "initial_capital")? {
        return Err("initial_capital does not match the frozen phase spec".into());
    }
    let anchor = num(values, "daily_anchor")?;
    let hwm = num(values, "high_water_mark")?;
    let mut balance = num(values, "balance_before_separate_costs")?;
    if text(values, "accounting") == "costs_separate" {
        balance = rounded(balance + d0(values, "conversion_adjustment")?);
        balance = rounded(balance - rounded(d0(values, "fees")? + d0(values, "swap")?));
    }
    let equity = rounded(&balance + d0(values, "floating_pl")?);
    let target = rounded(&initial + threshold(&phase["profit_target"], &initial, &anchor, &hwm)?);
    let daily_floor = rounded(&anchor - threshold(&phase["daily_loss"], &initial, &anchor, &hwm)?);
    let overall = &phase["overall_drawdown"];
    let reference = if text(overall, "kind") == "trailing" {
        hwm.clone()
    } else {
        initial.clone()
    };
    let mut overall_floor = rounded(&reference - threshold(overall, &initial, &anchor, &hwm)?);
    if overall["lock_floor_at_initial"] == true {
        overall_floor = overall_floor.min(initial);
    }
    let basis = |r: &Value| {
        if text(r, "basis") == "balance" {
            balance.clone()
        } else {
            equity.clone()
        }
    };
    let tc = basis(&phase["profit_target"]);
    let dc = basis(&phase["daily_loss"]);
    let oc = basis(overall);
    let hit = if text(&phase["profit_target"], "comparator") == "gt" {
        tc > target
    } else {
        tc >= target
    };
    let breached = |c: &BigDecimal, f: &BigDecimal, r: &Value| {
        if text(r, "comparator") == "lte" {
            c <= f
        } else {
            c < f
        }
    };
    let db = breached(&dc, &daily_floor, &phase["daily_loss"]);
    let ob = breached(&oc, &overall_floor, overall);
    Ok(
        json!({"oracle_version":"prop-money-oracle-v1","balance":dec(&balance),"equity":dec(&equity),
      "profit_target":{"target":dec(&target),"current":dec(&tc),"hit":hit},
      "daily_loss":{"reference":dec(&anchor),"floor":dec(&daily_floor),"current":dec(&dc),"breached":db},
      "overall_drawdown":{"kind":overall["kind"],"reference":dec(&reference),"floor":dec(&overall_floor),"current":dec(&oc),"breached":ob},
      "terminal_precedence":if db||ob{json!("failed_breach")}else{Value::Null}}),
    )
}

fn local_boundary(day: NaiveDate, phase: &Value) -> Result<DateTime<Utc>, String> {
    let zone: Tz = text(phase, "reset_timezone")
        .parse()
        .map_err(|_| "reset_timezone must be a valid IANA timezone".to_string())?;
    let raw = if text(phase, "reset_local_time").is_empty() {
        "00:00:00"
    } else {
        text(phase, "reset_local_time")
    };
    let time = NaiveTime::parse_from_str(raw, "%H:%M:%S%.f")
        .map_err(|_| "reset_local_time is invalid".to_string())?;
    let dt = day.and_time(time);
    match zone.from_local_datetime(&dt) {
        chrono::LocalResult::Single(t) => Ok(t.with_timezone(&Utc)),
        chrono::LocalResult::Ambiguous(a, _) => Ok(a.with_timezone(&Utc)),
        chrono::LocalResult::None => {
            // Python ZoneInfo fold=0 uses the pre-transition offset in a DST gap.
            for n in 1..=172800 {
                if let Some(t) = zone
                    .from_local_datetime(&(dt - Duration::seconds(n)))
                    .earliest()
                {
                    return Ok(t
                        .offset()
                        .fix()
                        .from_local_datetime(&dt)
                        .single()
                        .unwrap()
                        .with_timezone(&Utc));
                }
            }
            Err("local reset boundary is unrepresentable".into())
        }
    }
}
pub fn calendar_oracle(phase: &Value, args: &Value) -> PropResult {
    let start = date_time(args, "virtual_start_utc")?;
    let previous = date_time(args, "previous_virtual_utc")?;
    let current = date_time(args, "current_virtual_utc")?;
    if previous < start || current < previous {
        return Err("virtual time must be monotonic from the attempt start".into());
    }
    let zone: Tz = text(phase, "reset_timezone")
        .parse()
        .map_err(|_| "reset_timezone must be a valid IANA timezone".to_string())?;
    let sd = start.with_timezone(&zone).date_naive();
    let cd = current.with_timezone(&zone).date_naive();
    let mut day = previous.with_timezone(&zone).date_naive();
    let final_day = cd.succ_opt().ok_or("calendar date overflow")?;
    let mut boundaries = vec![];
    while day <= final_day {
        let b = local_boundary(day, phase)?;
        if previous < b && b <= current {
            boundaries.push(json!({"local_date":day.to_string(),"boundary_utc":iso(b),"ordered_events":if text(phase,"reset_order")=="reset_then_fees"{vec!["daily_reset","fees_swap"]}else{vec!["fees_swap","daily_reset"]}}));
        }
        day = day.succ_opt().ok_or("calendar date overflow")?;
    }
    let mut dates = BTreeSet::new();
    for value in args["qualifying_local_dates"]
        .as_array()
        .into_iter()
        .flatten()
    {
        let d = NaiveDate::parse_from_str(value.as_str().unwrap_or(""), "%Y-%m-%d")
            .map_err(|_| "stored qualifying day is invalid")?;
        if sd <= d && d <= cd {
            dates.insert(d);
        }
    }
    let deadline = match phase["max_calendar_days"].as_i64() {
        Some(n) => Some(local_boundary(
            sd.checked_add_signed(Duration::days(n))
                .ok_or("calendar date overflow")?,
            phase,
        )?),
        None => None,
    };
    Ok(
        json!({"oracle_version":"prop-calendar-oracle-v1","virtual_time_utc":iso(current),"reset_timezone":phase["reset_timezone"],"reset_boundaries":boundaries,"elapsed_calendar_days":(cd-sd).num_days()+1,"qualifying_days":dates.len(),"min_qualifying_days_satisfied":dates.len() as i64>=phase["min_qualifying_days"].as_i64().unwrap_or(0),"deadline_utc":deadline.map(iso),"expired":deadline.is_some_and(|d|current>=d)}),
    )
}

pub fn validate_attempt_against_session(session: &Value, attempt: &Value) -> Result<(), String> {
    for (a, b, msg) in [
        ("workspace_id", "workspace_id", "workspace mismatch"),
        ("session_id", "session_id", "session mismatch"),
        ("mode", "mode", "mode mismatch"),
    ] {
        if session[a] != attempt[b] {
            return Err(msg.into());
        }
    }
    for (k, msg) in [
        ("profile_id", "profile id mismatch"),
        ("terms_version", "profile terms version mismatch"),
        ("profile_hash", "profile version mismatch"),
    ] {
        if session["profile"][k] != attempt[k] {
            return Err(msg.into());
        }
    }
    Ok(())
}
fn validate_intent(attempt: &Value, intent: &Value) -> Result<(), String> {
    if intent["workspace_id"] != attempt["workspace_id"] {
        return Err("workspace mismatch".into());
    }
    if intent["session_id"] != attempt["session_id"]
        || intent["attempt_id"] != attempt["attempt_id"]
    {
        return Err("session or attempt mismatch".into());
    }
    if intent["profile_hash"] != attempt["profile_hash"] {
        return Err("profile version mismatch".into());
    }
    if intent["expected_revision"] != attempt["revision"] {
        return Err("attempt revision conflict".into());
    }
    Ok(())
}
fn target_status(status: &str, action: &str) -> Option<&'static str> {
    match (status, action) {
        ("ready" | "next_phase_ready", "start") => Some("running"),
        ("running", "pause") => Some("paused"),
        ("paused", "resume") => Some("running"),
        ("running", "phase_pass") => Some("phase_passed"),
        ("running", "complete_pass") => Some("completed_pass"),
        ("running" | "paused", "breach") => Some("failed_breach"),
        ("running" | "paused", "expire") => Some("expired"),
        ("ready" | "running" | "paused" | "next_phase_ready", "abandon") => Some("abandoned"),
        ("phase_passed", "next_phase") => Some("next_phase_ready"),
        _ => None,
    }
}
pub fn intent_fingerprint(intent: &Value) -> Result<String, String> {
    // serde_json's default object map is ordered; Python uses sorted compact ASCII JSON.
    let raw = serde_json::to_string(intent).map_err(|e| e.to_string())?;
    let mut ascii = String::new();
    for c in raw.chars() {
        if c.is_ascii() {
            ascii.push(c)
        } else {
            let mut buf = [0u16; 2];
            for part in c.encode_utf16(&mut buf) {
                ascii.push_str(&format!("\\u{part:04x}"));
            }
        }
    }
    Ok(format!("{:x}", Sha256::digest(ascii.as_bytes())))
}
pub fn apply_transition_intent(attempt: &Value, intent: &Value, processed: &Value) -> PropResult {
    let fingerprint = intent_fingerprint(intent)?;
    if let Some(prev) = processed.get(text(intent, "intent_id")) {
        if prev != &fingerprint {
            return Err("intent_id was already used with different content".into());
        }
        return Ok(json!({"attempt":attempt,"intent_fingerprint":fingerprint,"duplicate":true}));
    }
    validate_intent(attempt, intent)?;
    let target =
        target_status(text(attempt, "status"), text(intent, "action")).ok_or_else(|| {
            format!(
                "transition {} is invalid from {}",
                text(intent, "action"),
                text(attempt, "status")
            )
        })?;
    let mut updated = attempt.clone();
    updated["status"] = json!(target);
    updated["revision"] = json!(integer(attempt, "revision")? + 1);
    Ok(json!({"attempt":updated,"intent_fingerprint":fingerprint,"duplicate":false}))
}

pub fn apply_prop_lifecycle_command(
    session: &Value,
    attempt: &Value,
    phase: &Value,
    intent: &Value,
    resume: &Value,
    canonical_replay_transition: bool,
) -> PropResult {
    validate_attempt_against_session(session, attempt)?;
    if !["start", "pause", "resume", "next_phase", "abandon"].contains(&text(intent, "action")) {
        return Err(format!(
            "transition {} is evaluator-owned",
            text(intent, "action")
        ));
    }
    if phase["workspace_id"] != attempt["workspace_id"]
        || phase["session_id"] != attempt["session_id"]
    {
        return Err("phase state scope does not match attempt".into());
    }
    if phase["attempt_id"] != attempt["attempt_id"]
        || phase["profile_hash"] != attempt["profile_hash"]
    {
        return Err("phase state identity does not match attempt".into());
    }
    if intent["event_sequence"] != phase["last_event_sequence"] {
        return Err("transition event sequence must match current simulator sequence".into());
    }
    let transition = apply_transition_intent(attempt, intent, &json!({}))?;
    let mut resume = obj(resume);
    if text(intent, "action") != "next_phase" {
        return Ok(
            json!({"attempt":transition["attempt"],"phase":phase,"resume_state":resume,"intent_fingerprint":transition["intent_fingerprint"]}),
        );
    }
    if !resume["replay_binding"].is_null()
        && resume["replay_binding"] != json!({})
        && !canonical_replay_transition
    {
        return Err("next_phase for Replay-bound attempts requires canonical replay phase transition support".into());
    }
    let phases = session["profile"]["phases"]
        .as_array()
        .ok_or("profile phases required")?;
    let index = integer(phase, "phase_index")? as usize;
    if index >= phases.len() {
        return Err("next_phase is invalid after the final frozen phase".into());
    }
    if index == 0 {
        return Err("phase_index must be positive".into());
    }
    let current = &phases[index - 1];
    let next = &phases[index];
    let policy = text(current, "carry_policy");
    if integer(phase, "pending_orders")? != 0 {
        return Err("next phase requires zero pending orders".into());
    }
    if integer(phase, "open_positions")? != 0
        && !(text(current, "position_policy") == "carry" && policy == "carry_all")
    {
        return Err("next phase requires flat positions for the frozen carry policy".into());
    }
    let mut next_phase = phase.clone();
    next_phase["phase_index"] = next["phase_index"].clone();
    next_phase["initial_balance"] = next["initial_capital"].clone();
    next_phase["qualifying_days"] = json!(0);
    let initial = num(next, "initial_capital")?;
    if policy == "reset" || policy == "carry_balance" {
        let balance = if policy == "reset" {
            initial.clone()
        } else {
            num(phase, "balance")?
        };
        for k in ["balance", "equity", "daily_anchor"] {
            next_phase[k] = dec(&balance)
        }
        next_phase["floating_pl"] = dec(&zero());
        next_phase["high_water_mark"] = dec(&initial.max(balance));
        next_phase["open_positions"] = json!(0);
        next_phase["pending_orders"] = json!(0);
        resume["open_positions"] = json!([]);
        resume["pending_orders"] = json!([]);
    } else {
        let basis = if text(&next["overall_drawdown"], "kind") == "trailing"
            && text(&next["overall_drawdown"], "basis") == "balance"
        {
            "balance"
        } else {
            "equity"
        };
        next_phase["high_water_mark"] =
            dec(&num(phase, "high_water_mark")?.max(num(phase, basis)?));
    }
    let mut lifecycle = obj(&resume["prop_lifecycle"]);
    let mut transitions = lifecycle["phase_transitions"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    transitions.push(json!({"intent_id":intent["intent_id"],"from_phase_index":phase["phase_index"],"to_phase_index":next["phase_index"],"carry_policy":policy,"event_sequence":phase["last_event_sequence"],"virtual_time_utc":iso(date_time(phase,"virtual_time_utc")?)}));
    lifecycle["qualifying_local_dates"] = json!([]);
    lifecycle["phase_transitions"] = json!(transitions);
    lifecycle["last_transition_intent_id"] = intent["intent_id"].clone();
    resume["prop_lifecycle"] = lifecycle;
    Ok(
        json!({"attempt":transition["attempt"],"phase":next_phase,"resume_state":resume,"intent_fingerprint":transition["intent_fingerprint"]}),
    )
}

pub fn evaluate_prop_lifecycle_event(
    session: &Value,
    attempt: &Value,
    phase: &Value,
    event: &Value,
    resume: &Value,
) -> PropResult {
    validate_attempt_against_session(session, attempt)?;
    validate_intent(attempt, event)?;
    if phase["profile_hash"] != attempt["profile_hash"] {
        return Err("profile version mismatch".into());
    }
    if text(attempt, "status") != "running" {
        return Err("lifecycle events require a running attempt".into());
    }
    if integer(event, "event_sequence")? != integer(phase, "last_event_sequence")? + 1 {
        return Err("event sequence must advance exactly once".into());
    }
    let now = date_time(event, "virtual_time_utc")?;
    let previous = date_time(phase, "virtual_time_utc")?;
    if now < previous {
        return Err("virtual time cannot move backwards".into());
    }
    if now > date_time(attempt, "virtual_cutoff_utc")? {
        return Err("event exceeds the attempt virtual cutoff".into());
    }
    let phases = session["profile"]["phases"]
        .as_array()
        .ok_or("profile phases required")?;
    let index = integer(phase, "phase_index")? as usize;
    let spec = phases
        .get(index.wrapping_sub(1))
        .ok_or("phase state references an unknown frozen phase")?;
    let dd = &spec["overall_drawdown"];
    let eod = text(dd, "kind") == "trailing" && text(dd, "trailing_granularity") == "end_of_day";
    let basis = if text(dd, "kind") == "trailing" && text(dd, "basis") == "balance" {
        "balance"
    } else {
        "equity"
    };
    let mut hwm = num(phase, "high_water_mark")?;
    if !eod && hwm < num(phase, basis)? {
        return Err("high_water_mark cannot be below current equity".into());
    }
    let mut resume = obj(resume);
    let mut lifecycle = obj(&resume["prop_lifecycle"]);
    let mut next_attempt = attempt.clone();
    next_attempt["revision"] = json!(integer(attempt, "revision")? + 1);
    let mut next_phase = phase.clone();
    let portfolio = resume["replay_binding"]["schema_version"] == "replay-portfolio-binding-v1";
    if portfolio && text(event,"evaluation_quality") != "full_for_declared_model" {
        lifecycle["unresolved_equity_coverage"] = json!(true);
    }
    let portfolio_blocked = portfolio && lifecycle["unresolved_equity_coverage"] == true;
    if text(event, "evaluation_quality") != "full_for_declared_model" && !portfolio_blocked {
        let objectives = json!({"schema":"prop-objectives-v1","phase_index":index,"money":null,"calendar":null,"positions_ready":false,"pass_ready":false,"technical_status":"blocked_by_data","terminal_action":null});
        lifecycle["last_operation_id"] = event["operation_id"].clone();
        lifecycle["last_event_kind"] = event["kind"].clone();
        lifecycle["last_objectives"] = objectives.clone();
        resume["prop_lifecycle"] = lifecycle;
        next_phase["evaluation_quality"] = event["evaluation_quality"].clone();
        return Ok(
            json!({"attempt":next_attempt,"phase":next_phase,"resume_state":resume,"objectives":objectives}),
        );
    }
    let mut dates = BTreeSet::new();
    for v in lifecycle["qualifying_local_dates"]
        .as_array()
        .into_iter()
        .flatten()
    {
        let s = v.as_str().ok_or("stored qualifying day is invalid")?;
        NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| "stored qualifying day is invalid")?;
        dates.insert(s.to_owned());
    }
    if event["qualifying_day"] == true {
        let zone: Tz = text(spec, "reset_timezone")
            .parse()
            .map_err(|_| "reset timezone invalid")?;
        dates.insert(now.with_timezone(&zone).date_naive().to_string());
    }
    let calendar = calendar_oracle(
        spec,
        &json!({"virtual_start_utc":attempt["virtual_start_utc"],"previous_virtual_utc":iso(previous),"current_virtual_utc":iso(now),"qualifying_local_dates":dates}),
    )?;
    let bounds = calendar["reset_boundaries"].as_array().unwrap();
    let boundary = text(event, "kind") == "calendar_boundary";
    if !boundary && !bounds.is_empty() {
        return Err(
            "calendar boundary must be processed explicitly before simulation progression".into(),
        );
    }
    if boundary && (bounds.len() != 1 || date_time(&bounds[0], "boundary_utc")? != now) {
        return Err("calendar boundary event must match the next reset boundary exactly".into());
    }
    let mut pre = num(event, "balance_before_separate_costs")?;
    if text(event, "accounting") == "costs_separate" {
        pre = rounded(pre + d0(event, "conversion_adjustment")?);
    }
    let floating = d0(event, "floating_pl")?;
    let pre_equity = rounded(&pre + &floating);
    if !eod {
        hwm = hwm.max(if basis == "balance" {
            pre.clone()
        } else {
            pre_equity.clone()
        })
    }
    let mut anchor = num(phase, "daily_anchor")?;
    let daily_balance = text(&spec["daily_loss"], "basis") == "balance";
    if boundary && text(spec, "reset_order") == "reset_then_fees" {
        anchor = if daily_balance { pre } else { pre_equity };
    }
    let mut values = event.clone();
    values["initial_capital"] = phase["initial_balance"].clone();
    values["daily_anchor"] = dec(&anchor);
    values["high_water_mark"] = dec(&hwm);
    let evaluation = money_oracle(spec, &values)?;
    if !eod {
        hwm = hwm.max(num(&evaluation, basis)?);
    }
    let mut money = evaluation.clone();
    if boundary
        && text(spec, "reset_order") != "reset_then_fees"
        && (evaluation["terminal_precedence"].is_null() || portfolio_blocked)
    {
        anchor = num(
            &evaluation,
            if daily_balance { "balance" } else { "equity" },
        )?;
        values["daily_anchor"] = dec(&anchor);
        values["high_water_mark"] = dec(&hwm);
        values["balance_before_separate_costs"] = evaluation["balance"].clone();
        values["accounting"] = json!("costs_included");
        money = money_oracle(spec, &values)?;
    }
    if eod && boundary {
        hwm = hwm.max(num(
            &money,
            if text(dd, "basis") == "balance" {
                "balance"
            } else {
                "equity"
            },
        )?);
        values["high_water_mark"] = dec(&hwm);
        values["daily_anchor"] = dec(&anchor);
        values["balance_before_separate_costs"] = money["balance"].clone();
        values["accounting"] = json!("costs_included");
        money = money_oracle(spec, &values)?;
    }
    let last = index == phases.len();
    let positions = integer(event, "pending_orders")? == 0
        && (integer(event, "open_positions")? == 0
            || (!last
                && text(spec, "position_policy") == "carry"
                && text(spec, "carry_policy") == "carry_all"));
    let pass = !portfolio_blocked && money["profit_target"]["hit"] == true
        && calendar["min_qualifying_days_satisfied"] == true
        && positions;
    let terminal = if portfolio_blocked && calendar["expired"] == true {
        Some(("expire", "expired"))
    } else if portfolio_blocked { None } else if money["terminal_precedence"] == "failed_breach" {
        Some(("breach", "failed_breach"))
    } else if calendar["expired"] == true {
        Some(("expire", "expired"))
    } else if pass {
        Some(if last {
            ("complete_pass", "completed_pass")
        } else {
            ("phase_pass", "phase_passed")
        })
    } else {
        None
    };
    if let Some((_, status)) = terminal {
        next_attempt["status"] = json!(status)
    }
    next_phase["balance"] = money["balance"].clone();
    next_phase["equity"] = money["equity"].clone();
    next_phase["floating_pl"] = dec(&floating);
    next_phase["high_water_mark"] = dec(&hwm);
    next_phase["daily_anchor"] = dec(&anchor);
    next_phase["qualifying_days"] = calendar["qualifying_days"].clone();
    next_phase["virtual_time_utc"] = json!(iso(now));
    next_phase["last_event_sequence"] = event["event_sequence"].clone();
    for k in ["open_positions", "pending_orders", "evaluation_quality"] {
        next_phase[k] = event[k].clone();
    }
    if portfolio_blocked { next_phase["evaluation_quality"] = json!("insufficient"); }
    let objectives = json!({"schema":"prop-objectives-v1","phase_index":index,"money":money,"calendar":calendar,"positions_ready":positions,"pass_ready":pass,"technical_status":if portfolio_blocked {"blocked_by_data"}else{"ready"},"terminal_action":terminal.map(|t|t.0)});
    // Python persists datetime via str(datetime), which uses a space, unlike model JSON.
    let mut persisted = objectives.clone();
    if let Some(c) = persisted["calendar"].as_object_mut() {
        for k in ["virtual_time_utc", "deadline_utc"] {
            if let Some(s) = c[k].as_str() {
                c.insert(k.into(), json!(s.replacen('T', " ", 1)));
            }
        }
    }
    for b in persisted["calendar"]["reset_boundaries"]
        .as_array_mut()
        .unwrap()
    {
        b["boundary_utc"] = json!(text(b, "boundary_utc").replacen('T', " ", 1));
    }
    lifecycle["qualifying_local_dates"] = json!(dates);
    lifecycle["last_operation_id"] = event["operation_id"].clone();
    lifecycle["last_event_kind"] = event["kind"].clone();
    lifecycle["last_objectives"] = persisted.clone();
    resume["prop_lifecycle"] = lifecycle;
    Ok(
        json!({"attempt":next_attempt,"phase":next_phase,"resume_state":resume,"objectives":persisted}),
    )
}

pub fn validate_replay_prop_binding(
    snapshot: &Value,
    attempt: &Value,
    phase: &Value,
) -> Result<(), String> {
    let engine = match text(snapshot, "schema_version") {
        "replay-execution-tick-v1" => "replay-tick-v1",
        "replay-execution-v2" => "replay-v2",
        "replay-portfolio-v1" => text(snapshot,"engine_version"),
        _ => "replay-v1",
    };
    if text(attempt, "engine_version") != engine {
        return Err(format!("prop attempt engine_version must be {engine}"));
    }
    let version = text(attempt, "data_version").trim().to_lowercase();
    let sha = text(snapshot, if snapshot["schema_version"] == "replay-portfolio-v1" {
        "primary_dataset_sha256"
    } else { "dataset_sha256" }).trim().to_lowercase();
    if version != sha && version != format!("sha256:{sha}") {
        return Err("prop attempt data_version must pin the replay dataset sha256".into());
    }
    if text(attempt, "cost_version") != text(&snapshot["cost_model"], "version") {
        return Err("prop attempt cost_version does not match replay cost model".into());
    }
    if phase["phase_index"] != snapshot["phase_index"] {
        return Err("prop phase index does not match replay phase index".into());
    }
    let initial = if snapshot["phase_initial_balance"].is_null()
        || num(snapshot, "phase_initial_balance")? == zero()
    {
        num(snapshot, "starting_balance")?
    } else {
        num(snapshot, "phase_initial_balance")?
    };
    if num(phase, "initial_balance")? != initial {
        return Err("prop phase initial balance does not match replay starting balance".into());
    }
    Ok(())
}
pub fn replay_event_operation_id(
    replay_session_id: &str,
    branch_id: &str,
    replay_event_sequence: i64,
    prop_session_id: &str,
    prop_attempt_id: &str,
) -> String {
    let source = format!(
        "{replay_session_id}|{branch_id}|{replay_event_sequence}|{prop_session_id}|{prop_attempt_id}"
    );
    format!(
        "replay-prop-{}",
        &format!("{:x}", Sha256::digest(source.as_bytes()))[..40]
    )
}
pub fn replay_mark_to_prop_event(
    args: &Value,
    phase_spec: &Value,
    replay_event: &Value,
) -> PropResult {
    if !["price_mark", "manual_close", "order_cancel"].contains(&text(replay_event, "kind")) {
        return Err("only canonical replay price_mark events can feed prop lifecycle".into());
    }
    let dd = &phase_spec["overall_drawdown"];
    let intrabar = text(&phase_spec["profit_target"], "basis") == "equity"
        || text(&phase_spec["daily_loss"], "basis") == "equity"
        || text(dd, "basis") == "equity"
        || (text(dd, "kind") == "trailing" && text(dd, "trailing_granularity") == "intraday");
    let quality = if intrabar && replay_event["details"]["intrabar_equity_coverage"] != "complete" {
        json!("insufficient")
    } else {
        replay_event["evaluation_quality"].clone()
    };
    let secs = integer(replay_event, "virtual_time_utc")?;
    let dt = DateTime::from_timestamp(secs, 0).ok_or("replay virtual time out of range")?;
    Ok(
        json!({"workspace_id":args["workspace_id"],"session_id":args["prop_session_id"],"attempt_id":args["prop_attempt_id"],"profile_hash":args["profile_hash"],
      "operation_id":replay_event_operation_id(text(replay_event,"replay_session_id"),text(replay_event,"branch_id"),integer(replay_event,"sequence")?,text(args,"prop_session_id"),text(args,"prop_attempt_id")),
      "expected_revision":args["expected_prop_revision"],"event_sequence":args["prop_event_sequence"],"kind":"simulation_snapshot","virtual_time_utc":dt.to_rfc3339_opts(SecondsFormat::Secs, true),
      "balance_before_separate_costs":replay_event["balance"],"floating_pl":replay_event["floating_pl"],"fees":"0","swap":"0","conversion_adjustment":"0","accounting":"costs_included",
      "open_positions":replay_event["open_positions"],"pending_orders":replay_event["pending_orders"],"evaluation_quality":quality,
      "qualifying_day":replay_event["schema_version"] == "replay-portfolio-event-v1" && replay_event["details"]["source_events"].as_array().into_iter().flatten().any(|event|event["kind"]=="market_fill")}),
    )
}
fn position_list(snapshot: &Value) -> Value {
    if snapshot["schema_version"] == "replay-portfolio-v1" {
        snapshot["positions"].clone()
    } else if snapshot["position"].is_null() {
        json!([])
    } else {
        json!([snapshot["position"]])
    }
}
pub fn validate_replay_prop_transition_result(
    snapshot: &Value,
    attempt: &Value,
    phase: &Value,
    resume: &Value,
) -> Result<(), String> {
    validate_replay_prop_binding(snapshot, attempt, phase)?;
    for k in ["balance", "floating_pl", "equity"] {
        if num(phase, k)? != num(snapshot, k)? {
            return Err("prop phase transition money state diverged from canonical replay".into());
        }
    }
    let positions = position_list(snapshot);
    if phase["open_positions"] != json!(positions.as_array().unwrap().len())
        || resume["open_positions"] != positions
    {
        return Err("prop phase transition position state diverged from canonical replay".into());
    }
    if !snapshot["pending_market_order"].is_null()
        || integer(phase, "pending_orders")? != 0
        || (!resume["pending_orders"].is_null() && resume["pending_orders"] != json!([]))
    {
        return Err("prop phase transition pending state diverged from canonical replay".into());
    }
    if !resume["replay_binding"].is_object()
        || resume["replay_binding"]["last_replay_event_sequence"] != snapshot["event_sequence"]
    {
        return Err("prop replay binding did not advance to the canonical transition event".into());
    }
    Ok(())
}
pub fn validate_replay_prop_transition_boundary(
    snapshot: &Value,
    payload: &Value,
    row_count: i64,
    attempt: &Value,
    phase: &Value,
    resume: &Value,
    spec: &Value,
) -> Result<(), String> {
    validate_replay_prop_binding(snapshot, attempt, phase)?;
    let portfolio = snapshot["schema_version"] == "replay-portfolio-v1";
    for (k, msg) in [
        (
            "dataset_id",
            "replay payload dataset does not match canonical execution",
        ),
        (
            "branch_id",
            "replay payload branch does not match canonical execution",
        ),
        (
            "cursor_index",
            "replay payload cursor does not match canonical execution",
        ),
    ] {
        if (!portfolio || k == "branch_id") && payload[k] != snapshot[k] {
            return Err(msg.into());
        }
    }
    if payload["status"] == "completed" || if portfolio {
        integer(payload,"replay_clock_utc")? >= integer(payload,"replay_end_utc")?
    } else { integer(snapshot, "cursor_index")? >= row_count - 1 } {
        return Err("next phase requires a future replay bar".into());
    }
    let binding = &resume["replay_binding"];
    if !binding.is_object() {
        return Err("prop replay binding is required for canonical phase transition".into());
    }
    for k in [
        "replay_session_id",
        "branch_id",
        "dataset_id",
        "dataset_sha256",
    ] {
        if binding[k] != snapshot[k] {
            return Err("prop replay binding lineage does not match canonical replay".into());
        }
    }
    if portfolio && binding["dataset_pins"] != snapshot["dataset_pins"] {
        return Err("prop portfolio dataset pins changed at phase boundary".into());
    }
    if integer(binding, "last_replay_event_sequence")
        .map_err(|_| "prop replay binding event sequence is invalid")?
        != integer(snapshot, "event_sequence")?
    {
        return Err("canonical replay has unconsumed progression at the phase boundary".into());
    }
    let event = snapshot["ledger"]
        .as_array()
        .and_then(|l| {
            l.iter()
                .rev()
                .find(|e| e["sequence"] == snapshot["event_sequence"])
        })
        .ok_or("phase transition requires the latest canonical replay price mark")?;
    if event["kind"] != "price_mark" {
        return Err("phase transition requires the latest canonical replay price mark".into());
    }
    if !resume["cursor"].is_object() || resume["cursor"]["bar_index"] != snapshot["cursor_index"] {
        return Err("prop resume cursor does not match canonical replay cursor".into());
    }
    let time = DateTime::from_timestamp(integer(event, "virtual_time_utc")?, 0)
        .ok_or("canonical replay boundary event is invalid")?;
    if date_time(&resume["cursor"], "timestamp_utc")
        .map_err(|_| "prop resume cursor timestamp is invalid")?
        != time
        || date_time(phase, "virtual_time_utc")? != time
    {
        return Err("prop virtual time does not match canonical replay boundary".into());
    }
    for k in ["balance", "floating_pl", "equity"] {
        if num(phase, k)? != num(snapshot, k)? {
            return Err("prop money state does not match canonical replay boundary".into());
        }
    }
    if !snapshot["pending_market_order"].is_null() || integer(phase, "pending_orders")? != 0 {
        return Err("phase transition requires zero pending replay orders".into());
    }
    if !resume["pending_orders"].is_null() && resume["pending_orders"] != json!([]) {
        return Err("prop pending order state does not match canonical replay boundary".into());
    }
    let positions = position_list(snapshot);
    if phase["open_positions"] != json!(positions.as_array().unwrap().len()) {
        return Err("prop open position count does not match canonical replay boundary".into());
    }
    if resume["open_positions"] != positions {
        return Err("prop open position state does not match canonical replay boundary".into());
    }
    if !positions.as_array().unwrap().is_empty() {
        if spec["position_policy"] == "close_by_simulator" {
            return Err(
                "close_by_simulator with an open replay position is not supported yet".into(),
            );
        }
        if spec["position_policy"] != "carry" || spec["carry_policy"] != "carry_all" {
            return Err(
                "open replay position is incompatible with the frozen phase carry policy".into(),
            );
        }
    }
    Ok(())
}

/// Inputs must first pass the canonical replay snapshot/ledger validator.
pub fn validate_replay_prop_branch_checkpoint(
    child: &Value,
    payload: &Value,
    parent: &Value,
    attempt: &Value,
    phase: &Value,
    resume: &Value,
) -> Result<(), String> {
    validate_replay_prop_binding(child, attempt, phase)?;
    let portfolio = child["schema_version"] == "replay-portfolio-v1";
    if child["replay_session_id"] == parent["replay_session_id"] {
        return Err("replay branch must use a distinct child session".into());
    }
    if payload["parent_session_id"] != parent["replay_session_id"] {
        return Err("replay branch parent lineage is inconsistent".into());
    }
    if payload["branch_id"] != child["branch_id"] {
        return Err("replay branch payload does not match child execution lineage".into());
    }
    if !portfolio && payload["cursor_index"] != child["cursor_index"] {
        return Err("replay branch payload cursor does not match child execution".into());
    }
    if integer(payload, "parent_checkpoint_event_sequence")
        .map_err(|_| "replay branch checkpoint event sequence is invalid")?
        != integer(child, "event_sequence")?
    {
        return Err(
            "replay branch checkpoint event sequence does not match child execution".into(),
        );
    }
    for key in [
        "dataset_id",
        "dataset_sha256",
        "instrument_spec",
        "cost_model",
        "starting_balance",
        "schema_version",
        "tick_snapshot_id",
        "tick_snapshot_sha256",
        "research_margin",
        "dataset_pins",
        "primary_dataset_sha256",
    ] {
        if child[key] != parent[key] {
            return Err("replay branch immutable execution pins diverged from its parent".into());
        }
    }
    let binding = &resume["replay_binding"];
    if !binding.is_object() {
        return Err("historical prop checkpoint is not bound to Replay".into());
    }
    for key in ["replay_session_id", "branch_id"] {
        if binding[key] != parent[key] {
            return Err("historical prop checkpoint does not match Replay branch boundary".into());
        }
    }
    for key in ["dataset_id", "dataset_sha256"] {
        if binding[key] != child[key] {
            return Err("historical prop checkpoint does not match Replay branch boundary".into());
        }
    }
    if binding["last_replay_event_sequence"] != child["event_sequence"] {
        return Err("historical prop checkpoint does not match Replay branch boundary".into());
    }
    if !resume["cursor"].is_object() || resume["cursor"]["bar_index"] != child["cursor_index"] {
        return Err(
            "historical prop checkpoint cursor does not match Replay branch boundary".into(),
        );
    }
    let cursor_time = date_time(&resume["cursor"], "timestamp_utc")
        .map_err(|_| "historical prop checkpoint timestamp is invalid")?;
    let event = child["ledger"]
        .as_array()
        .and_then(|l| {
            l.iter()
                .rev()
                .find(|e| e["sequence"] == child["event_sequence"])
        })
        .ok_or("replay branch checkpoint event is missing")?;
    let replay_time = DateTime::from_timestamp(integer(event, "virtual_time_utc")?, 0)
        .ok_or("replay branch checkpoint ledger is invalid")?;
    if cursor_time != replay_time || date_time(phase, "virtual_time_utc")? != replay_time {
        return Err("historical prop checkpoint time does not match Replay branch boundary".into());
    }
    for k in ["balance", "floating_pl", "equity"] {
        if num(phase, k)? != num(child, k)? {
            return Err(
                "historical prop checkpoint money does not match Replay branch boundary".into(),
            );
        }
    }
    let positions = position_list(child);
    if phase["open_positions"] != json!(positions.as_array().unwrap().len())
        || resume.get("open_positions").unwrap_or(&json!([])) != &positions
    {
        return Err(
            "historical prop checkpoint position state does not match Replay branch boundary"
                .into(),
        );
    }
    let pending = if portfolio { child["pending_orders"].clone() } else if child["pending_market_order"].is_null() {
        json!([])
    } else {
        json!([child["pending_market_order"]])
    };
    if phase["pending_orders"] != json!(pending.as_array().unwrap().len())
        || resume.get("pending_orders").unwrap_or(&json!([])) != &pending
    {
        return Err(
            "historical prop checkpoint pending state does not match Replay branch boundary".into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod portfolio_tests {
    use super::*;
    #[test]
    fn unknown_intrabar_equity_advances_bookkeeping_without_a_money_verdict() {
        let cases: Value = serde_json::from_str(include_str!(
            "../../evidence/rust-native-20261017/prop/fixtures.json"
        ))
        .unwrap();
        let case = cases
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["name"] == "event-static-fees_then_reset-89900-insufficient")
            .unwrap();
        let args = case["args"].as_array().unwrap();
        let mut resume = args[4].clone();
        resume["replay_binding"] = json!({"schema_version":"replay-portfolio-binding-v1"});
        let result =
            evaluate_prop_lifecycle_event(&args[0], &args[1], &args[2], &args[3], &resume).unwrap();
        assert_eq!(result["attempt"]["status"], "running");
        assert_eq!(result["phase"]["balance"], "89900");
        assert_eq!(
            result["phase"]["last_event_sequence"],
            args[3]["event_sequence"]
        );
        assert_eq!(result["objectives"]["technical_status"], "blocked_by_data");
        assert!(result["objectives"]["terminal_action"].is_null());
        let mut event = args[3].clone();
        event["evaluation_quality"] = json!("full_for_declared_model");
        event["balance_before_separate_costs"] = json!("120000");
        event["event_sequence"] =
            json!(integer(&result["phase"], "last_event_sequence").unwrap() + 1);
        event["expected_revision"] = result["attempt"]["revision"].clone();
        event["operation_id"] = json!("later-flat");
        let later = evaluate_prop_lifecycle_event(
            &args[0],
            &result["attempt"],
            &result["phase"],
            &event,
            &result["resume_state"],
        )
        .unwrap();
        assert_eq!(later["phase"]["balance"], "120000");
        assert_eq!(later["attempt"]["status"], "running");
        assert_eq!(later["objectives"]["technical_status"], "blocked_by_data");
        assert_eq!(later["objectives"]["pass_ready"], false);
        assert_eq!(
            later["resume_state"]["prop_lifecycle"]["unresolved_equity_coverage"],
            true
        );
    }
    #[test]
    fn portfolio_filled_entries_qualify_once_per_local_day() {
        let cases: Value = serde_json::from_str(include_str!(
            "../../evidence/rust-native-20261017/prop/fixtures.json"
        ))
        .unwrap();
        let args = cases
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["name"] == "event-static-fees_then_reset-89900-insufficient")
            .unwrap()["args"]
            .as_array()
            .unwrap()
            .clone();
        let mut current = json!({"attempt":args[1],"phase":args[2],"resume_state":args[4]});
        current["resume_state"]["replay_binding"] =
            json!({"schema_version":"replay-portfolio-binding-v1"});
        let mut event = args[3].clone();
        event["evaluation_quality"] = json!("full_for_declared_model");
        event["balance_before_separate_costs"] = json!("100000");
        let mark = json!({"schema_version":"replay-portfolio-event-v1","kind":"price_mark","sequence":1,
            "replay_session_id":"r","branch_id":"b","virtual_time_utc":1767272400i64,
            "balance":"100000","floating_pl":"0","open_positions":0,"pending_orders":0,"evaluation_quality":"full_for_declared_model",
            "details":{"source_events":[{"kind":"market_fill"}],"intrabar_equity_coverage":"complete"}});
        let translated =
            replay_mark_to_prop_event(&json!({}), &args[0]["profile"]["phases"][0], &mark).unwrap();
        assert_eq!(translated["qualifying_day"], true);
        let mut plain = mark;
        plain["details"]["source_events"] = json!([{"kind":"protection_change"}]);
        assert_eq!(
            replay_mark_to_prop_event(&json!({}), &args[0]["profile"]["phases"][0], &plain)
                .unwrap()["qualifying_day"],
            false
        );
        for (index, (time, boundary, qualifying)) in [
            ("2026-01-01T13:00:00Z", false, true),
            ("2026-01-01T14:00:00Z", false, true),
            ("2026-01-02T00:00:00Z", true, false),
            ("2026-01-02T01:00:00Z", false, true),
        ]
        .iter()
        .enumerate()
        {
            event["expected_revision"] = current["attempt"]["revision"].clone();
            event["event_sequence"] =
                json!(integer(&current["phase"], "last_event_sequence").unwrap() + 1);
            event["virtual_time_utc"] = json!(time);
            event["qualifying_day"] = json!(qualifying);
            event["kind"] = json!(if *boundary {
                "calendar_boundary"
            } else {
                "simulation_snapshot"
            });
            event["operation_id"] = json!(format!("day-{index}"));
            current = evaluate_prop_lifecycle_event(
                &args[0],
                &current["attempt"],
                &current["phase"],
                &event,
                &current["resume_state"],
            )
            .unwrap();
            assert_eq!(
                current["phase"]["qualifying_days"],
                if index < 3 { 1 } else { 2 }
            );
        }
    }
}
