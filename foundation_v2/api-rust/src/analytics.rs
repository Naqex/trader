//! Native, read-only analytics. Financial projections never infer missing costs or risk.
use bigdecimal::BigDecimal;
use chrono::{DateTime, Datelike, SecondsFormat, Utc};
use serde_json::{Value, json};
use std::{collections::{BTreeMap, BTreeSet, HashMap, HashSet}, str::FromStr};

type R<T> = Result<T, String>;
#[path="analytics/trades.rs"]
pub mod trades;
mod open_trades;
#[path="analytics/prop_profile.rs"]
pub mod prop_profile;
mod presentation;
mod activity;
#[path="analytics/routes.rs"]
mod http_routes;
pub use http_routes::{routes,native};
pub use http_routes::ProjectionCache;
pub(crate) use http_routes::analytics_csv;
fn number(v:&Value)->R<f64>{
    let n=match v{Value::Number(n)=>n.as_f64(),Value::String(s)=>s.parse::<f64>().ok(),_=>None};
    n.filter(|n|n.is_finite()).ok_or("value must be a finite number".into())
}
fn decimal(v:&Value)->R<BigDecimal>{
    let s=match v{Value::Number(n)=>n.to_string(),Value::String(s)=>s.clone(),_=>return Err("value must be decimal".into())};
    if s.len()>512{return Err("decimal input outside supported range".into())}
    let n=BigDecimal::from_str(&s).map_err(|_|"value must be finite decimal")?;
    if n.as_bigint_and_exponent().1.unsigned_abs()>512{return Err("decimal exponent outside supported range".into())}Ok(n)
}
fn text(v:&Value)->&str{v.as_str().unwrap_or("")}
fn array(v:&Value)->R<&Vec<Value>>{v.as_array().ok_or("expected array".into())}
fn truth(v:&Value)->bool{match v{Value::Null=>false,Value::Bool(b)=>*b,Value::String(s)=>!s.is_empty(),Value::Array(a)=>!a.is_empty(),Value::Object(o)=>!o.is_empty(),Value::Number(n)=>n.as_f64()!=Some(0.0)}}
fn merge(a:&mut Value,b:&Value){if let(Some(a),Some(b))=(a.as_object_mut(),b.as_object()){a.extend(b.clone());}}
pub fn timestamp(v:&Value)->R<Option<DateTime<Utc>>>{
    if v.is_null()||v==""{return Ok(None)}
    if v.is_number(){let mut n=number(v)?;if n.abs()>=1e11{n/=1000.0}let s=n.floor();let ns=((n-s)*1e9).round() as u32;return DateTime::from_timestamp(s as i64,ns).map(Some).ok_or("invalid Unix timestamp".into())}
    let s=v.as_str().ok_or("timestamp must be ISO-8601 or Unix timestamp")?.trim();
    DateTime::parse_from_rfc3339(s).map(|d|Some(d.with_timezone(&Utc))).map_err(|_|"timestamp must be ISO-8601 with timezone".into())
}
fn iso(d:DateTime<Utc>)->String{d.to_rfc3339_opts(if d.timestamp_subsec_micros()==0{SecondsFormat::Secs}else{SecondsFormat::Micros},false)}
pub fn normalize_filters(v:Option<&Value>)->R<Value>{
    let empty=json!({});let v=v.unwrap_or(&empty);
    let side=if truth(&v["side"]){text(&v["side"]).trim().to_uppercase()}else{"ALL".into()};
    let outcome=if truth(&v["outcome"]){text(&v["outcome"]).trim().to_lowercase()}else{"all".into()};
    if !["ALL","BUY","SELL"].contains(&side.as_str()){return Err("side must be all, BUY, or SELL".into())}
    if !["all","win","loss","breakeven"].contains(&outcome.as_str()){return Err("outcome must be all, win, loss, or breakeven".into())}
    let from=timestamp(&v["from_close_utc"])?;let to=timestamp(&v["to_close_utc"])?;
    if from.zip(to).is_some_and(|(f,t)|f>t){return Err("from_close_utc must not be after to_close_utc".into())}
    Ok(json!({"side":side.to_lowercase(),"outcome":outcome,"from_close_utc":from.map(iso),"to_close_utc":to.map(iso)}))
}
fn outcome(n:f64)->&'static str{if n>1e-12{"win"}else if n< -1e-12{"loss"}else{"breakeven"}}
// CPython 3.12 sum() uses Neumaier compensation for normalized float values.
// Keep the account curve sequential: only aggregate totals use this algorithm.
#[derive(Default)]
pub(crate) struct PythonSum{total:f64,correction:f64}
impl PythonSum{
    pub(crate) fn add(&mut self,x:f64){let t=self.total+x;if self.total.abs()>=x.abs(){self.correction+=(self.total-t)+x}else{self.correction+=(x-t)+self.total}self.total=t;}
    pub(crate) fn value(&self)->f64{if self.correction!=0.0&&self.correction.is_finite(){self.total+self.correction}else{self.total}}
}
pub fn compute_metrics_v2(ledger:&[Value],starting:&Value)->R<Value>{
    let start=number(starting)?;if start<=0.0{return Err("starting_balance must be greater than zero".into())}
    let(mut balance,mut peak,mut maxdd,mut maxddpct)=(start,start,0.0f64,0.0f64);
    let(mut wins,mut losses,mut streak,mut maxstreak)=(0,0,0,0);
    let(mut net,mut gross,mut fees,mut positive,mut negative)=(PythonSum::default(),PythonSum::default(),PythonSum::default(),PythonSum::default(),PythonSum::default());
    let(mut ng,mut nf)=(0,0);let mut rs=vec![];
    let mut curve=vec![json!({"sequence":0,"trade_id":null,"closed_trade_balance":start})];
    let mut ddcurve=vec![json!({"sequence":0,"trade_id":null,"closed_trade_balance":start,"peak_closed_trade_balance":start,"drawdown":0.0,"drawdown_pct":0.0})];
    for (i,t) in ledger.iter().enumerate(){
        if !t.is_object(){return Err("ledger entries must be objects".into())}
        let n=number(&t["net_pnl"])?;net.add(n);
        match outcome(n){"win"=>{wins+=1;streak=0;positive.add(n)},"loss"=>{losses+=1;streak+=1;maxstreak=maxstreak.max(streak);negative.add(n)},_=>streak=0}
        if !t["gross_pnl"].is_null(){gross.add(number(&t["gross_pnl"])?);ng+=1}
        if !t["fees"].is_null(){fees.add(number(&t["fees"])?);nf+=1}
        if !t["planned_risk_budget"].is_null(){let r=number(&t["planned_risk_budget"])?;if r<=0.0{return Err("planned_risk_budget must be greater than zero".into())}rs.push(n/r)}
        balance+=n;peak=peak.max(balance);let dd=peak-balance;let pct=if peak>0.0{dd/peak*100.0}else{0.0};maxdd=maxdd.max(dd);maxddpct=maxddpct.max(pct);
        curve.push(json!({"sequence":i+1,"trade_id":t["trade_id"],"closed_trade_balance":balance}));
        ddcurve.push(json!({"sequence":i+1,"trade_id":t["trade_id"],"closed_trade_balance":balance,"peak_closed_trade_balance":peak,"drawdown":dd,"drawdown_pct":if peak>0.0{Some(pct)}else{None}}));
    }
    let (net,gross,fees,positive,negative)=(net.value(),gross.value(),fees.value(),positive.value(),negative.value());let mut rsum=PythonSum::default();for r in &rs{rsum.add(*r)}let count=ledger.len();let complete=count>0&&rs.len()==count;
    Ok(json!({"metric_schema_version":"metrics-v2","closed_trade_count":count,"wins":wins,"losses":losses,"breakeven":count-wins-losses,
        "win_rate_pct":if count>0{Some(wins as f64/count as f64*100.0)}else{None},"loss_rate_pct":if count>0{Some(losses as f64/count as f64*100.0)}else{None},
        "gross_pnl":if ng==count{Some(if count==0{json!(0)}else{json!(gross)})}else{None},"fees":if nf==count{Some(if count==0{json!(0)}else{json!(fees)})}else{None},"net_pnl":if count==0{json!(0)}else{json!(net)},
        "profit_factor_after_cost":if negative.abs()>1e-12{Some(positive/negative.abs())}else{None},
        "payoff_ratio_after_cost":if wins>0&&losses>0{Some((positive/wins as f64)/(negative/losses as f64).abs())}else{None},
        "expectancy_net_per_trade":if count>0{Some(net/count as f64)}else{None},"average_realized_r":if complete{Some(rsum.value()/rs.len() as f64)}else{None},
        "realized_r_known_count":rs.len(),"gross_pnl_known_count":ng,"fees_known_count":nf,"closed_trade_balance_max_drawdown":maxdd,"closed_trade_balance_max_drawdown_pct":maxddpct,
        "max_loss_streak":maxstreak,"starting_balance":start,"ending_closed_trade_balance":balance,"closed_trade_balance_curve":curve,"closed_trade_balance_drawdown_curve":ddcurve,"realized_r_values":rs,
        "basis":{"pnl":"net_pnl from normalized closed-trade ledger","costs":if count>0&&ng==count&&nf==count{"complete"}else{"incomplete_or_unknown"},"realized_r":if complete{"complete"}else{"incomplete_or_unknown"},"drawdown":"closed_trade_balance_only","floating_pnl":"not_available","cashflow":"not_available"},
        "definitions":serde_json::from_str::<Value>(include_str!("analytics/metric_definitions.json")).expect("compiled metric definitions")
    }))
}
fn provenance(r:&Value)->Value{
    let mut p=json!({});for k in ["job_id","workspace_id","dataset_id","dataset_sha256","protocol_sha256","created_at_utc"]{p[k]=r[k].clone();}
    for(k,fallback)in[("metrics_schema_version",&r["metrics"]["metric_schema_version"]),("split",&r["protocol"]["split"]),("playbook_id",&r["protocol"]["playbook"]["record_id"]),("playbook_revision",&r["protocol"]["playbook"]["revision"])]{p[k]=if truth(&r[k]){r[k].clone()}else{fallback.clone()};}p
}
pub fn build_analytics_view(r:&Value,values:Option<&Value>)->R<Value>{
    if !r.is_object(){return Err("research result must be an object".into())}
    let f=normalize_filters(values)?;let active=f["side"]!="all"||f["outcome"]!="all"||!f["from_close_utc"].is_null()||!f["to_close_utc"].is_null();
    let Some(ledger)=r["ledger"].as_array()else{return Ok(json!({"schema_version":"analytics-read-model-v1","analytics_available":false,"blocked_by_data":["closed_trade_ledger_missing"],"filters":f,"scope":{"selected_trade_count":null,"total_trade_count":null,"active_filters":active,"observed_range":{"first_close_utc":null,"last_close_utc":null},"balance_curve_scope":"unavailable: closed-trade ledger is not present"},"metrics":if r["metrics"].is_object(){r["metrics"].clone()}else{json!({})},"ledger":[],"provenance":provenance(r)}))};
    let from=timestamp(&f["from_close_utc"])?;let to=timestamp(&f["to_close_utc"])?;let mut selected=vec![];let mut times=vec![];
    for t in ledger{if !t.is_object(){return Err("ledger entries must be objects".into())}if f["side"]!="all"&&text(&t["side"]).to_lowercase()!=text(&f["side"]){continue}if f["outcome"]!="all"&&number(&t["net_pnl"]).map(outcome).unwrap_or("unknown")!=text(&f["outcome"]){continue}let time=timestamp(activity::time(t))?;if from.is_some_and(|f|time.is_none_or(|t|t<f))||to.is_some_and(|f|time.is_none_or(|t|t>f)){continue}if let Some(t)=time{times.push(t)}selected.push(t.clone());}
    let starting=if !r["protocol"]["starting_balance"].is_null(){&r["protocol"]["starting_balance"]}else{&r["metrics"]["starting_balance"]};
    if starting.is_null(){return Err("starting_balance is required to recompute filtered metrics".into())}
    let metrics=compute_metrics_v2(&selected,starting)?;times.sort();
    Ok(json!({"schema_version":"analytics-read-model-v1","analytics_available":true,"blocked_by_data":[],"filters":f,"scope":{"selected_trade_count":selected.len(),"total_trade_count":ledger.len(),"active_filters":active,"observed_range":{"first_close_utc":times.first().copied().map(iso),"last_close_utc":times.last().copied().map(iso)},"balance_curve_scope":format!("{} closed trades replayed from result starting balance; floating P/L and cashflow unavailable",if active{"selected"}else{"all"})},"metrics":metrics,"ledger":selected,"provenance":provenance(r)}))
}

