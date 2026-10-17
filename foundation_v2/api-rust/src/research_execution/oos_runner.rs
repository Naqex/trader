//! Chronological OOS computation and declared cost stress.
use crate::research_jobs;
use bigdecimal::BigDecimal;
use serde_json::{Value, json};
use sha2::Digest;
use std::{
    str::FromStr,
    time::{Duration, Instant},
};
type R<T> = Result<T, String>;
fn integer(value: &Value, name: &str, minimum: u64) -> R<u64> {
    value
        .as_u64()
        .filter(|v| *v >= minimum)
        .ok_or_else(|| format!("{name} must be an integer >= {minimum}"))
}
fn number(value: &Value) -> R<BigDecimal> {
    let raw=value
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| value.to_string());
    if raw.len()>512{return Err("stress decimal exceeds safety budget".into());}
    let parsed=BigDecimal::from_str(&raw).map_err(|_|"invalid stress decimal")?;
    if parsed.as_bigint_and_exponent().1.unsigned_abs()>512{return Err("stress decimal exceeds safety budget".into());}Ok(parsed)
}
fn range(timestamps: &[i64], start: usize, stop: usize, timeframe: i64) -> Value {
    if start >= stop {
        json!({"start_index":start,"stop_index":stop,"bar_count":0,"from_utc":null,"to_utc":null})
    } else {
        json!({"start_index":start,"stop_index":stop,"bar_count":stop-start,"from_utc":timestamps[start],"to_utc":timestamps[stop-1]+timeframe})
    }
}

pub fn materialize_regime(protocol:&Value,rows:&[Value],manifest:&Value)->R<Option<Value>>{
    let Some(request)=protocol.get("regime_partition").filter(|v|!v.is_null())else{return Ok(None)};
    if request["schema"]!="regime-partition-request-v1"{return Err("regime partition request is invalid".into());}
    let object=request.as_object().ok_or("regime partition request is invalid")?;
    if object.len()!=5||object.keys().any(|k|!matches!(k.as_str(),"schema"|"regime_field"|"known_at_field"|"max_regimes"|"max_segments")){return Err("regime partition request changed after job creation".into());}
    let result=(||{
        let field=request["regime_field"].as_str().ok_or("invalid regime field")?;let known=request["known_at_field"].as_str().ok_or("invalid regime field")?;
        let safe=|s:&str|!s.is_empty()&&s.len()<=64&&s.bytes().enumerate().all(|(i,b)|b==b'_'||b.is_ascii_alphabetic()||(i>0&&b.is_ascii_digit()));
        if !safe(field)||!safe(known)||field==known{return Err("invalid regime field".into());}
        let max_regimes=integer(&request["max_regimes"],"max_regimes",1)?;let max_segments=integer(&request["max_segments"],"max_segments",1)?;
        if max_regimes>64||max_segments>100000{return Err("invalid regime budget".into());}
        let cutoff=protocol["range"]["to_utc"].as_i64().ok_or("invalid cutoff")?;let timeframe=manifest["timeframe_seconds"].as_i64().filter(|v|*v>0).ok_or("invalid timeframe")?;
        let holdout=&manifest["holdout_policy"];let boundary=match holdout["mode"].as_str().unwrap_or("none"){"none"=>None,"metadata_only"=>Some(holdout["from_utc"].as_i64().filter(|v|*v>=0).ok_or("invalid holdout")?),_=>return Err("invalid holdout".into())};
        if rows.is_empty(){return Err("missing regime rows".into());}
        let mut times=Vec::new();let mut labels=Vec::new();let mut known_times=Vec::new();let mut unique=std::collections::BTreeSet::new();
        for row in rows{
            let t=row["timestamp"].as_i64().ok_or("invalid regime timestamp")?;let k=row[known].as_i64().filter(|k|*k>=0&&*k<=t&&*k<=cutoff).ok_or("invalid regime known_at")?;
            if t>=cutoff||boundary.is_some_and(|b|t+timeframe>b)||times.last().is_some_and(|previous|t-*previous<timeframe){return Err("invalid regime chronology".into());}
            let label=row[field].as_str().ok_or("invalid regime label")?;if label.is_empty()||label.len()>64||!label.bytes().enumerate().all(|(i,b)|b.is_ascii_alphanumeric()||(i>0&&matches!(b,b'.'|b'_'|b'-'))){return Err("invalid regime label".into());}
            unique.insert(label.to_owned());times.push(t);labels.push(label.to_owned());known_times.push(k);
        }
        if unique.len() as u64>max_regimes{return Err("regime budget exceeded".into());}
        let mut segments=Vec::new();let mut start=0;
        while start<labels.len(){let mut stop=start+1;while stop<labels.len()&&labels[stop]==labels[start]{stop+=1;}
            if segments.len() as u64>=max_segments{return Err("regime budget exceeded".into());}
            let mut segment=range(&times,start,stop,timeframe);segment["segment_id"]=json!(format!("segment-{:05}",segments.len()+1));segment["label"]=json!(labels[start]);segment["known_at_utc"]=json!(known_times[start]);segments.push(segment);start=stop;
        }
        let summaries:Vec<Value>=unique.iter().map(|label|{let matching:Vec<_>=segments.iter().filter(|s|s["label"]==*label).collect();json!({"label":label,"bar_count":matching.iter().map(|s|s["bar_count"].as_u64().unwrap()).sum::<u64>(),"segment_count":matching.len()})}).collect();
        let mut request=request.clone();request.as_object_mut().unwrap().remove("schema");
        Ok(json!({"schema":"regime-segmentation-v1","causal_status":"as-of","source":{"regime_field":field,"known_at_field":known},"timeframe_seconds":timeframe,"holdout":{"access":false,"from_utc":boundary},"label_count":unique.len(),"segment_count":segments.len(),"labels":summaries,"segments":segments,"cutoff_timestamp":cutoff,"request":request}))
    })();
    result.map(Some).map_err(|_:String|"regime partition cannot be materialized".into())
}

