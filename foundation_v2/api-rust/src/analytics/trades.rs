use super::*;
use chrono::{NaiveDateTime, TimeZone, Timelike};
use chrono_tz::Tz;
use sha2::{Digest,Sha256};
use std::cmp::Ordering;

const LISTS:&[&str]=&["reportKinds","assets","sides","outcomes","types","years","months","days","hours","tagInclude","tagExclude","notesPresence","statuses"];
const KEYS:&[&str]=&["asset","tag","strategy","source","weekday","hour","timeStart","timeEnd","reportKinds","timezone","search","notes","assets","sides","outcomes","types","years","months","days","hours","tagInclude","tagExclude","tagIncludeMode","tagExcludeMode","notesPresence","statuses"];
const SORTS:&[&str]=&["session_id","status","source","recorded_at_utc","report_time_utc","open_time_utc","symbol","side","entry_type","net_pnl","return_pct","realized_r","rating","price_open","quantity","stop_loss","take_profit","close_time_utc","price_close","gross_pnl","fees","tags"];
fn ts(v:&Value)->Option<DateTime<Utc>>{if v.is_null()||v.is_boolean(){return None}if let Ok(mut n)=number(v){if n.abs()>=1e11{n/=1000.0}let s=n.floor();return DateTime::from_timestamp(s as i64,((n-s)*1e9).round()as u32)}let s=text(v);DateTime::parse_from_rfc3339(s).map(|d|d.with_timezone(&Utc)).ok().or_else(||NaiveDateTime::parse_from_str(s,"%Y-%m-%dT%H:%M:%S").ok().map(|d|Utc.from_utc_datetime(&d)))}
fn strings(v:&Value)->Vec<String>{v.as_array().map(|a|a.iter().map(|v|if v.is_string(){text(v).to_owned()}else{v.to_string()}).collect()).unwrap_or_default()}
pub(super) fn python_str(v:&Value)->String{if v.is_null(){"None".into()}else if v.is_string(){text(v).into()}else{v.to_string()}}
fn parse(raw:&str)->R<(Value,Tz,bool)>{
    let raw=if raw.is_empty(){"{}"}else{raw};let mut f:Value=serde_json::from_str(raw).map_err(|_|"trade_page_filters_invalid")?;let original=f.clone();
    let o=f.as_object_mut().ok_or("trade_page_filters_invalid")?;
    if o.keys().any(|k|!KEYS.contains(&k.as_str())){return Err("trade_page_filters_invalid".into())}
    for(k,v)in o.iter_mut(){if LISTS.contains(&k.as_str()){if v==""{*v=json!([])}else if let Some(s)=v.as_str(){*v=serde_json::from_str(s).map_err(|_|"trade_page_filters_invalid")?;}let a=v.as_array_mut().ok_or("trade_page_filters_invalid")?;for v in a{if !(v.is_string()||v.as_i64().is_some()||v.as_u64().is_some()){return Err("trade_page_filters_invalid".into())}*v=json!(if v.is_string(){text(v).to_string()}else{v.to_string()});}}else if !v.is_string(){return Err("trade_page_filters_invalid".into())}}
    let zone=text(&f["timezone"]);let zone=if zone.is_empty(){"UTC"}else{zone}.parse::<Tz>().map_err(|_|"trade_page_filters_invalid")?;
    for k in ["timeStart","timeEnd"]{if truth(&f[k]){let s=text(&f[k]);if s.len()!=5||s.as_bytes()[2]!=b':'||s[..2].parse::<u8>().ok().is_none_or(|h|h>23)||s[3..].parse::<u8>().ok().is_none_or(|m|m>59){return Err("trade_page_filters_invalid".into())}}}
    for k in ["tagIncludeMode","tagExcludeMode"]{if let Some(v)=f.get(k){if !["AND","OR"].contains(&text(v)){return Err("trade_page_filters_invalid".into())}}}
    for(k,max)in[("weekday",6),("hour",23)]{if truth(&f[k])&&f[k]!="all"&&text(&f[k]).parse::<u32>().ok().is_none_or(|n|n>max||n.to_string()!=text(&f[k])){return Err("trade_page_filters_invalid".into())}}
    for(k,valid)in[("sides",vec!["buy","sell"]),("outcomes",vec!["win","loss","breakeven","unknown"]),("reportKinds",vec!["app","prop","research","battles"]),("notesPresence",vec!["with","without"]),("statuses",vec!["closed"])]{if strings(&f[k]).iter().any(|s|!valid.contains(&s.as_str())){return Err("trade_page_filters_invalid".into())}}
    for(k,lo,hi)in[("days",0,6),("hours",0,23),("months",1,12)]{if strings(&f[k]).iter().any(|s|s.parse::<i32>().ok().is_none_or(|n|n<lo||n>hi||n.to_string()!=*s)){return Err("trade_page_filters_invalid".into())}}
    let empty=f.get("reportKinds").is_some_and(|v|!truth(v))&&original["reportKinds"]!="";Ok((f,zone,empty))
}
pub(crate) fn decorate(raw:&Value,journals:&[Value])->Value{
    let mut r=raw.clone();r["report_kind"]=json!("app");let mut tags=strings(&r["tags"]);let mut notes=truth(&r["note"])&& !text(&r["note"]).trim().is_empty()||truth(&r["notes"])&&!text(&r["notes"]).trim().is_empty();
    for j in journals{let p=&j["payload"];let s=&p["source"];if ["session_id","replay_session_id"].iter().any(|k|s[k]==r["session_id"])&&["trade_id","id"].iter().any(|k|s[k]==r["trade_id"]){if r["labels_authoritative"]!=true{tags.extend(strings(&p["tags"]));}let n=if truth(&p["note"]){&p["note"]}else{&p["notes"]};notes|=!text(n).trim().is_empty()}}
    let mut seen=HashSet::new();tags.retain(|t|seen.insert(t.clone()));r["tags"]=json!(tags);r["has_notes"]=json!(notes);r
}
fn matches(r:&Value,f:&Value,zone:Tz,empty:bool)->R<bool>{
    if empty{return Ok(false)}let date=ts(activity::time(r)).map(|d|d.with_timezone(&zone));let weekday=date.map(|d|d.weekday().num_days_from_sunday());
    let minute=date.map(|d|d.hour()*60+d.minute());let parse_min=|k:&str|->Option<u32>{let s=text(&f[k]);if s.is_empty(){None}else{Some(s[..2].parse::<u32>().unwrap()*60+s[3..].parse::<u32>().unwrap())}};
    let(start,end)=(parse_min("timeStart"),parse_min("timeEnd"));if start.is_some()||end.is_some(){let Some(m)=minute else{return Ok(false)};let pass=if start.zip(end).is_some_and(|(s,e)|s>e){m>=start.unwrap()||m<=end.unwrap()}else{start.is_none_or(|s|m>=s)&&end.is_none_or(|e|m<=e)};if !pass{return Ok(false)}}
    let n=number(&r["net_pnl"])?;let values=json!({"notesPresence":if r["has_notes"]==true{"with"}else{"without"},"statuses":"closed","reportKinds":"app","assets":r["symbol"],"sides":text(&r["side"]).to_lowercase(),"outcomes":outcome(n),"types":r["entry_type"],"years":date.map(|d|d.year()),"months":date.map(|d|d.month()),"days":weekday,"hours":date.map(|d|d.hour())});
    for(k,v)in values.as_object().unwrap(){if truth(&f[k])&&!strings(&f[k]).contains(&python_str(v)){return Ok(false)}}
    let source=if r["source"].is_object(){r["source"]["session_id"].clone()}else if truth(&r["source"]){r["source"].clone()}else{r["session_id"].clone()};let values=json!({"asset":r["symbol"],"strategy":r["playbook_id"],"source":source,"weekday":weekday,"hour":date.map(|d|d.hour())});
    for(k,v)in values.as_object().unwrap(){if f.get(k).is_some()&&truth(&f[k])&&f[k]!="all"&&python_str(v)!=text(&f[k]){return Ok(false)}}
    let mut tags=strings(&r["tags"]);tags.extend(strings(&r["label_aliases"]));if truth(&f["tag"])&&f["tag"]!="all"&&!tags.contains(&text(&f["tag"]).to_string()){return Ok(false)}
    for k in ["tagInclude","tagExclude"]{let chosen=strings(&f[k]);if !chosen.is_empty(){let group=if f[format!("{k}Mode")]=="OR"{chosen.iter().any(|v|tags.contains(v))}else{chosen.iter().all(|v|tags.contains(v))};if group==(k=="tagExclude"){return Ok(false)}}}
    let search=presentation::search_text(text(&f["search"]));let id=serde_json::to_string(&json!([r["session_id"],r["trade_id"]])).unwrap();let hay=presentation::search_text(&std::iter::once(id).chain([python_str(&r["trade_id"]),python_str(&r["symbol"]),python_str(&r["side"])]).chain(tags).collect::<Vec<_>>().join(" "));
    if !search.split_whitespace().all(|token|hay.contains(token)){return Ok(false)}let notes=text(&f["notes"]).trim().to_lowercase();Ok(notes.is_empty()||["notes","note"].iter().any(|k|text(&r[k]).to_lowercase().contains(&notes)))
}
fn sort_value(r:&Value,key:&str)->Value{match key{"session_id"=>if truth(&r["session_name"]){r["session_name"].clone()}else{r["session_id"].clone()},"source"=>json!("Replay"),"status"=>json!("Closed"),"return_pct"=>{let n=number(&r["starting_balance"]).unwrap_or(0.0);if n>0.0{json!(number(&r["net_pnl"]).unwrap_or(0.0)/n*100.0)}else{Value::Null}},"tags"=>json!(strings(&r["tags"]).join(", ")),_=>{if key.ends_with("_time_utc")||key=="recorded_at_utc"{json!(ts(&r[key]).map(|d|d.timestamp_micros()as f64/1e6))}else if ["net_pnl","realized_r","rating","price_open","quantity","stop_loss","take_profit","price_close","gross_pnl","fees"].contains(&key){json!(number(&r[key]).ok())}else{r[key].clone()}}}}
pub fn python_json(v:&Value,spaces:bool)->String{
    fn quote(s:&str)->String{let quoted=serde_json::to_string(s).unwrap();let mut out=String::new();for c in quoted.chars(){if c as u32>127{let mut buf=[0u16;2];for u in c.encode_utf16(&mut buf){out.push_str(&format!("\\u{u:04x}"));}}else{out.push(c)}}out}
    let comma=if spaces{", "}else{","};let colon=if spaces{": "}else{":"};match v{Value::String(s)=>quote(s),Value::Array(a)=>format!("[{}]",a.iter().map(|v|python_json(v,spaces)).collect::<Vec<_>>().join(comma)),Value::Object(o)=>format!("{{{}}}",o.iter().map(|(k,v)|format!("{}{}{}",quote(k),colon,python_json(v,spaces))).collect::<Vec<_>>().join(comma)),_=>v.to_string()}
}
pub fn build_trades_page(report:&Value,journals:&[Value],page:usize,page_size:usize,sort_key:&str,sort_direction:&str,extra_filters:&str,facet_report:Option<&Value>)->R<Value>{
    if page<1||!(1..=100).contains(&page_size)||!SORTS.contains(&sort_key)||!["asc","desc"].contains(&sort_direction){return Err("trade_page_parameters_invalid".into())}
    let(f,zone,empty)=parse(extra_filters)?;let facet=facet_report.unwrap_or(report);let rows=array(&report["ledger"])?;let faceted:Vec<_>=array(&facet["ledger"])?.iter().map(|r|decorate(r,journals)).collect();
    let mut assets=BTreeSet::new();let(mut tags,mut strategies,mut years,mut types)=(BTreeSet::new(),BTreeSet::new(),BTreeSet::new(),BTreeSet::new());let mut dates=vec![];let mut has_notes=false;
    for r in &faceted{if truth(&r["symbol"]){assets.insert(text(&r["symbol"]).to_string());}tags.extend(strings(&r["tags"]));if truth(&r["playbook_id"]){strategies.insert(text(&r["playbook_id"]).to_string());}if truth(&r["entry_type"]){types.insert(text(&r["entry_type"]).to_string());}has_notes|=r["has_notes"]==true;if let Some(d)=ts(activity::time(r)){let d=d.with_timezone(&zone);dates.push(d.date_naive().to_string());years.insert(d.year().to_string());}}
    let scope=strings(&facet["scope"]["session_ids"]);if let Some(sessions)=facet["sessions"].as_array(){for s in sessions{if truth(&s["instrument_id"])&&scope.contains(&text(&s["session_id"]).to_string()){assets.insert(text(&s["instrument_id"]).to_string());}}}dates.sort();
    let mut filtered=vec![];for(i,r)in rows.iter().enumerate(){let r=decorate(r,journals);if matches(&r,&f,zone,empty)?{let val=sort_value(&r,sort_key);filtered.push((i,r,val));}}
    filtered.sort_by(|a,b|{let(l,r)=(&a.2,&b.2);if l.is_null()||r.is_null(){return if l.is_null()&&r.is_null(){Ordering::Equal}else if l.is_null(){Ordering::Greater}else{Ordering::Less}}let result=if let(Some(l),Some(r))=(l.as_f64(),r.as_f64()){l.partial_cmp(&r).unwrap_or(Ordering::Equal)}else{python_str(l).cmp(&python_str(r))};let result=if sort_direction=="desc"{result.reverse()}else{result};result.then(a.0.cmp(&b.0))});
    let count=if report["metrics"]["closed_trade_count"].is_null(){None}else{Some(filtered.len())};let pages=count.map(|n|n.div_ceil(page_size));let page=page.min(pages.unwrap_or(1).max(1));let visible:Vec<_>=filtered.into_iter().skip((page-1)*page_size).take(page_size).map(|(_,r,_)|r).collect();
    let snapshot=json!({"scope":report["scope"],"sources":report["sources"],"excluded":report["excluded"],"journals":journals.iter().map(|r|json!([r["record_id"],r["revision"]])).collect::<Vec<_>>(),"filters":f});let mut snapshot=snapshot;if let Some(labels)=report.get("label_revision_key"){snapshot["labels"]=labels.clone();}let hash=format!("{:x}",Sha256::digest(python_json(&snapshot,true)));
    let mut scope=report["scope"].clone();scope["extra_filters"]=f;
    Ok(json!({"schema_version":"replay-trades-page-v1","status":report["status"],"scope":scope,"sources":report["sources"],"excluded":report["excluded"],"sessions":report["sessions"],"ledger":visible,"facets":{"assets":assets,"tags":tags,"strategies":strategies,"years":years,"types":types,"has_notes":has_notes,"date_range":{"from":dates.first(),"to":dates.last()}},"sort":{"key":sort_key,"direction":sort_direction},"snapshot_key":hash,"pagination":{"page":page,"page_size":page_size,"returned_count":visible.len(),"filtered_count":count,"page_count":pages,"has_next":pages.is_some_and(|n|page<n)}}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filter_search_facets_and_count_cover_rows_beyond_first_page() {
        let rows:Vec<_>=(0..35).map(|i|json!({"trade_id":format!("t-{i:02}"),"session_id":"s","symbol":if i==34{"XAU/USD"}else{"EUR/USD"},"side":if i==34{"BUY"}else{"SELL"},"net_pnl":i,"tags":if i==34{vec!["Kỷ luật tốt"]}else{vec![]},"starting_balance":1000,"entry_type":"market"})).collect();
        let report=json!({"ledger":rows,"metrics":{"closed_trade_count":35},"scope":{"session_ids":["s"]},"sessions":[],"status":"ready"});
        let first=build_trades_page(&report,&[],1,10,"net_pnl","asc","{}",None).unwrap();
        assert!(!first["ledger"].as_array().unwrap().iter().any(|r|r["symbol"]=="XAU/USD"));
        assert!(first["facets"]["assets"].as_array().unwrap().contains(&json!("XAU/USD")));
        for filters in [json!({"assets":["XAU/USD"],"sides":["buy"],"outcomes":["win"]}),json!({"search":"  TOT  ky   LUAT "})] {
            let page=build_trades_page(&report,&[],3,10,"net_pnl","asc",&filters.to_string(),None).unwrap();
            assert_eq!(page["pagination"]["filtered_count"],1);assert_eq!(page["pagination"]["page_count"],1);assert_eq!(page["pagination"]["page"],1);
            assert_eq!(page["ledger"][0]["trade_id"],"t-34");
        }
    }
}