pub fn build_replay_activity_view(record:&Value,filters:Option<&Value>,zone:chrono_tz::Tz)->R<Value>{activity::view(record,filters,zone)}
pub fn build_replay_analytics_view(view:&Value,filters:Option<&Value>)->R<Value>{
    let p=&view["payload"];
    if truth(&p["asset_states"]){return build_portfolio_analytics(view,filters)}
    let sid=&view["record_id"];
    let mut base=json!({"session_id":sid,"workspace_id":view["workspace_id"],"dataset_id":p["dataset_id"],"dataset_sha256":view["dataset_sha256"],"revision":view["revision"],"branch_id":p["branch_id"],"parent_session_id":p["parent_session_id"],"cursor_index":p["cursor_index"],"canonical_cursor_index":view.get("canonical_cursor_index").unwrap_or(&p["cursor_index"]),"canonical_execution_event_sequence":view["canonical_execution_event_sequence"],"historical_view":view.get("historical_view").unwrap_or(&Value::Bool(false)),"cutoff_timestamp":view["cutoff_timestamp"],"created_at_utc":view["updated_at_utc"],"mode":"replay","timezone":"UTC"});
    let s=&p["execution"];
    let mut result=if s.is_null(){let mut result=build_analytics_view(&base,filters)?;result["blocked_by_data"]=json!(["replay_execution_not_initialized"]);result}else{
        crate::replay_core::validate(s)?;
        let ledger=array(&s["ledger"])?;
        if s["replay_session_id"]!=*sid||s["dataset_id"]!=p["dataset_id"]||s["branch_id"]!=p["branch_id"]||s["cursor_index"]!=p["cursor_index"]||s["event_sequence"].as_u64()!=Some(ledger.len() as u64){return Err("replay execution lineage is inconsistent".into())}
        if truth(&base["dataset_sha256"])&&base["dataset_sha256"]!=s["dataset_sha256"]{return Err("replay dataset hash is inconsistent".into())}
        let mut opened=HashMap::<String,&Value>::new();let mut remaining_quantities=HashMap::<String,BigDecimal>::new();let mut partially_closed=HashSet::new();let mut positions=HashSet::new();let mut operations=HashSet::new();let mut trades=vec![];let mut rejects=vec![];
        let(mut last_cursor,mut last_time)=(-1,-1);let mut balance=decimal(&s["starting_balance"])?;let mut last:Option<&Value>=None;let mut phases=0;let mut phase_initial=balance.clone();
        for(i,e)in ledger.iter().enumerate(){
            crate::replay_core::validate_event(s,e)?;
            let c=e["cursor_index"].as_i64().ok_or("invalid event cursor")?;let time=e["virtual_time_utc"].as_i64().ok_or("invalid event time")?;
            if e["sequence"].as_u64()!=Some((i+1)as u64)||e["replay_session_id"]!=*sid||e["branch_id"]!=s["branch_id"]||e["dataset_id"]!=s["dataset_id"]||e["dataset_sha256"]!=s["dataset_sha256"]||c<last_cursor||c>s["cursor_index"].as_i64().ok_or("invalid snapshot cursor")?||time<last_time{return Err("replay event lineage is inconsistent".into())}
            last_cursor=c;last_time=time;let d=&e["details"];let id=text(&d["position_id"]);let kind=text(&e["kind"]);
            if ["replay-execution-v2","replay-execution-tick-v1"].contains(&text(&s["schema_version"]))&&["market_fill","order_rejected"].contains(&kind)&&!operations.insert(d["operation_id"].to_string()){return Err("replay order outcome is duplicated".into())}
            match kind{
                "market_fill"=>{if id.trim().is_empty()||!positions.insert(id.to_string())||!opened.is_empty()||text(&d["operation_id"]).trim().is_empty()||!["BUY","SELL"].contains(&text(&d["side"])){return Err("replay opening fill is inconsistent".into())}if number(&d["quantity"])?<=0.0||number(&d["fill_price"])?<=0.0{return Err("replay opening price or quantity invalid".into())}opened.insert(id.to_string(),e);remaining_quantities.insert(id.to_string(),decimal(&d["quantity"])?);},
                "protective_fill"|"manual_close"=>{
                    let entry=*opened.get(id).ok_or("replay closing fill has no matching opening fill")?;
                    let before=remaining_quantities.get(id).ok_or("replay closing quantity missing")?;
                    // Historical protective fills omit quantity because they close all exposure.
                    let quantity=if kind=="protective_fill"&&d["quantity"].is_null(){before.clone()}else{decimal(&d["quantity"])?};
                    let remaining=before-&quantity;
                    if quantity<=BigDecimal::from(0)||remaining<BigDecimal::from(0)||truth(&d["open_position"])!=(remaining>BigDecimal::from(0)){return Err("replay closing quantity differs from remaining position".into())}
                    if remaining>BigDecimal::from(0){remaining_quantities.insert(id.to_string(),remaining);partially_closed.insert(id.to_string());}else{opened.remove(id);remaining_quantities.remove(id);}
                    if entry["details"]["operation_id"]!=d["operation_id"]{return Err("replay closing fill has no matching opening fill".into())}
                    balance+=decimal(&d["net_pnl"])?;let exit=number(&d["fill_price"])?;
                    if exit<=0.0{return Err("replay exit price invalid".into())}
                    let (gross, fees) = closed_costs(d, &s["instrument_spec"]["account_ccy"])?;
                    let mut trade=json!({"trade_id":if partially_closed.contains(id){format!("{id}:close:{}",i+1)}else{id.to_string()},"session_id":sid,"source_position_id":id,"source_operation_id":d["operation_id"],"source":{"session_id":sid,"revision":view["revision"]},"symbol":s["instrument_spec"]["instrument_id"],"side":entry["details"]["side"],"quantity":number(&json!(quantity.to_string()))? ,"open_time_utc":entry["virtual_time_utc"],"close_time_utc":time,"open_cursor_index":entry["cursor_index"],"close_cursor_index":c,"close_event_sequence":i+1,"close_phase_index":phases+1,"price_open":number(&entry["details"]["fill_price"])? ,"price_close":exit,"net_pnl":number(&d["net_pnl"])? ,"gross_pnl":gross,"fees":fees,"planned_risk_budget":null,"realized_r":null,"exit_reason":d["reason"]});
                    if d["closed_position"].is_object() {
                        for key in ["stop_loss", "take_profit"] {
                            trade[key]=d["closed_position"][key].clone();
                        }
                    }
                    trades.push(trade);
                },
                "order_rejected"=>{let mut reject=json!({"event_sequence":i+1,"cursor_index":c,"virtual_time_utc":time});merge(&mut reject,d);rejects.push(reject)},
                "phase_transition"=>{
                    if d["from_phase_index"].as_u64()!=Some(phases+1)||d["to_phase_index"].as_u64()!=Some(phases+2)||decimal(&d["from_balance"])?!=balance{return Err("replay phase transition is inconsistent".into())}
                    let policy=text(&d["carry_policy"]);let pp=text(&d["position_policy"]);let ni=decimal(&d["next_phase_initial_balance"])?;if ni<=BigDecimal::from(0)||!["must_be_flat","carry","close_by_simulator"].contains(&pp)||(!opened.is_empty()&&(policy!="carry_all"||pp!="carry")){return Err("replay phase position policy is inconsistent".into())}
                    match policy{"reset"=>{if !opened.is_empty(){return Err("replay balance reset has an open position".into())}balance=ni.clone()},"carry_balance"|"carry_all"=>{},_=>return Err("replay phase carry policy is invalid".into())}
                    if decimal(&d["to_balance"])?!=balance{return Err("replay phase balance is inconsistent".into())}
                    let fp=last.map(|e|decimal(&e["floating_pl"])).transpose()?.unwrap_or(BigDecimal::from(0));let eq=last.map(|e|decimal(&e["equity"])).transpose()?.unwrap_or(decimal(&s["starting_balance"])?);
                    if e["pending_orders"]!=0||decimal(&e["floating_pl"])?!=if policy=="carry_all"{fp.clone()}else{BigDecimal::from(0)}||decimal(&d["from_floating_pl"])?!=fp||decimal(&d["from_equity"])?!=eq||decimal(&d["to_floating_pl"])?!=decimal(&e["floating_pl"])?||decimal(&d["to_equity"])?!=decimal(&e["equity"])?{return Err("replay phase account state is inconsistent".into())}phases+=1;phase_initial=ni;
                },_=>{}
            }
            if decimal(&e["balance"])?!=balance||e["open_positions"].as_u64()!=Some(opened.len()as u64){return Err("replay event account state is inconsistent".into())}last=Some(e);
        }
        if decimal(&s["balance"])?!=balance||s.get("phase_index").and_then(Value::as_u64).unwrap_or(1)!=phases+1||((!s["phase_initial_balance"].is_null()||phases>0)&&decimal(&s["phase_initial_balance"])?!=phase_initial)||last.is_some_and(|e|e["cursor_index"]!=s["cursor_index"]||decimal(&e["floating_pl"]).ok()!=decimal(&s["floating_pl"]).ok()||decimal(&e["equity"]).ok()!=decimal(&s["equity"]).ok()){return Err("replay snapshot account state is inconsistent".into())}
        if opened.len()!=usize::from(!s["position"].is_null())||(!s["position"].is_null()&&!opened.contains_key(text(&s["position"]["position_id"]))){return Err("replay snapshot position is inconsistent".into())}
        let cutoff=if last_time>0{json!(last_time)}else{base["cutoff_timestamp"].clone()};
        merge(&mut base,&json!({"dataset_sha256":s["dataset_sha256"],"instrument_id":s["instrument_spec"]["instrument_id"],"timeframe":format!("{}s",s["timeframe_seconds"]),"timeframe_seconds":s["timeframe_seconds"],"account_currency":s["instrument_spec"]["account_ccy"],"cutoff_timestamp":cutoff,"open_position_count":usize::from(!s["position"].is_null()),"pending_order_count":usize::from(!s["pending_market_order"].is_null()),"phase_transition_count":phases,"execution_event_sequence":s["event_sequence"],"phase_index":phases+1,"phase_initial_balance":number(if truth(&s["phase_initial_balance"]){&s["phase_initial_balance"]}else{&s["starting_balance"]})?,"data_quality":s.get("evaluation_quality").cloned().unwrap_or(json!("full_for_declared_model"))}));
        let mut source=base.clone();source["protocol"]=json!({"starting_balance":number(&s["starting_balance"])?});source["ledger"]=json!(trades);
        let mut result=build_analytics_view(&source,filters)?;
        if ["replay-execution-v2","replay-execution-tick-v1"].contains(&text(&s["schema_version"])){result["order_rejections"]=json!(rejects);result["rejected_order_count"]=json!(rejects.len());result["research_margin"]=s["research_margin"].clone();}
        if s["schema_version"]=="replay-execution-tick-v1"{for k in ["tick_snapshot_id","tick_snapshot_sha256","quote_source"]{result["provenance"][k]=s[k].clone()}}
        if phases>0{let scope=text(&result["scope"]["balance_curve_scope"]).to_string();result["scope"]["balance_curve_scope"]=json!(scope+"; phase balance resets excluded");}result
    };
    merge(&mut result["provenance"],&base);merge(&mut result,&base);Ok(result)
}

