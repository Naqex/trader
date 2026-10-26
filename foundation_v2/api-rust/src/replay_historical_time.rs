//! Dated replay deltas, compacted by observed UTC minute without inventing dates.
use chrono::{DateTime, Utc};
use serde_json::{Value, json};

const SCHEMA: &str = "replay-historical-activity-v1";

fn utc(value: &Value) -> Option<DateTime<Utc>> {
    let stamp = DateTime::parse_from_rfc3339(value.as_str()?).ok()?;
    (stamp.offset().local_minus_utc() == 0).then(|| stamp.with_timezone(&Utc))
}

pub(super) fn fresh(stamp: &str) -> Value {
    json!({"schema_version":SCHEMA,"started_at_utc":stamp,"baseline_seconds":0,"buckets":{}})
}

// Baseline is deliberately undated. Only deltas committed after this epoch are
// attributable to activity dates, including old sessions with a zero counter.
pub(super) fn capture(prior: &Value, timing: &mut Value, stamp: &str) -> Result<(), String> {
    let before = prior["historical_time_replayed_seconds"].as_i64().unwrap_or(0);
    let after = timing["historical_time_replayed_seconds"].as_i64().unwrap_or(0);
    let delta = after.checked_sub(before).filter(|v| *v >= 0)
        .ok_or("replay historical counter regressed")?;
    if delta == 0 { return Ok(()) }
    if timing["schema_version"] != "replay-timing-v1" || before < 0 {
        return Err("invalid replay historical timing".into());
    }
    let observed = utc(&json!(stamp)).ok_or("invalid replay activity timestamp")?;
    let mut previous = timing.clone();
    previous["historical_time_replayed_seconds"] = json!(before);
    if previous["historical_activity"].is_null() {
        previous["historical_activity"] = fresh(stamp);
        previous["historical_activity"]["baseline_seconds"] = json!(before);
    }
    let ((start, _, buckets), recorded) = recording(&previous).ok_or("invalid replay historical recording")?;
    if recorded > before { return Err("replay historical recording exceeds its counter".into()) }
    if observed < start || buckets.iter().any(|(_, last, _)| *last > observed) {
        return Err("replay activity clock regressed".into());
    }
    if recorded < before {
        // A compatible older runtime advances the cumulative counter but ignores
        // this optional recording. Its undated gap invalidates prior attribution.
        previous["historical_activity"] = fresh(stamp);
        previous["historical_activity"]["baseline_seconds"] = json!(before);
    }
    let key = observed.timestamp().div_euclid(60).to_string();
    let recording = &mut previous["historical_activity"];
    if recording["buckets"][&key].is_null() {
        recording["buckets"][&key] = json!({"first_at_utc":stamp,"last_at_utc":stamp,"seconds":delta});
    } else {
        let bucket = &mut recording["buckets"][&key];
        let seconds = bucket["seconds"].as_i64().unwrap().checked_add(delta)
            .ok_or("replay historical recording overflow")?;
        bucket["last_at_utc"] = json!(stamp);
        bucket["seconds"] = json!(seconds);
    }
    timing["historical_activity"] = previous["historical_activity"].take();
    Ok(())
}

type Bucket = (DateTime<Utc>, DateTime<Utc>, i64);
type Recording = (DateTime<Utc>, i64, Vec<Bucket>);
fn recording(timing: &Value) -> Option<(Recording, i64)> {
    if timing["schema_version"] != "replay-timing-v1" { return None }
    let recording = &timing["historical_activity"];
    if recording["schema_version"] != SCHEMA { return None }
    let start = utc(&recording["started_at_utc"])?;
    let baseline = recording["baseline_seconds"].as_i64().filter(|v| *v >= 0)?;
    let mut total = baseline;
    let mut buckets = vec![];
    for (key, bucket) in recording["buckets"].as_object()? {
        let minute = key.parse::<i64>().ok()?;
        let first = utc(&bucket["first_at_utc"])?;
        let last = utc(&bucket["last_at_utc"])?;
        let seconds = bucket["seconds"].as_i64().filter(|v| *v > 0)?;
        if first < start || first > last || first.timestamp().div_euclid(60) != minute
            || last.timestamp().div_euclid(60) != minute { return None }
        total = total.checked_add(seconds)?;
        buckets.push((first, last, seconds));
    }
    Some(((start, baseline, buckets), total))
}
fn validated(timing: &Value) -> Option<Recording> {
    let (recording, total) = recording(timing)?;
    (Some(total) == timing["historical_time_replayed_seconds"].as_i64()).then_some(recording)
}