pub fn regime_metrics(partition:&Value,ledger:&[Value],balance:&Value)->R<Value>{
    if partition["schema"]!="regime-segmentation-v1"{return Err("regime partition is invalid".into());}
    let segments=partition["segments"].as_array().filter(|s|!s.is_empty()).ok_or("regime partition requires segments")?;
    let mut labels=Vec::new();let mut starts=Vec::new();let mut previous=None;
    for(index,segment)in segments.iter().enumerate(){
        if !segment.is_object(){return Err(format!("regime segment {index} is invalid"));}
        let label=segment["label"].as_str().ok_or_else(||format!("regime segment {index} has an invalid range"))?;
        let from=segment["from_utc"].as_i64().filter(|v|*v>=0).ok_or_else(||format!("regime segment {index} has an invalid range"))?;let to=segment["to_utc"].as_i64().filter(|v|*v>from).ok_or_else(||format!("regime segment {index} has an invalid range"))?;
        if previous.is_some_and(|p|p!=from){return Err("regime segments must be contiguous and chronological".into());}previous=Some(to);starts.push(from);if !labels.contains(&label){labels.push(label);}
    }
    let cutoff=partition["cutoff_timestamp"].as_i64().unwrap_or(previous.unwrap());if cutoff<previous.unwrap(){return Err("regime cutoff precedes partition range".into());}
    let mut groups=std::collections::HashMap::<&str,Vec<Value>>::new();let mut cross=std::collections::HashMap::<&str,u64>::new();for label in &labels{groups.insert(label,vec![]);cross.insert(label,0);}
    for(index,trade)in ledger.iter().enumerate(){
        if !trade.is_object(){return Err(format!("ledger[{index}] must be an object"));}
        let open=trade["open_time_utc"].as_i64().filter(|v|*v>=0).ok_or_else(||format!("ledger[{index}].open_time_utc must be a nonnegative integer timestamp"))?;
        let stop=starts.partition_point(|v|*v<=open);if stop==0{return Err(format!("ledger[{index}] entry timestamp is outside the regime partition"));}let segment=&segments[stop-1];let end=segment["to_utc"].as_i64().unwrap();if open>=end||open>=cutoff{return Err(format!("ledger[{index}] entry timestamp is outside the regime partition"));}
        let label=segment["label"].as_str().unwrap();if !trade["close_time_utc"].is_null(){let close=trade["close_time_utc"].as_i64().filter(|v|*v>=open).ok_or_else(||format!("ledger[{index}].close_time_utc must be an integer no earlier than entry"))?;if close>cutoff{return Err(format!("ledger[{index}] close timestamp exceeds the regime cutoff"));}if close>=end{*cross.get_mut(label).unwrap()+=1;}}
        groups.get_mut(label).unwrap().push(trade.clone());
    }
    let mut metrics=Vec::new();for label in labels{let selected=&groups[label];metrics.push(json!({"label":label,"trade_count":selected.len(),"cross_segment_trade_count":cross[label],"metrics":crate::analytics::compute_metrics_v2(selected,balance)?}));}
    Ok(json!({"schema":"regime-metrics-v1","assignment":{"policy":"entry_timestamp_segment","entry_time_field":"open_time_utc","close_time_field":"close_time_utc","cross_segment_policy":"assigned_to_entry_regime_and_counted"},"metrics_scope":"entry_regime_trade_subset","starting_balance_scope":"run_starting_balance","holdout_access":false,"cutoff_timestamp":cutoff,"trade_count":ledger.len(),"unassigned_trade_count":0,"cross_segment_trade_count":cross.values().sum::<u64>(),"labels":metrics}))
}
pub fn walk_forward_plan(
    rows: &[Value],
    timeframe: i64,
    request: &Value,
    holdout: &Value,
) -> R<Value> {
    if timeframe <= 0 {
        return Err("timeframe_seconds must be an integer >= 1".into());
    }
    let train = integer(&request["train_bars"], "train_bars", 1)? as usize;
    let oos = integer(&request["oos_bars"], "oos_bars", 1)? as usize;
    let step = if request["step_bars"].is_null() {
        oos
    } else {
        integer(&request["step_bars"], "step_bars", 1)? as usize
    };
    let default = json!(0);
    let purge = integer(
        request.get("purge_bars").unwrap_or(&default),
        "purge_bars",
        0,
    )? as usize;
    let embargo = integer(
        request.get("embargo_bars").unwrap_or(&default),
        "embargo_bars",
        0,
    )? as usize;
    let overlap = integer(
        request.get("overlap_bars").unwrap_or(&default),
        "overlap_bars",
        0,
    )? as usize;
    let max = integer(
        request.get("max_folds").unwrap_or(&json!(20)),
        "max_folds",
        1,
    )? as usize;
    if max > 10000 {
        return Err("max_folds must be <= 10000".into());
    }
    let expanding = request
        .get("expanding")
        .unwrap_or(&Value::Bool(true))
        .as_bool()
        .ok_or("expanding must be boolean")?;
    if purge < overlap {
        return Err("purge_bars is smaller than the declared overlap_bars".into());
    }
    if purge >= train {
        return Err("purge_bars must leave at least one training bar".into());
    }
    if rows.is_empty() {
        return Err("walk-forward planning requires source rows".into());
    }
    let timestamps = rows
        .iter()
        .map(|r| {
            r["timestamp"]
                .as_i64()
                .ok_or("source rows require integer timestamps".into())
        })
        .collect::<R<Vec<_>>>()?;
    if timestamps.windows(2).any(|w| w[0] >= w[1]) {
        return Err("source rows must be strictly chronological".into());
    }
    if timestamps.windows(2).any(|w| w[1] - w[0] < timeframe) {
        return Err("source rows overlap the declared timeframe".into());
    }
    let mode = holdout["mode"].as_str().unwrap_or("none");
    let boundary = match mode {
        "none" => None,
        "metadata_only" => Some(
            holdout["from_utc"]
                .as_i64()
                .ok_or("holdout from_utc must be integer")?,
        ),
        _ => return Err("U5c planning never authorizes holdout content access".into()),
    };
    if boundary.is_some_and(|end| {
        timestamps
            .iter()
            .any(|t| t.checked_add(timeframe).is_none_or(|t| t > end))
    }) {
        return Err("source rows reach locked holdout data".into());
    }
    let mut folds = Vec::new();
    let mut split = train;
    while folds.len() < max {
        let Some(stop) = split.checked_add(embargo).and_then(|v| v.checked_add(oos)) else {
            break;
        };
        if stop > timestamps.len() {
            break;
        }
        let start = if expanding { 0 } else { split - train };
        folds.push(json!({"fold":folds.len()+1,"train":range(&timestamps,start,split-purge,timeframe),"purge":range(&timestamps,split-purge,split,timeframe),"embargo":range(&timestamps,split,split+embargo,timeframe),"oos":range(&timestamps,split+embargo,stop,timeframe)}));
        let Some(next) = split.checked_add(step) else {
            break;
        };
        split = next;
    }
    if folds.is_empty() {
        return Err("not enough pre-holdout rows for one walk-forward fold".into());
    }
    Ok(
        json!({"schema":"walk-forward-plan-v1","chronology":"train-purge-embargo-oos","expanding":expanding,"timeframe_seconds":timeframe,
        "train_bars":train,"oos_bars":oos,"step_bars":step,"purge_bars":purge,"embargo_bars":embargo,"overlap_bars":overlap,"holdout":{"access":false,"from_utc":boundary},"fold_count":folds.len(),"folds":folds}),
    )
}
pub fn materialize(protocol: &Value, rows: &[Value], manifest: &Value) -> R<Option<Value>> {
    let Some(validation) = protocol.get("validation").filter(|v| !v.is_null()) else {
        return Ok(None);
    };
    if validation["schema"] != "research-oos-validation-v1" {
        return Err("research validation protocol is invalid".into());
    }
    if validation["holdout_access"] != false {
        return Err("research validation protocol cannot authorize holdout content".into());
    }
    let mut walk = validation["walk_forward_request"]
        .as_object()
        .ok_or("research validation protocol is incomplete")?
        .clone();
    if !validation["sweep_request"].is_object() {
        return Err("research validation protocol is incomplete".into());
    }
    walk.insert(
        "stress_scenarios".into(),
        validation
            .get("stress_request")
            .cloned()
            .unwrap_or(json!([])),
    );
    let rebuilt = research_jobs::oos::canonical_oos_request(
        &protocol["playbook"]["rules"],
        &Value::Object(walk),
        &validation["sweep_request"]["parameter_space"],
        validation["sweep_request"]["max_trials"]
            .as_u64()
            .ok_or("research validation protocol cannot be reconstructed")?,
    )
    .map_err(|_| "research validation protocol cannot be reconstructed")?;
    let mut request = validation.clone();
    request
        .as_object_mut()
        .ok_or("research validation protocol is invalid")?
        .remove("walk_forward");
    if request != rebuilt {
        return Err("research validation protocol changed after job creation".into());
    }
    let plan = walk_forward_plan(
        rows,
        manifest["timeframe_seconds"]
            .as_i64()
            .ok_or("research validation plan cannot be materialized")?,
        &rebuilt["walk_forward_request"],
        &manifest["holdout_policy"],
    )
    .map_err(|_| "research validation plan cannot be materialized")?;
    if validation
        .get("walk_forward")
        .is_some_and(|v| !v.is_null() && v != &plan)
    {
        return Err("research validation protocol changed after job creation".into());
    }
    let mut result = rebuilt;
    result["walk_forward"] = plan;
    Ok(Some(result))
}
pub fn apply_stress(protocol: &Value, scenario: &Value) -> R<Value> {
    let mut result = protocol.clone();
    let fields = [
        ("spread_price", "spread_price_multiplier"),
        ("commission_per_side_account", "commission_multiplier"),
        ("minimum_fee_account", "minimum_fee_multiplier"),
        ("slippage_price_per_side", "slippage_multiplier"),
        ("financing_account", "financing_multiplier"),
    ];
    for (index, (field, multiplier)) in fields.iter().enumerate() {
        let source = if index == 0 {
            &protocol["parameters"][*field]
        } else {
            &protocol["parameters"]["cost_model"][*field]
        };
        let value = if source.is_null() {
            BigDecimal::from(0)
        } else {
            number(source)?
        };
        let value = (value * number(&scenario[*multiplier])?)
            .with_prec(28)
            .normalized()
            .to_plain_string();
        if index == 0 {
            result["parameters"][*field] = json!(value)
        } else {
            result["parameters"]["cost_model"][*field] = json!(value)
        };
    }
    if scenario["scenario_id"] != "base" {
        result["parameters"]["cost_model"]["version"] = json!(format!(
            "{}|stress:{}",
            protocol["parameters"]["cost_model"]["version"]
                .as_str()
                .ok_or("invalid cost version")?,
            scenario["scenario_id"].as_str().ok_or("invalid scenario")?
        ));
    }
    result["stress_scenario"] = scenario.clone();
    Ok(result)
}
pub fn execute(
    rows: &[Value],
    protocol: &Value,
    manifest: &Value,
    engine_hash: &str,
    continue_check: impl Fn() -> R<()>,
    mut checkpoint: impl FnMut(&[Value]) -> R<()>,
) -> R<Value> {
    let deadline = Instant::now()
        + Duration::from_millis(integer(
            &protocol["budget"]["max_runtime_ms"],
            "budget.max_runtime_ms",
            1,
        )?);
    execute_with_engine(rows,protocol,manifest,deadline,&continue_check,&mut checkpoint,|source,slice,deadline|super::reference::execute_breakout_until(source,slice,engine_hash,&continue_check,deadline))
}