fn closed_costs(details: &Value, currency: &Value) -> R<(Option<f64>, Option<f64>)> {
    let cost = &details["cost_breakdown"];
    if cost.is_null() { return Ok((None, None)); }
    if !cost.is_object() || cost["account_ccy"] != *currency
        || decimal(&cost["net_account"])? != decimal(&details["net_pnl"])? {
        return Err("closing cost breakdown differs from account result".into());
    }
    let gross = decimal(&cost["gross_account"])?;
    // Independently rounded cost components need not add up to the rounded debit.
    let fees = &gross - decimal(&cost["net_account"])?;
    Ok((Some(number(&json!(gross.to_string()))?), Some(number(&json!(fees.to_string()))?)))
}

fn build_portfolio_analytics(view:&Value,filters:Option<&Value>)->R<Value>{
    let p=&view["payload"];let states=p["asset_states"].as_object().ok_or("portfolio asset states invalid")?;
    let mut trades=vec![];let mut keys=vec![];let mut instruments=vec![];let mut hashes=json!({});let mut initialized=false;
    let(mut balance,mut floating,mut opens,mut pending)=(decimal(&p["starting_balance"])? ,BigDecimal::from(0),0,0);
    for(id,state)in states{let s=&state["execution"];if !truth(s){continue}initialized=true;crate::replay_core::validate(s)?;
        if s["instrument_spec"]["account_ccy"]!=p["starting_balance_ccy"]||decimal(&s["starting_balance"])?!=decimal(&p["starting_balance"])?{return Err("portfolio account currency/capital is inconsistent".into())}
        instruments.push(s["instrument_spec"]["instrument_id"].clone());hashes[id]=s["dataset_sha256"].clone();
        let mut child=view.clone();child["payload"].as_object_mut().unwrap().remove("asset_states");child["payload"].as_object_mut().unwrap().remove("dataset_ids");child["payload"]["dataset_id"]=json!(id);child["payload"]["cursor_index"]=state["cursor_index"].clone();child["payload"]["execution"]=s.clone();child["dataset_sha256"]=s["dataset_sha256"].clone();child["canonical_cursor_index"]=state["cursor_index"].clone();
        let validated=build_replay_analytics_view(&child,None)?;
        for e in array(&s["ledger"])?{keys.push((e["virtual_time_utc"].as_i64().ok_or("event time invalid")?,id.clone(),e["sequence"].as_i64().ok_or("event sequence invalid")?))}
        for t in array(&validated["ledger"])?{let mut t=t.clone();t["trade_id"]=json!(format!("{}:{}",id,text(&t["trade_id"])));t["source_position_id"]=t["trade_id"].clone();t["dataset_id"]=json!(id);t["asset_close_event_sequence"]=t["close_event_sequence"].clone();t["asset_close_cursor_index"]=t["close_cursor_index"].clone();t["close_cursor_index"]=view["portfolio_trade_cursors"][format!("{}:{}",id,t["close_event_sequence"])].clone();trades.push(t)}
        balance+=decimal(&s["balance"])?-decimal(&s["starting_balance"])?;floating+=decimal(&s["floating_pl"])?;opens+=usize::from(!s["position"].is_null());pending+=usize::from(!s["pending_market_order"].is_null());
    }
    keys.sort();let ordinals:HashMap<_,_>=keys.iter().enumerate().map(|(i,(_,d,s))|((d.clone(),*s),i+1)).collect();
    for t in &mut trades{t["close_event_sequence"]=json!(ordinals[&(text(&t["dataset_id"]).to_string(),t["asset_close_event_sequence"].as_i64().unwrap())]);}
    trades.sort_by_key(|t|(t["close_time_utc"].as_i64(),t["close_event_sequence"].as_u64()));
    let base=json!({"session_id":view["record_id"],"workspace_id":view["workspace_id"],"revision":view["revision"],"dataset_id":p["dataset_id"],"dataset_ids":p["dataset_ids"],"dataset_hashes":hashes,"branch_id":p["branch_id"],"parent_session_id":p["parent_session_id"],"cursor_index":p["cursor_index"],"canonical_cursor_index":view.get("canonical_cursor_index").unwrap_or(&p["cursor_index"]),"historical_view":view.get("historical_view").unwrap_or(&Value::Bool(false)),"cutoff_timestamp":view["cutoff_timestamp"],"mode":"replay","timezone":"UTC","account_currency":p["starting_balance_ccy"],"instrument_id":instruments.iter().map(text).collect::<Vec<_>>().join(" · "),"instrument_ids":instruments,"open_position_count":opens,"pending_order_count":pending,"execution_event_sequence":keys.len(),"data_quality":if initialized{"full_for_declared_model"}else{"insufficient"}});
    let mut source=base.clone();source["protocol"]=json!({"starting_balance":number(&p["starting_balance"])?});source["ledger"]=json!(trades);let mut result=build_analytics_view(&source,filters)?;
    if !initialized{result["analytics_available"]=json!(false);result["blocked_by_data"]=json!(["replay_execution_not_initialized"])}
    merge(&mut result["provenance"],&base);merge(&mut result,&base);
    result["portfolio_account"]=json!({"starting_balance":decimal(&p["starting_balance"])?.to_string(),"balance":balance.to_string(),"floating_pl":floating.to_string(),"equity":(balance+floating).to_string(),"open_position_count":opens,"pending_order_count":pending,"account_ccy":p["starting_balance_ccy"]});Ok(result)
}