pub(crate) fn period(timing: &Value, from: Option<DateTime<Utc>>, to: Option<DateTime<Utc>>) -> Option<i64> {
    let (start, baseline, buckets) = match validated(timing) {
        Some(recording) => recording,
        None if timing["historical_activity"].is_null()
            && timing["schema_version"] == "replay-timing-v1"
            && timing["legacy_baseline"] == false
            && timing["historical_time_replayed_seconds"].as_i64() == Some(0) => return Some(0),
        None => return None,
    };
    if (baseline > 0 || timing["legacy_baseline"] != false) && from.is_none_or(|bound| bound < start) {
        return None;
    }
    let mut total: i64 = 0;
    for (first, last, seconds) in buckets {
        if from.is_some_and(|bound| last < bound) || to.is_some_and(|bound| first > bound) { continue }
        // Day filters align with minute boundaries. Arbitrary subminute filters
        // crossing a compacted bucket cannot be reconstructed exactly.
        if from.is_some_and(|bound| first < bound) || to.is_some_and(|bound| last > bound) { return None }
        total = total.checked_add(seconds)?;
    }
    Some(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn timing() -> Value {
        json!({"schema_version":"replay-timing-v1","legacy_baseline":false,
            "historical_time_replayed_seconds":0,"historical_activity":fresh("2026-10-01T00:00:00Z")})
    }
    fn step(t: &mut Value, seconds: i64, stamp: &str) {
        let prior = t.clone();
        t["historical_time_replayed_seconds"] = json!(prior["historical_time_replayed_seconds"].as_i64().unwrap() + seconds);
        capture(&prior, t, stamp).unwrap();
    }
    fn date(s: &str) -> Option<DateTime<Utc>> { utc(&json!(s)) }
    #[test]
    fn minute_compaction_keeps_exact_timezone_day_boundaries_and_outside_zero() {
        let mut t = timing();
        step(&mut t, 60, "2026-10-24T16:59:50Z");
        step(&mut t, 120, "2026-10-24T17:00:01Z");
        step(&mut t, 180, "2026-10-24T17:00:55Z");
        assert_eq!(t["historical_activity"]["buckets"].as_object().unwrap().len(), 2);
        let from = date("2026-10-24T17:00:00Z"); // Midnight Asia/Ho_Chi_Minh.
        let to = date("2026-10-25T16:59:59.999Z");
        assert_eq!(period(&t, from, to), Some(300));
        assert_eq!(period(&t, date("2026-10-24T17:00:20Z"), to), None);
        assert_eq!(period(&t, date("2026-11-01T00:00:00Z"), None), Some(0));
        assert_eq!(period(&t, None, date("2026-10-24T16:59:49Z")), Some(0));
        assert_eq!(t["historical_time_replayed_seconds"], 360);
    }
    #[test]
    fn legacy_baseline_never_acquires_a_date_and_fresh_zero_is_known() {
        let mut old = json!({"schema_version":"replay-timing-v1","legacy_baseline":false,"historical_time_replayed_seconds":86400});
        step(&mut old, 60, "2026-10-24T17:00:01Z");
        assert_eq!(old["historical_activity"]["baseline_seconds"], 86400);
        assert_eq!(period(&old, date("2026-10-24T17:00:00Z"), None), None);
        assert_eq!(period(&old, date("2026-10-24T17:00:01Z"), None), Some(60));
        let mut legacy = json!({"schema_version":"replay-timing-v1","legacy_baseline":true,"historical_time_replayed_seconds":0});
        step(&mut legacy, 30, "2026-10-24T17:00:01Z");
        assert_eq!(period(&legacy, None, None), None);
        assert_eq!(period(&legacy, date("2026-10-24T17:00:01Z"), None), Some(30));
        assert_eq!(period(&timing(), None, None), Some(0));
    }
    #[test]
    fn final_microsecond_of_local_day_is_included() {
        let mut t = timing();
        step(&mut t, 60, "2026-10-25T16:59:59.999999Z");
        assert_eq!(period(&t, date("2026-10-24T17:00:00Z"), date("2026-10-25T16:59:59.999999999Z")), Some(60));
        assert_eq!(period(&t, date("2026-10-25T17:00:00Z"), None), Some(0));
    }
    #[test]
    fn rollback_steps_become_an_undated_baseline_and_do_not_block_reupgrade() {
        let mut t = timing();
        step(&mut t, 60, "2026-10-24T17:00:10Z");
        // The previous runtime only knows this cumulative counter.
        t["historical_time_replayed_seconds"] = json!(180);
        assert_eq!(period(&t, None, None), None);
        step(&mut t, 120, "2026-10-25T17:00:10Z");
        assert_eq!(t["historical_time_replayed_seconds"],300);
        assert_eq!(t["historical_activity"]["baseline_seconds"],180);
        assert_eq!(period(&t,date("2026-10-24T00:00:00Z"),None),None);
        assert_eq!(period(&t,date("2026-10-25T17:00:10Z"),None),Some(120));
        assert_eq!(t["historical_activity"]["buckets"].as_object().unwrap().len(),1);
        let prior=t.clone();
        t["historical_time_replayed_seconds"]=json!(360);
        t["historical_activity"]["baseline_seconds"]=json!(400);
        assert!(capture(&prior,&mut t,"2026-10-25T17:00:11Z").is_err());
    }
    #[test]
    fn invalid_recordings_and_clock_regression_are_rejected() {
        let mut t = timing(); step(&mut t, 60, "2026-10-24T17:00:10Z");
        let clean = t.clone();
        t["historical_time_replayed_seconds"] = json!(61);
        assert_eq!(period(&t, None, None), None);
        t = clean.clone();
        let key = t["historical_activity"]["buckets"].as_object().unwrap().keys().next().unwrap().clone();
        t["historical_activity"]["buckets"][&key]["first_at_utc"] = json!("2026-10-24T18:00:10+01:00");
        assert_eq!(period(&t, None, None), None);
        t = clean.clone(); t["historical_time_replayed_seconds"] = json!(120);
        assert!(capture(&clean, &mut t, "2026-10-24T17:00:09Z").is_err());
        assert!(capture(&clean, &mut t, "2026-10-24T18:00:11+01:00").is_err());
        assert!(capture(&clean, &mut timing(), "2026-10-24T17:00:11Z").is_err());
    }
}
