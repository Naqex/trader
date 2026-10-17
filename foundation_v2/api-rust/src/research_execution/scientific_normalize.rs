//! Scientific engines supply fills; Rust owns monetary accounting and metrics.
use crate::{analytics, replay_core};
use bigdecimal::{BigDecimal, ToPrimitive, Zero};
use serde_json::{Value,json};

type R<T>=Result<T,String>;
fn decimal(value:&Value)->R<BigDecimal>{replay_core::d(value)}
fn numeric(value:BigDecimal)->R<Value>{value.to_f64().filter(|v|v.is_finite()).map(|v|json!(v)).ok_or("scientific output must be finite".into())}
fn positive(value:&Value)->R<BigDecimal>{let n=decimal(value)?;if n<=BigDecimal::zero(){Err("scientific amount must be positive".into())}else{Ok(n)}}
fn timestamp(fill:&Value)->R<i64>{fill["timestamp_ns"].as_i64().filter(|v|*v>=0).ok_or("native timestamp must be a nonnegative integer".into())}

pub(super) fn normalize(native:&Value,protocol:&Value,check:impl Fn()->R<()>)->R<Value>{
    check()?;
    let engine=&protocol["engine"];
    for (native_key,protocol_key,error) in [
        ("native_version","native_version","Nautilus runtime version does not match queued protocol"),
        ("adapter_version","adapter_version","Nautilus adapter version does not match queued protocol"),
        ("runtime_identity","runtime_identity","Nautilus runtime identity does not match queued protocol"),
    ]{
        if native.get(native_key)!=engine.get(protocol_key){return Err(error.into());}
    }
    let rules=&protocol["playbook"]["rules"];
    let protective=rules["exit_mode"]=="protective";
    let spec=&protocol["dataset"]["instrument_spec"];
    let model=super::reference::cost_snapshot(&protocol["parameters"]["cost_model"])?;
    let quantity=positive(&rules["quantity"])?;
    let contract=positive(&spec["contract_size"])?;
    let units=(&quantity*&contract).with_prec(28);
    let risk=((positive(&rules["planned_stop_distance_price"])?*&quantity).with_prec(28)*&contract).with_prec(28)
        *positive(&model["quote_to_account_rate"])?;
    let risk=risk.with_prec(28);
    let fills=native["fills"].as_array().ok_or("native fills must be an array")?;
    if fills.len()%2!=0{return Err("native fills do not form completed trades".into());}
    let state=json!({"instrument_spec":spec,"cost_model":model});
    let mut ledger=Vec::with_capacity(fills.len()/2);
    for pair in fills.chunks_exact(2){
        check()?;
        let (opened,closed)=(&pair[0],&pair[1]);
        if opened["role"]!="entry"||closed["role"]!="exit"||opened["side"]==closed["side"]{
            return Err("native fill lifecycle mismatch".into());
        }
        if decimal(&opened["units"])?!=units||decimal(&closed["units"])?!=units{
            return Err("native fill quantity mismatch".into());
        }
        let entry=positive(&opened["price"])?;let exit=positive(&closed["price"])?;
        let position=json!({"side":opened["side"],"quantity":quantity.to_string(),"entry_bid":entry.to_string(),"entry_ask":entry.to_string()});
        let (_,costs)=replay_core::pnl(&state,&position,&exit,&exit)?;
        let fees=(decimal(&costs["commission_account"])?+decimal(&costs["slippage_account"])?).with_prec(28)
            +decimal(&costs["financing_account"])?;
        let fees=fees.with_prec(28);
        let adjustment=(decimal(&costs["net_account"])?-decimal(&costs["gross_account"])?).with_prec(28)+&fees;
        let open_ns=timestamp(opened)?;let close_ns=timestamp(closed)?;
        let close=if protective{closed["close_time_utc"].as_i64().ok_or("native protective close timestamp is invalid")?}else{close_ns/1_000_000_000};
        let mut trade=json!({"trade_id":format!("engine-{}",ledger.len()+1),"signal_time_utc":opened["signal_time_utc"],
            "open_time_utc":open_ns/1_000_000_000,"close_time_utc":close,"symbol":spec["instrument_id"],"side":opened["side"],
            "quantity":numeric(quantity.clone())?,"price_open":costs["entry_fill"],"price_close":costs["exit_fill"],
            "gross_pnl":costs["gross_account"],"fees":numeric(fees)?,"rounding_adjustment":numeric(adjustment.with_prec(28))?,
            "costs":costs,"net_pnl":costs["net_account"],"planned_risk_budget":numeric(risk.clone())?,
            "realized_r":numeric((decimal(&costs["net_account"])?/&risk).with_prec(28))?,
            "exit_model":if protective{"protective_bracket"}else{"fixed_horizon_bar_close"},
            "execution_link":{"entry_order_id":opened["client_order_id"],"exit_order_id":closed["client_order_id"],
                "entry_fill_id":opened["native_trade_id"],"exit_fill_id":closed["native_trade_id"],
                "entry_timestamp_ns":open_ns,"exit_timestamp_ns":close_ns}});
        if protective{
            for key in ["exit_reason","protective_stop_price","protective_take_profit_price","research_margin_required_account"]{
                if opened.get(key).is_none()&&closed.get(key).is_none(){return Err("native protective fill context is incomplete".into());}
            }
            trade["exit_reason"]=closed["exit_reason"].clone();
            for key in ["protective_stop_price","protective_take_profit_price","research_margin_required_account"]{
                trade[key]=numeric(decimal(&opened[key])?)?;
            }
        }
        ledger.push(trade);
    }
    check()?;
    let margin=if protective{format!("fixed starting-balance leverage {}:1; research assumption only, not broker evidence",
        super::reference::independent::general(&decimal(&protocol["parameters"]["research_margin"]["leverage"])?)?)}
        else{"disabled; not broker execution evidence".into()};
    let metrics=analytics::compute_metrics_v2(&ledger,&protocol["starting_balance"])?;
    Ok(json!({"ledger":ledger,"metrics":metrics,"signals":native["signals"],"observed_range":native["observed_range"],"execution":native,
        "assumptions":{"execution_engine":"nautilus-trader","engine_version":native["native_version"],
            "timing":if protective{"closed bar -> next open +1ns; protective boundary ticks only for unambiguous OHLC threshold hits; fixed horizon fallback"}else{"closed bar -> next open +1ns modeled ordering; fixed-horizon close"},
            "price_basis":native["quote_model"],"spread_price":protocol["parameters"]["spread_price"],
            "costs":"retained modeled costs applied to native fills; no broker or native fee claim","cost_model_version":model["version"],
            "rounding":"explicit rounding_adjustment","planned_risk_model":"fixed_stop_distance_budget_v1",
            "protective_orders":if protective{"actual Nautilus market-entry bracket with stop-market + take-profit limit; same-bar dual-hit preflight fails closed; hold_bars is max horizon"}else{"disabled; planned stop distance is an R denominator only"},
            "margin_model":margin,"data_quality":protocol["dataset"]["quality"],"data_source":protocol["dataset"]["source"]}}))
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    #[ignore="requires rust_scientific_normalize_oracle.py fixtures"]
    fn python_normalization_oracle(){
        let cases:Vec<Value>=serde_json::from_slice(&std::fs::read(std::env::var("TW_SCIENTIFIC_NORMALIZE_ORACLE").unwrap()).unwrap()).unwrap();
        assert!(cases.len()>=200);let mut failures=Vec::new();
        for (index,case) in cases.iter().enumerate(){
            match normalize(&case["native"],&case["protocol"],||Ok(())){
                Ok(result)=>if let Some(expected)=case["expected"].get("value"){
                    if let Err(error)=super::super::reference::tests::compare(&result,expected,""){failures.push(format!("{index}: {error}"));}
                }else{failures.push(format!("{index}: unexpected success"));},
                Err(error)=>if case["expected"]["error"]!=error{failures.push(format!("{index}: {error} != {}",case["expected"]));}
            }
        }
        assert!(failures.is_empty(),"{}",failures.join("\n"));
    }
    #[test]
    #[ignore="requires rust_scientific_normalize_oracle.py source fixtures"]
    fn independent_source_and_native_tampering_oracle(){
        let cases:Vec<Value>=serde_json::from_slice(&std::fs::read(std::env::var("TW_SCIENTIFIC_NORMALIZE_ORACLE").unwrap()).unwrap()).unwrap();
        let mut checked=0;let mut accepted=0;let mut failures=Vec::new();
        for (index,case) in cases.iter().enumerate(){
            let Some(artifact)=case.get("artifact")else{continue};
            let rows=case["rows"].as_array().unwrap();
            let result=super::super::reference::independent::validate(artifact,rows,||Ok(()));
            let expected=case["source_oracle"]["accepted"]==true;
            if result.is_ok()!=expected{failures.push(format!("{index}: {result:?} != {}",case["source_oracle"]));}
            checked+=1;if !expected{continue}accepted+=1;
            if index%10!=0{continue}
            for pointer in ["/execution/isolation/worker_owned_job_object","/execution/isolation/active_process_limit",
                "/execution/isolation/process_memory_limit_mb","/execution/native_version","/execution/adapter_version",
                "/execution/runtime_identity","/execution/signals","/execution/observed_range/bar_count"]{
                let mut changed=artifact.clone();*changed.pointer_mut(pointer).unwrap()=Value::Null;
                assert!(super::super::reference::independent::validate(&changed,rows,||Ok(())).is_err(),"{index} {pointer}");
            }
            if artifact["ledger"].as_array().unwrap().is_empty(){continue}
            let mut changed=artifact.clone();
            changed["execution"]["fills"][0]["timestamp_ns"]=json!(changed["execution"]["fills"][0]["timestamp_ns"].as_i64().unwrap()+1);
            changed["ledger"][0]["execution_link"]["entry_timestamp_ns"]=changed["execution"]["fills"][0]["timestamp_ns"].clone();
            assert!(super::super::reference::independent::validate(&changed,rows,||Ok(())).is_err(),"coordinated timestamp tampering");
            let mut changed=artifact.clone();
            changed["execution"]["fills"][1]["native_trade_id"]=changed["execution"]["fills"][0]["native_trade_id"].clone();
            changed["ledger"][0]["execution_link"]["exit_fill_id"]=changed["execution"]["fills"][0]["native_trade_id"].clone();
            assert!(super::super::reference::independent::validate(&changed,rows,||Ok(())).is_err(),"coordinated duplicate identity");
        }
        assert!(checked>=200&&accepted>=150,"checked {checked} accepted {accepted}");
        assert!(failures.is_empty(),"{}",failures.join("\n"));
    }
}