pub fn replay_metadata(record:&Value,workspace:&str)->R<Value>{
    let p=&record["payload"];let e=&p["execution"];let cutoff=if truth(&p["replay_clock_utc"]){p["replay_clock_utc"].clone()}else{e["ledger"].as_array().and_then(|a|a.last()).map(|e|e["virtual_time_utc"].clone()).unwrap_or(Value::Null)};
    let mut config=json!({});for k in ["dataset_id","dataset_ids","name","description","playbook_id","playbook_revision","starting_balance","starting_balance_ccy","cursor_index"]{if let Some(v)=p.get(k){config[k]=v.clone()}}
    config["execution"]=if truth(e){let mut c=json!({});for k in ["starting_balance","balance","cost_model","spread_price","instrument_spec"]{if let Some(v)=e.get(k){c[k]=v.clone()}}c}else{Value::Null};
    let mut out=json!({"schema_version":"replay-metadata-v1","workspace_id":workspace,"record_id":record["record_id"],"revision":record["revision"],"cutoff_timestamp":cutoff,"payload":config,"freshness":"current_revision"});
    if truth(&p["asset_states"]){out["portfolio_account"]=portfolio_account(p)?;}Ok(out)
}
fn portfolio_account(p:&Value)->R<Value>{
    let initial=p.get("starting_balance").cloned().unwrap_or(json!("10000"));let init=decimal(&initial)?;let mut balance=init.clone();let mut floating=BigDecimal::from(0);let(mut positions,mut pending)=(0,0);
    for state in p["asset_states"].as_object().ok_or("portfolio asset states invalid")?.values(){let s=&state["execution"];if truth(s){crate::replay_core::validate(s)?;if decimal(&s["starting_balance"])?!=init{return Err("portfolio starting balance is inconsistent".into())}balance+=decimal(&s["balance"])?-&init;floating+=decimal(&s["floating_pl"])?;positions+=usize::from(!s["position"].is_null());pending+=usize::from(!s["pending_market_order"].is_null());}}
    Ok(json!({"starting_balance":init.to_string(),"balance":balance.to_string(),"floating_pl":floating.to_string(),"equity":(balance+floating).to_string(),"account_ccy":p.get("starting_balance_ccy").cloned().unwrap_or(json!("USD")),"open_position_count":positions,"pending_order_count":pending}))
}
pub fn build_session_summary(record:&Value,workspace:&str)->R<Value>{session_summary(record,workspace,None,false)}
pub fn build_session_summary_in_timezone(record:&Value,workspace:&str,zone:chrono_tz::Tz)->R<Value>{session_summary(record,workspace,Some(zone),false)}
pub fn build_activity_session_summary(record:&Value,workspace:&str,zone:chrono_tz::Tz)->R<Value>{session_summary(record,workspace,Some(zone),true)}
fn session_summary(record:&Value,workspace:&str,zone:Option<chrono_tz::Tz>,activity_basis:bool)->R<Value>{
    let metadata=replay_metadata(record,workspace)?;
    let mut r=record.clone();r["workspace_id"]=json!(workspace);
    let view=match if activity_basis{activity::view(&r,None,zone.unwrap_or(chrono_tz::UTC))}else{build_replay_analytics_view(&r,None)}{Ok(v)=>v,Err(_)=>return Ok(json!({"status":"error","revision":record["revision"],"unavailable":true,"strategy":record["payload"]["playbook_id"],"pnl":null,"currency":null,"metadata":metadata,"reason":"replay_analytics_source_invalid"}))};
    let metrics:serde_json::Map<_,_>=view["metrics"].as_object().ok_or("analytics metrics invalid")?.iter().filter(|(_,v)|!v.is_array()&&!v.is_object()).map(|(k,v)|(k.clone(),v.clone())).collect();
    let mut curve=view["metrics"]["closed_trade_balance_curve"].as_array().cloned().unwrap_or_default();
    if zone.is_some(){
        let trades=array(&view["ledger"])?;
        let opened=if activity_basis{None}else{presentation::first_opening(record)};
        for point in &mut curve{let sequence=point["sequence"].as_u64().unwrap_or(0)as usize;let time=if sequence==0{opened}else{trades.get(sequence-1).and_then(|t|timestamp(activity::time(t)).ok().flatten())};point["time_utc"]=json!(time.map(iso));}
    }
    let indices:BTreeSet<usize>=if curve.len()>128{(0..128).map(|i|(i as f64*(curve.len()-1)as f64/127.0).round_ties_even()as usize).collect()}else{(0..curve.len()).collect()};
    let mut months=BTreeMap::<String,f64>::new();let mut weekdays=[0.0;7];let mut incomplete=false;
    for trade in array(&view["ledger"])?{if let Some(close)=timestamp(activity::time(trade))?{let close=close.with_timezone(&zone.unwrap_or(chrono_tz::UTC));let n=number(&trade["net_pnl"])?;*months.entry(close.format("%Y-%m").to_string()).or_default()+=n;weekdays[close.weekday().num_days_from_monday()as usize]+=n;}else{incomplete=true}}
    let nmonths=months.len();let month_values:Vec<_>=months.into_iter().skip(nmonths.saturating_sub(12)).map(|(k,v)|json!({"label":k,"value":v})).collect();
    let mut result=json!({"status":"ready","revision":record["revision"],"strategy":record["payload"]["playbook_id"],"pnl":if view["analytics_available"]==true{metrics.get("net_pnl").cloned().unwrap_or(Value::Null)}else{Value::Null},"currency":view["account_currency"],"metadata":metadata,"analytics_available":view["analytics_available"],"metrics":metrics,"curve":{"points":indices.iter().map(|i|curve[*i].clone()).collect::<Vec<_>>(),"total_points":curve.len(),"sampled":curve.len()>128,"method":"uniform_trade_sequence","minimum_balance":curve.iter().filter_map(|p|p["closed_trade_balance"].as_f64()).reduce(f64::min),"maximum_balance":curve.iter().filter_map(|p|p["closed_trade_balance"].as_f64()).reduce(f64::max)},"periods":{"months":month_values,"weekdays":(["T2","T3","T4","T5","T6","T7","CN"].iter().zip(weekdays).map(|(k,v)|json!({"label":k,"value":v})).collect::<Vec<_>>()),"incomplete":incomplete,"total_months":nmonths},"provenance":view["provenance"],"blocked_by_data":view["blocked_by_data"]});
    if activity_basis&&incomplete&&nmonths==0{result["periods"]["weekdays"]=json!([]);}
    if activity_basis{result["equity_curve"]=view["equity_curve"].clone();result["periods"]["time_basis"]=json!("activity");result["scope"]=view["scope"].clone();}
    if let Some(zone)=zone{result["periods"]["timezone"]=json!(zone.name());result["periods"]["performance"]=presentation::performance_periods(&view,zone)?;result["provenance"]["timezone"]=json!(zone.name());}Ok(result)
}