pub fn execute_with_engine(
    rows:&[Value],protocol:&Value,manifest:&Value,deadline:Instant,
    continue_check:impl Fn()->R<()>,mut checkpoint:impl FnMut(&[Value])->R<()>,
    mut run_engine:impl FnMut(&[Value],&Value,Instant)->R<Value>,
)->R<Value>{
    let validation = materialize(protocol, rows, manifest)?.ok_or("research validation protocol is incomplete")?;
    let partition=materialize_regime(protocol,rows,manifest)?;
    let mut trials = Vec::new();
    let mut outcomes = Vec::new();
    let mut completed = 0;
    let mut failed = 0;
    for trial in validation["sweep"]["trials"]
        .as_array()
        .ok_or("sweep plan is missing trials")?
    {
        continue_check()?;
        if Instant::now() >= deadline {
            return Err("run exceeded budget.max_runtime_ms".into());
        }
        let mut trial_result = json!({"trial_id":trial["trial_id"],"parameters":trial["parameters"],"status":"completed","folds":[]});
        for fold in validation["walk_forward"]["folds"]
            .as_array()
            .ok_or("walk-forward plan is missing folds")?
        {
            let mut fold_result =
                json!({"fold":fold["fold"],"status":"completed","stress_scenarios":[]});
            for scenario in validation["stress"]["scenarios"]
                .as_array()
                .ok_or("stress plan is missing scenarios")?
            {
                let mut scenario_result = json!({"scenario_id":scenario["scenario_id"],"config":scenario,"status":"completed"});
                for (segment, split) in [("train", "train"), ("oos", "validation")] {
                    let range = &fold[segment];
                    let start = range["start_index"].as_u64().ok_or("invalid fold range")? as usize;
                    let stop = range["stop_index"].as_u64().ok_or("invalid fold range")? as usize;
                    let mut slice = protocol.clone();
                    slice.as_object_mut().unwrap().remove("validation");
                    slice["split"] = json!(split);
                    slice["range"] = json!({"from_utc":range["from_utc"],"to_utc":range["to_utc"]});
                    slice["playbook"]["rules"]
                        .as_object_mut()
                        .ok_or("invalid rules")?
                        .extend(
                            trial["parameters"]
                                .as_object()
                                .ok_or("invalid trial parameters")?
                                .clone(),
                        );
                    slice = apply_stress(&slice, scenario)?;
                    continue_check()?;
                    if Instant::now()>=deadline{return Err("run exceeded budget.max_runtime_ms".into());}
                    let slice_rows=rows.get(start..stop).ok_or("invalid fold range")?;
                    let result = run_engine(slice_rows,&slice,deadline).and_then(|value|{
                        let mut artifact=value.clone();artifact["artifact_schema_version"]=json!("research-engine-result-v1");artifact["protocol"]=slice.clone();artifact["protocol_sha256"]=json!(format!("{:x}",sha2::Sha256::digest(research_jobs::canonical_py_json(&slice)?)));
                        for(key,expected)in [("playbook_id",&slice["playbook"]["record_id"]),("playbook_revision",&slice["playbook"]["revision"]),("dataset_sha256",&slice["dataset"]["artifact_sha256"]),("engine_code_sha256",&slice["engine"]["code_sha256"]),("split",&slice["split"])]{artifact[key]=expected.clone();}
                        super::reference::independent::validate(&artifact,slice_rows,&continue_check)?;
                        let mut summary=json!({"status":"completed","metrics":value["metrics"],"signals":value["signals"],"trade_count":value["ledger"].as_array().ok_or("research ledger is invalid")?.len(),"observed_range":value["observed_range"]});
                        if let Some(partition)=&partition{summary["regime_metrics"]=regime_metrics(partition,value["ledger"].as_array().unwrap(),&protocol["starting_balance"])?;}
                        Ok(summary)
                    });
                    match result {
                        Ok(value) => {
                            scenario_result[segment] = value
                        }
                        Err(error) => {
                            if error == "run exceeded budget.max_runtime_ms"
                                || error == "research execution interrupted"
                                || error == "research_execution_interrupted"
                            {
                                return Err(error);
                            }
                            scenario_result[segment] = json!({"status":"failed","error":error.chars().take(500).collect::<String>()});
                            scenario_result["status"] = json!("failed");
                            fold_result["status"] = json!("failed");
                            trial_result["status"] = json!("failed");
                        }
                    }
                }
                if scenario["scenario_id"] == "base" {
                    fold_result["train"] = scenario_result["train"].clone();
                    fold_result["oos"] = scenario_result["oos"].clone();
                }
                fold_result["stress_scenarios"]
                    .as_array_mut()
                    .unwrap()
                    .push(scenario_result);
            }
            trial_result["folds"]
                .as_array_mut()
                .unwrap()
                .push(fold_result);
        }
        if trial_result["status"] == "completed" {
            completed += 1
        } else {
            failed += 1;
        }
        outcomes.push(json!({"trial_id":trial["trial_id"],"status":trial_result["status"]}));
        trials.push(trial_result);
        checkpoint(&outcomes)?;
    }
    Ok(
        json!({"validation":validation,"trials":trials,"terminal_outcomes":outcomes,"outcome_summary":{"schema":"bounded-parameter-sweep-summary-v1","trial_count":completed+failed,"fully_accounted":true,"status_counts":{"canceled":0,"completed":completed,"failed":failed}}}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "run rust_regime_oracle.py with its generated Python oracle"]
    fn python_regime_oracle() {
        let path = std::env::var("TW_REGIME_ORACLE").unwrap();
        let cases: Vec<Value> = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert!(cases.len() >= 60);
        let mut failures = Vec::new();
        for case in &cases {
            let actual = if case["kind"] == "partition" {
                materialize_regime(&case["protocol"],case["rows"].as_array().unwrap(),&case["manifest"])
                    .map(|v|v.unwrap_or(Value::Null))
            } else {
                regime_metrics(&case["partition"],case["ledger"].as_array().unwrap(),&case["balance"])
            };
            match actual {
                Ok(value) => {
                    if let Some(expected) = case["expected"].get("value") {
                        if let Err(error) = super::super::reference::tests::compare(&value,expected,"") {
                            failures.push(format!("{}: {error}",case["name"]));
                        }
                    } else { failures.push(format!("{}: unexpected success",case["name"])); }
                }
                Err(error) => if case["expected"]["error"] != error {
                    failures.push(format!("{}: {error} != {}",case["name"],case["expected"]));
                }
            }
        }
        assert!(failures.is_empty(),"{}",failures.join("\n"));
    }
    #[test]
    fn interruption_deadline_and_checkpoint_failure_are_terminal(){
        let path=format!("{}/../evidence/rust-native-20261017/runtime/oos-execution/oracle.json",env!("CARGO_MANIFEST_DIR"));let cases:Vec<Value>=serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();let case=&cases[0];let rows=case["rows"].as_array().unwrap();
        assert_eq!(execute(rows,&case["protocol"],&case["manifest"],"engine-fixed-hash",||Err("research_execution_interrupted".into()),|_|Ok(())).unwrap_err(),"research_execution_interrupted");
        assert_eq!(execute(rows,&case["protocol"],&case["manifest"],"engine-fixed-hash",||Ok(()),|_|Err("checkpoint lease lost".into())).unwrap_err(),"checkpoint lease lost");
        let mut protocol=case["protocol"].clone();protocol["budget"]["max_runtime_ms"]=json!(1);
        let call=std::sync::atomic::AtomicBool::new(false);
        let result=execute(rows,&protocol,&case["manifest"],"engine-fixed-hash",||{if !call.swap(true,std::sync::atomic::Ordering::SeqCst){std::thread::sleep(Duration::from_millis(3));}Ok(())},|_|Ok(()));
        assert_eq!(result.unwrap_err(),"run exceeded budget.max_runtime_ms");
    }
    #[test]
    fn python_oos_oracle() {
        let path = format!(
            "{}/../evidence/rust-native-20261017/runtime/oos-execution/oracle.json",
            env!("CARGO_MANIFEST_DIR")
        );
        let cases: Vec<Value> = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert!(cases.len() >= 80);
        let mut failures = Vec::new();
        for (index, case) in cases.iter().enumerate() {
            let result = execute(
                case["rows"].as_array().unwrap(),
                &case["protocol"],
                &case["manifest"],
                "engine-fixed-hash",
                || Ok(()),
                |_| Ok(()),
            );
            match result {
                Ok(value) => {
                    if let Some(text) = case["expected"]["canonical"].as_str() {
                        let expected: Value = serde_json::from_str(text).unwrap();
                        if let Err(error) =
                            super::super::reference::tests::compare(&value, &expected, "")
                        {
                            failures.push(format!("case{index}: {error}"));
                        }
                    } else {
                        failures.push(format!("case{index}: unexpected success"));
                    }
                }
                Err(error) => {
                    if json!(error) != case["expected"]["error"] {
                        failures.push(format!(
                            "case{index}: {error} != {}",
                            case["expected"]["error"]
                        ));
                    }
                }
            }
        }
        assert!(
            failures.is_empty(),
            "{} failures: {:?}",
            failures.len(),
            &failures[..failures.len().min(10)]
        );
    }
}