pub fn dashboard_timing(records:&[Value],intervals:&[Value])->R<Value>{
    let ids:BTreeSet<_>=records.iter().map(|r|text(&r["record_id"]).to_string()).collect();
    let intervals:Vec<_>=intervals.iter().filter(|i|ids.contains(text(&i["session_id"]))).collect();
    let mut practice:BTreeSet<_>=intervals.iter().map(|i|text(&i["session_id"]).to_string()).collect();let mut partial=practice.clone();let mut known=BTreeSet::new();let mut historical=0.0;
    for r in records{let t=&r["payload"]["timing"];if t["schema_version"]!="replay-timing-v1"{continue}let Ok(seconds)=number(&t["historical_time_replayed_seconds"])else{continue};if !t["historical_time_replayed_seconds"].is_number()||seconds<0.0{continue}let id=text(&r["record_id"]).to_string();known.insert(id.clone());historical+=seconds;if t["legacy_baseline"]==false{practice.insert(id.clone());partial.remove(&id);}else{partial.insert(id);}}
    let mut pairs=vec![];for i in intervals{let start=timestamp(&i["started_at_utc"])?.ok_or("missing activity start")?;let end=timestamp(&i["ended_at_utc"])?.ok_or("missing activity end")?;pairs.push((start,end));}pairs.sort();
    let mut total=0.0;let mut last:Option<DateTime<Utc>>=None;for(start,end)in pairs{let start=last.map_or(start,|l|l.max(start));if end>start{total+=(end-start).num_microseconds().ok_or("activity range overflow")? as f64/1e6;}last=Some(last.map_or(end,|l|l.max(end)));}
    Ok(json!({"time_invested_seconds":if !practice.is_empty()||records.is_empty(){Some(total)}else{None},"historical_time_replayed_seconds":if !known.is_empty()||records.is_empty(){Some(historical)}else{None},"timing_scope":{"source":"measured_replay_activity_and_step_timestamps","session_ids":ids,"trade_filters_apply":false,"active_interval_aggregation":"wall_clock_union_across_selected_sessions","historical_aggregation":"successful_forward_step_timestamp_deltas","practice_measured_session_count":practice.len(),"historical_measured_session_count":known.len(),"unknown_practice_session_count":ids.difference(&practice).count(),"unknown_historical_session_count":ids.difference(&known).count(),"legacy_partial_session_count":partial.len(),"legacy_backfill":false}}))
}
fn counts(trades:&[Value])->R<Value>{let mut wins=0;let mut losses=0;for t in trades{let n=decimal(&t["net_pnl"])?;if n>BigDecimal::from(0){wins+=1}else if n<BigDecimal::from(0){losses+=1}}
    Ok(json!({"closed_trade_count":trades.len(),"wins":wins,"losses":losses,"breakeven":trades.len()-wins-losses,"win_rate_pct":if trades.is_empty(){None}else{Some(wins as f64/trades.len()as f64*100.0)}}))}
fn root_session<'a>(mut r:&'a Value,map:&HashMap<String,&'a Value>)->Option<&'a Value>{let mut seen=HashSet::new();loop{if !seen.insert(text(&r["record_id"]).to_string()){return None}if !truth(&r["payload"]["parent_session_id"]){return Some(r)}r=map.get(text(&r["payload"]["parent_session_id"]))?;}}
fn trade_origin<'a>(mut r:&'a Value,map:&HashMap<String,&'a Value>,trade:&Value)->R<String>{
    while truth(&r["payload"]["parent_session_id"]){let seq=if truth(&trade["dataset_id"]){&r["payload"]["parent_asset_checkpoint_sequences"][text(&trade["dataset_id"])]}else{&r["payload"]["parent_checkpoint_event_sequence"]};let inherited=seq.as_u64().ok_or("replay branch checkpoint is unavailable")?;let close=trade.get("asset_close_event_sequence").unwrap_or(&trade["close_event_sequence"]).as_u64().ok_or("invalid close sequence")?;if close>inherited{break}r=map.get(text(&r["payload"]["parent_session_id"])).ok_or("branch ancestry unavailable")?;}Ok(text(&r["record_id"]).to_string())
}
pub fn build_dashboard_performance(records:&[Value],workspace:&str,session_id:Option<&str>,session_ids:Option<&[String]>,filters:Option<&Value>,include_ledger:bool,intervals:&[Value])->R<Value>{dashboard_performance(records,workspace,session_id,session_ids,filters,include_ledger,intervals,None,false)}
pub fn build_dashboard_performance_in_timezone(records:&[Value],workspace:&str,session_id:Option<&str>,session_ids:Option<&[String]>,filters:Option<&Value>,include_ledger:bool,intervals:&[Value],zone:chrono_tz::Tz)->R<Value>{dashboard_performance(records,workspace,session_id,session_ids,filters,include_ledger,intervals,Some(zone),false)}
pub fn build_activity_dashboard(records:&[Value],workspace:&str,session_id:Option<&str>,session_ids:Option<&[String]>,filters:Option<&Value>,include_ledger:bool,intervals:&[Value],zone:chrono_tz::Tz)->R<Value>{dashboard_performance(records,workspace,session_id,session_ids,filters,include_ledger,intervals,Some(zone),true)}
fn dashboard_performance(records:&[Value],workspace:&str,session_id:Option<&str>,session_ids:Option<&[String]>,filters:Option<&Value>,include_ledger:bool,intervals:&[Value],zone:Option<chrono_tz::Tz>,activity_basis:bool)->R<Value>{
    let filters=normalize_filters(filters)?;let map:HashMap<_,_>=records.iter().map(|r|(text(&r["record_id"]).to_string(),r)).collect();
    let mut sid=session_id.map(str::to_owned);let mut selected=if let Some(id)=session_id{vec![(*map.get(id).ok_or("replay session not found")?).clone()]}else{records.to_vec()};
    if let Some(ids)=session_ids{let mut seen=HashSet::new();selected=vec![];for id in ids{if seen.insert(id){selected.push((*map.get(id).ok_or("replay session not found")?).clone())}}if selected.len()==1{sid=Some(text(&selected[0]["record_id"]).to_string())}}
    let sessions:Vec<_>=records.iter().map(|r|{let p=&r["payload"];json!({"session_id":r["record_id"],"name":if truth(&p["name"]){p["name"].clone()}else{r["record_id"].clone()},"instrument_id":p["execution"]["instrument_spec"]["instrument_id"],"dataset_id":p["dataset_id"],"revision":r["revision"],"archived":p.get("archived").cloned().unwrap_or(json!(false))})}).collect();
    let(mut trades,mut sources,mut excluded)=(vec![],vec![],vec![]);let mut seen=HashSet::new();let mut duplicate=0;
    for r in &selected{let id=text(&r["record_id"]);if root_session(r,&map).is_none()&&sid.is_none(){excluded.push(json!({"session_id":id,"reason":"branch_ancestry_unavailable"}));continue}
        let mut r=r.clone();r["workspace_id"]=json!(workspace);
        let one=(||->R<(Value,Vec<(String,Value)>)>{let mut view=if activity_basis{activity::view(&r,None,zone.unwrap_or(chrono_tz::UTC))?}else{build_replay_analytics_view(&r,Some(&filters))?};if let Some(zone)=zone{presentation::apply_timezone(&mut view,zone);presentation::entry_metadata(&mut view,&r);}if view["analytics_available"]!=true{return Ok((view,vec![]))}let mut keyed=vec![];
            for t in array(&view["ledger"])?{let origin=if sid.is_some(){id.to_string()}else{trade_origin(&r,&map,t)?};let net=decimal(&t["net_pnl"])?;
                let key=json!([origin,t.get("asset_close_event_sequence").unwrap_or(&t["close_event_sequence"]),t["source_operation_id"],if truth(&t["source_position_id"]){&t["source_position_id"]}else{&t["trade_id"]},t.get("asset_close_cursor_index").unwrap_or(&t["close_cursor_index"]),t["close_time_utc"].to_string(),t["price_close"].to_string(),net.normalized().to_string()]).to_string();
                let mut t=t.clone();if include_ledger{merge(&mut t,&json!({"session_id":id,"session_name":if truth(&r["payload"]["name"]){r["payload"]["name"].clone()}else{json!(id)},"account_currency":view["account_currency"],"starting_balance":view["metrics"]["starting_balance"],"source_provenance":view["provenance"],"origin_session_id":origin}));}keyed.push((key,t));}Ok((view,keyed))})();
        match one{Err(_)=>excluded.push(json!({"session_id":id,"reason":"replay_analytics_source_invalid"})),Ok((v,keyed))=>{if v["analytics_available"]!=true{excluded.push(json!({"session_id":id,"reason":v["blocked_by_data"][0].as_str().unwrap_or("execution_unavailable")}));continue}sources.push(json!({"session_id":id,"revision":r["revision"],"dataset_id":r["payload"]["dataset_id"],"dataset_sha256":v["dataset_sha256"],"cutoff_timestamp":v["cutoff_timestamp"],"closed_trade_count":array(&v["ledger"])?.len()}));for(k,t)in keyed{if !seen.insert(k){duplicate+=1}else{trades.push(t)}}}}
    }
    let unknown_activity=if activity_basis{trades.iter().filter(|t|t["report_time_utc"].is_null()).count()}else{0};
    if activity_basis {
        let from=timestamp(&filters["from_close_utc"])?;let to=timestamp(&filters["to_close_utc"])?;
        trades.retain(|t|{
            let time=timestamp(activity::time(t)).ok().flatten();
            (filters["side"]=="all"||text(&t["side"]).to_lowercase()==text(&filters["side"]))
            &&(filters["outcome"]=="all"||number(&t["net_pnl"]).map(outcome).unwrap_or("unknown")==text(&filters["outcome"]))
            &&from.is_none_or(|f|time.is_some_and(|t|t>=f))&&to.is_none_or(|f|time.is_some_and(|t|t<=f))
        });
        trades.sort_by_key(|t|timestamp(activity::time(t)).ok().flatten());
    }
    let mut months=BTreeMap::<String,Vec<Value>>::new();let mut symbols=BTreeMap::<String,Vec<Value>>::new();for t in &trades{if let Some(d)=timestamp(activity::time(t))?{months.entry(d.with_timezone(&zone.unwrap_or(chrono_tz::UTC)).format("%Y-%m").to_string()).or_default().push(t.clone())}let symbol=if truth(&t["symbol"]){text(&t["symbol"])}else{"Chưa có symbol"};symbols.entry(symbol.to_string()).or_default().push(t.clone());}
    let mut month_values=vec![];for(k,v)in months{let mut c=counts(&v)?;c["month"]=json!(k);month_values.push(c)}
    let mut symbol_values=vec![];let mut symbols=symbols.into_iter().collect::<Vec<_>>();symbols.sort_by(|a,b|b.1.len().cmp(&a.1.len()).then(a.0.cmp(&b.0)));for(k,v)in symbols{let mut c=counts(&v)?;c["symbol"]=json!(k);symbol_values.push(c)}
    let unavailable=!selected.is_empty()&&sources.is_empty();let mut metrics=counts(&trades)?;if unavailable{for v in metrics.as_object_mut().unwrap().values_mut(){*v=Value::Null;}}
    let mut result=json!({"schema_version":"dashboard-replay-performance-v1","status":if excluded.is_empty(){"ready"}else{"partial"},"as_of_utc":iso(Utc::now()),"scope":{"source":"persisted_replay_execution","session_id":sid,"session_ids":selected.iter().map(|r|r["record_id"].clone()).collect::<Vec<_>>(),"session_count":selected.len(),"readable_session_count":sources.len(),"filters":filters,"includes_archived":true,"duplicate_trade_count":duplicate,"aggregation":"unique_closed_fills_within_root_lineage","timezone":zone.unwrap_or(chrono_tz::UTC).name()},"metrics":metrics,"side_counts":{"buy":if unavailable{None}else{Some(trades.iter().filter(|t|t["side"]=="BUY").count())},"sell":if unavailable{None}else{Some(trades.iter().filter(|t|t["side"]=="SELL").count())}},"months":month_values,"symbols":symbol_values,"sessions":sessions,"sources":sources,"excluded":excluded});
    if activity_basis{let known=trades.iter().filter(|t|!t["report_time_utc"].is_null()).count();result["scope"]["time_basis"]=json!("activity");result["scope"]["recording_coverage"]=json!({"known_close_count":known,"unknown_close_count":unknown_activity,"selected_known_close_count":known,"legacy_backfill":false});}
    if activity_basis{merge(&mut result,&presentation::dashboard_activity(&selected,intervals,Some(&filters),zone.unwrap_or(chrono_tz::UTC))?);}else{merge(&mut result,&dashboard_timing(&selected,intervals)?);if let Some(zone)=zone{result["activity_months"]=presentation::activity_months(&selected,intervals,zone)?;result["timing_scope"]["timezone"]=json!(zone.name());}}if include_ledger{result["ledger"]=json!(trades)}Ok(result)
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn closed_cost_projection_preserves_unknown_and_rounded_account_identity() {
        assert_eq!(closed_costs(&json!({"net_pnl":17}), &json!("USD")).unwrap(), (None,None));
        let mut details=json!({"net_pnl":"-2.28","cost_breakdown":{"account_ccy":"USD","net_account":"-2.28","gross_account":"-0.28"}});
        assert_eq!(closed_costs(&details,&json!("USD")).unwrap(),(Some(-0.28),Some(2.0)));
        details["net_pnl"]=json!("0.99");details["cost_breakdown"]=json!({"account_ccy":"USD","gross_account":"1.01","net_account":"0.99","commission_account":"0.01","slippage_account":"0.00","financing_account":"0.00"});
        assert_eq!(closed_costs(&details,&json!("USD")).unwrap(),(Some(1.01),Some(0.02)));
        assert!(closed_costs(&details,&json!("EUR")).is_err());
        details["net_pnl"]=json!("0.98");assert!(closed_costs(&details,&json!("USD")).is_err());
    }
    fn assert_parity(a:&Value,b:&Value,path:&str){match(a,b){(Value::Number(a),Value::Number(b))=>{let(a,b)=(a.as_f64().unwrap(),b.as_f64().unwrap());assert!((a-b).abs()<=1e-11*a.abs().max(b.abs()).max(1.0),"{path}: {a} != {b}");},(Value::Array(a),Value::Array(b))=>{assert_eq!(a.len(),b.len(),"{path}");for(i,(a,b))in a.iter().zip(b).enumerate(){assert_parity(a,b,&format!("{path}/{i}"));}},(Value::Object(a),Value::Object(b))=>{assert_eq!(a.keys().collect::<Vec<_>>(),b.keys().collect::<Vec<_>>(),"{path}");for(k,v)in a{assert_parity(v,&b[k],&format!("{path}/{k}"));}},_=>assert_eq!(a,b,"{path}")}}
    #[test]
    fn python_oracle_parity(){let cases:Value=serde_json::from_str(include_str!("analytics/oracle_cases.json")).unwrap();for(i,raw)in cases["cases"].as_array().unwrap().iter().enumerate(){let mut c=raw.clone();c["input"]=cases["inputs"][c["input_ref"].as_u64().unwrap() as usize].clone();if !c["journals_ref"].is_null(){c["journals"]=cases["inputs"][c["journals_ref"].as_u64().unwrap() as usize].clone();}let mut output=match text(&c["kind"]){"prop"=>prop_profile::evaluate_prop_profile(&c["input"]["profile"],&c["input"]["snapshot"]),"summary"=>build_session_summary(&c["input"],"tenant-a"),"trades"=>trades::build_trades_page(&c["input"],c["journals"].as_array().unwrap(),c["args"]["page"].as_u64().unwrap() as usize,c["args"]["page_size"].as_u64().unwrap() as usize,text(&c["args"]["sort_key"]),text(&c["args"]["sort_direction"]),text(&c["args"]["extra_filters"]),None),"replay"=>build_replay_analytics_view(&c["input"],Some(&c["filters"])),"analytics"=>build_analytics_view(&c["input"],Some(&c["filters"])),"dashboard"=>build_dashboard_performance(c["input"].as_array().unwrap(),"tenant-a",None,None,Some(&c["filters"]),true,&[]),_=>unreachable!()}.unwrap_or_else(|e|panic!("case {i}: {e}"));if c["kind"]=="dashboard"{output.as_object_mut().unwrap().remove("as_of_utc");}
        // Intentional presentation correction: the frozen Python oracle's 12
        // HCM cases have local-day filters but an incorrectly UTC date facet.
        if c["kind"]=="trades"&&(158..170).contains(&i){assert_eq!(c["expected"]["facets"]["date_range"],json!({"from":"2023-11-14","to":"2023-11-15"}));c["expected"]["facets"]["date_range"]=json!({"from":"2023-11-15","to":"2023-11-15"});}assert_parity(&output,&c["expected"],&format!("case-{i}"));}}
}
