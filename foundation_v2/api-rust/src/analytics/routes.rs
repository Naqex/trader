use super::*;
use crate::{auth::{ApiError,Workspace},state::AppState};
use axum::{Router,Json,extract::{State,Request},http::{StatusCode,header},response::{Response,IntoResponse},routing::{get,post}};
use std::sync::Arc;
use tokio_postgres::Transaction;
use std::{collections::VecDeque,sync::Mutex};
#[derive(Default)]
struct CacheItems{items:VecDeque<(String,Arc<Value>,usize)>,bytes:usize}
#[derive(Default)]
pub struct ProjectionCache{inner:Mutex<CacheItems>}
fn cached(cache:&ProjectionCache,key:&str)->Option<Arc<Value>>{let mut c=cache.inner.lock().ok()?;let i=c.items.iter().position(|(k,_,_)|k==key)?;let item=c.items.remove(i)?;let v=item.1.clone();c.items.push_back(item);Some(v)}
fn retain(cache:&ProjectionCache,key:String,v:Value)->Arc<Value>{
    fn retained(v:&Value)->usize{std::mem::size_of::<Value>()+match v{Value::String(s)=>s.capacity(),Value::Array(a)=>a.capacity()*std::mem::size_of::<Value>()+a.iter().map(retained).sum::<usize>(),Value::Object(o)=>o.iter().map(|(k,v)|96+k.capacity()+retained(v)).sum(),_=>0}}
    // Conservative owned-tree accounting bounds the cache, including map allocation overhead.
    let bytes=retained(&v).saturating_add(key.capacity());let v=Arc::new(v);
    if bytes>64*1024*1024{return v}let Ok(mut c)=cache.inner.lock()else{return v};
    if let Some(i)=c.items.iter().position(|(k,_,_)|*k==key){let old=c.items.remove(i).unwrap();c.bytes-=old.2;}
    while c.bytes.saturating_add(bytes)>64*1024*1024||c.items.len()>=24{let Some(old)=c.items.pop_front()else{break};c.bytes-=old.2;}
    c.bytes+=bytes;c.items.push_back((key,v.clone(),bytes));v
}
async fn record_heads(tx:&Transaction<'_>,workspace:&str,kind:&str)->Result<Vec<Value>,ApiError>{tx.query("SELECT r.record_id,r.current_revision FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id=$1 AND r.kind=$2 AND NOT v.deleted ORDER BY r.updated_at_utc DESC,r.record_id",&[&workspace,&kind]).await.map_err(|_|ApiError::database()).map(|rs|rs.iter().map(|r|json!([r.get::<_,String>(0),r.get::<_,i32>(1)])).collect())}
async fn catalog_records(tx:&Transaction<'_>,workspace:&str)->Result<Vec<Value>,ApiError>{
    let rows=tx.query("SELECT r.record_id,r.current_revision,r.created_at_utc,r.updated_at_utc,v.payload_json-'execution'-'asset_states' AS payload_json,((v.payload_json->'execution' IS NOT NULL AND v.payload_json->'execution'<>'null'::jsonb) OR CASE WHEN jsonb_typeof(v.payload_json->'asset_states')='object' THEN EXISTS(SELECT 1 FROM jsonb_each(v.payload_json->'asset_states') s WHERE s.value->'execution' IS NOT NULL AND s.value->'execution' NOT IN ('null'::jsonb,'false'::jsonb,'0'::jsonb,'\"\"'::jsonb,'[]'::jsonb,'{}'::jsonb)) ELSE false END) AS has_execution FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id=$1 AND r.kind='replay' AND NOT v.deleted ORDER BY r.updated_at_utc DESC,r.record_id",&[&workspace]).await.map_err(|_|ApiError::database())?;
    Ok(rows.iter().map(|r|json!({"record_id":r.get::<_,String>(0),"revision":r.get::<_,i32>(1),"created_at_utc":r.get::<_,String>(2),"updated_at_utc":r.get::<_,String>(3),"payload":r.get::<_,Value>(4),"has_execution":r.get::<_,bool>(5)})).collect())
}
async fn summary(cache:&ProjectionCache,tx:&Transaction<'_>,workspace:&str,record:&Value,zone:chrono_tz::Tz,activity_basis:bool)->Result<Value,ApiError>{
    let key=json!(["summary-v3",workspace,record["record_id"],record["revision"],zone.name(),activity_basis]).to_string();if let Some(v)=cached(cache,&key){return Ok(v.as_ref().clone())}
    let full=crate::replay_service::load_record(tx,workspace,text(&record["record_id"]),false).await?;let mut value=if activity_basis{build_activity_session_summary(&full,workspace,zone)}else{build_session_summary_in_timezone(&full,workspace,zone)}.map_err(source)?;
    if !activity_basis && value["status"]=="ready" { value["equity_curve"]=activity::equity_curve(&full["payload"],None,false).map_err(source)?;value["periods"]["time_basis"]=json!("market"); }
    Ok(retain(cache,key,value).as_ref().clone())
}
pub fn native(method:&str,path:&str)->bool{if method=="POST"&&path=="/api/v2/analytics/prop/evaluate"{return true}method=="GET"&&matches!(path,"/api/v2/overview"|"/api/v2/dashboard/sessions"|"/api/v2/replay/trades"|"/api/v2/replay/sessions/{session_id}/analytics"|"/api/v2/replay/sessions/{session_id}/analytics.csv")}
pub fn routes()->Router<Arc<AppState>>{Router::new().route("/api/v2/analytics/prop/evaluate",post(prop_evaluate)).route("/api/v2/overview",get(invoke)).route("/api/v2/dashboard/sessions",get(invoke)).route("/api/v2/replay/trades",get(invoke)).route("/api/v2/replay/sessions/{session_id}/analytics",get(invoke)).route("/api/v2/replay/sessions/{session_id}/analytics.csv",get(invoke))}
fn bad(s:impl AsRef<str>)->ApiError{ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY,s.as_ref())}
fn source(s:impl AsRef<str>)->ApiError{ApiError::detail(StatusCode::SERVICE_UNAVAILABLE,s.as_ref())}
fn qint(q:&HashMap<String,String>,key:&str)->Result<Option<i64>,ApiError>{q.get(key).map(|s|s.parse().map_err(|_|bad(format!("{key} must be integer")))).transpose()}
fn filters(q:&HashMap<String,String>)->Value{let mut f=json!({});for k in ["side","outcome","from_close_utc","to_close_utc"]{if let Some(v)=q.get(k){f[k]=json!(v)}}f}
fn presentation_query(q:&HashMap<String,String>)->Result<(chrono_tz::Tz,String),ApiError>{
    let mut extra:Value=serde_json::from_str(q.get("extra_filters").map(String::as_str).filter(|v|!v.is_empty()).unwrap_or("{}")).map_err(|_|bad("trade_page_filters_invalid"))?;
    let extra=extra.as_object_mut().ok_or_else(||bad("trade_page_filters_invalid"))?;
    let inherited=extra.get("timezone").map(|v|v.as_str().ok_or_else(||bad("trade_page_filters_invalid"))).transpose()?.filter(|v|!v.is_empty());
    let zone=presentation::timezone(q.get("timezone").map(String::as_str).or(inherited)).map_err(bad)?;
    if q.contains_key("timezone")&&inherited.is_some_and(|v|presentation::timezone(Some(v)).ok()!=Some(zone)){return Err(bad("analytics_timezone_conflict"))}
    extra.insert("timezone".into(),json!(zone.name()));
    Ok((zone,serde_json::to_string(extra).expect("JSON filter object")))
}
async fn records(tx:&Transaction<'_>,workspace:&str,kind:&str)->Result<Vec<Value>,ApiError>{
    let rows=tx.query("SELECT r.record_id,r.source_key,r.current_revision,r.created_at_utc,r.updated_at_utc,v.payload_json FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id=$1 AND r.kind=$2 AND NOT v.deleted ORDER BY r.updated_at_utc DESC,r.record_id",&[&workspace,&kind]).await.map_err(|_|ApiError::database())?;
    let mut records=Vec::with_capacity(rows.len());
    for row in rows {
        let id:String=row.get(0);
        let revision:i32=row.get(2);
        let payload:Value=row.get(5);
        // Performance projections consume the complete ledger at this exact revision.
        let payload=if kind=="replay"{
            crate::replay_storage::hydrate_payload(tx,workspace,&id,i64::from(revision),payload).await.map_err(|_|source("trade_ledger_source_invalid"))?
        }else{payload};
        records.push(json!({"record_id":id,"source_key":row.get::<_,Option<String>>(1),"revision":revision,"created_at_utc":row.get::<_,String>(3),"updated_at_utc":row.get::<_,String>(4),"payload":payload,"deleted":false}));
    }
    Ok(records)
}
async fn activity(tx:&Transaction<'_>,workspace:&str)->Result<Vec<Value>,ApiError>{tx.query("SELECT session_id,started_at_utc,ended_at_utc FROM replay_activity_intervals WHERE workspace_id=$1 ORDER BY started_at_utc",&[&workspace]).await.map_err(|_|ApiError::database()).map(|rs|rs.iter().map(|r|json!({"session_id":r.get::<_,String>(0),"started_at_utc":iso(r.get::<_,DateTime<Utc>>(1)),"ended_at_utc":iso(r.get::<_,DateTime<Utc>>(2))})).collect())}
async fn invoke(State(state):State<Arc<AppState>>,scope:Workspace,request:Request)->Result<Response,ApiError>{
    let cache=&state.analytics_cache;
    let path=request.uri().path().to_string();let q:HashMap<String,String>=form_urlencoded::parse(request.uri().query().unwrap_or("").as_bytes()).map(|(k,v)|(k.into_owned(),v.into_owned())).collect();
    let (zone,extra_filters)=presentation_query(&q)?;
    let activity_basis=match q.get("time_basis").map(String::as_str).unwrap_or("market"){"activity"=>true,"market"=>false,_=>return Err(bad("analytics_time_basis_invalid"))};
    let f=normalize_filters(Some(&filters(&q))).map_err(bad)?;
    let mut client=state.pool.get().await.map_err(|_|ApiError::database())?;
    let tx=client.build_transaction().isolation_level(tokio_postgres::IsolationLevel::RepeatableRead).read_only(true).start().await.map_err(|_|ApiError::database())?;
    let result=if path.contains("/sessions/")&&(path.ends_with("/analytics")||path.ends_with("/analytics.csv")){
        let id=path.split('/').nth(5).ok_or_else(||bad("invalid replay path"))?;
        let record=crate::replay_service::load_record(&tx,&scope.workspace_id,id,false).await?;
        let mut record=crate::replay_service::checkpoint_record(&tx,&state,&scope.workspace_id,record,qint(&q,"cursor_index")?,qint(&q,"cutoff_timestamp")?,qint(&q,"event_sequence")?).await.map_err(|e|if e.0==StatusCode::UNPROCESSABLE_ENTITY{bad("replay_analytics_invalid_source_or_filter")}else{e})?;record["workspace_id"]=json!(scope.workspace_id);
        let mut view=if activity_basis{activity::view(&record,Some(&f),zone)}else{build_replay_analytics_view(&record,Some(&f))}.map_err(|_|bad("replay_analytics_invalid_source_or_filter"))?;
        if path.ends_with(".csv"){let csv=analytics_csv(&view);tx.commit().await.map_err(|_|ApiError::database())?;return Ok(([(header::CONTENT_TYPE,"text/csv; charset=utf-8"),(header::CONTENT_DISPOSITION,"attachment; filename=\"replay-analytics-v1.csv\"")],csv).into_response())}
        presentation::apply_timezone(&mut view,zone);presentation::entry_metadata(&mut view,&record);
        if !activity_basis { view["scope"]["time_basis"]=json!("market");view["equity_curve"]=activity::equity_curve(&record["payload"],Some(&f),false).map_err(source)?; }
        view
    }else if path=="/api/v2/dashboard/sessions"{
        let mut records=catalog_records(&tx,&scope.workspace_id).await?;enrich_identities(&tx,&scope.workspace_id,&mut records).await?;
        dashboard_sessions(cache,&tx,&scope.workspace_id,&records,&q,zone,activity_basis).await?
    }else{
        let heads=record_heads(&tx,&scope.workspace_id,"replay").await?;
        let mut selected=q.get("sessions").map(|s|s.split(',').filter(|s|!s.is_empty()).map(str::to_owned).collect::<Vec<_>>());
        let sid=q.get("session_id").map(String::as_str);
        if sid.is_some_and(|id|!heads.iter().any(|h|h[0]==id))||selected.as_ref().is_some_and(|ids|ids.iter().any(|id|!heads.iter().any(|h|h[0]==*id))){return Err(ApiError::detail(StatusCode::NOT_FOUND,"replay_not_found"))}
        let dashboard_source=if path=="/api/v2/overview" { q.get("dashboard_source").map(String::as_str).unwrap_or("all") } else { "all" };
        if !["backtest","prop","all"].contains(&dashboard_source){return Err(bad("invalid_dashboard_source"))}
        if path=="/api/v2/overview" {
            let mut identities=catalog_records(&tx,&scope.workspace_id).await?;
            enrich_identities(&tx,&scope.workspace_id,&mut identities).await?;
            selected=Some(dashboard_source_ids(&identities,dashboard_source,sid,selected.as_deref()));
        }
        let paged=path=="/api/v2/replay/trades"&&q.contains_key("page");
        let page=if paged{qint(&q,"page")?.unwrap_or(1)}else{1};let size=qint(&q,"page_size")?.unwrap_or(10);
        if paged&&(page<1||!(1..=100).contains(&size)){return Err(bad("trade_page_parameters_invalid"))}
        let mut journal_heads=if paged{record_heads(&tx,&scope.workspace_id,"journal").await?}else{vec![]};
        if paged{journal_heads.extend(record_heads(&tx,&scope.workspace_id,"trade_label").await?);journal_heads.extend(record_heads(&tx,&scope.workspace_id,"trade_label_assignment").await?);}
        let page_key=json!(["trade-page-v1",scope.workspace_id,heads,journal_heads,q.iter().collect::<BTreeMap<_,_>>()]).to_string();
        if let Some(hit)=if paged{cached(cache,&page_key)}else{None}{hit.as_ref().clone()}else{
            let report_key=json!(["performance-v4",scope.workspace_id,heads,dashboard_source,sid,selected,f,path!="/api/v2/overview",zone.name(),activity_basis]).to_string();
            let (report,source_records)=if let Some(report)=cached(cache,&report_key){(report,None)}else{
                let records=records(&tx,&scope.workspace_id,"replay").await?;
                let report=if activity_basis{build_activity_dashboard(&records,&scope.workspace_id,sid,selected.as_deref(),Some(&f),path!="/api/v2/overview",&[],zone)}else{build_dashboard_performance_in_timezone(&records,&scope.workspace_id,sid,selected.as_deref(),Some(&f),path!="/api/v2/overview",&[],zone)}.map_err(|e|if e=="replay session not found"{ApiError::detail(StatusCode::NOT_FOUND,"replay_not_found")}else{source("trade_ledger_source_invalid")})?;
                (retain(cache,report_key,report),Some(records))
            };
            if paged{
                let facet_key=json!(["performance-v4-facets",scope.workspace_id,heads,sid,selected,normalize_filters(None).unwrap(),true,zone.name(),activity_basis]).to_string();
                let facet=if f==normalize_filters(None).unwrap()||!truth(&f){report.clone()}else if let Some(facet)=cached(cache,&facet_key){facet}else{
                    let records=if let Some(r)=source_records{r}else{records(&tx,&scope.workspace_id,"replay").await?};
                    retain(cache,facet_key,if activity_basis{build_activity_dashboard(&records,&scope.workspace_id,sid,selected.as_deref(),None,true,&[],zone)}else{build_dashboard_performance_in_timezone(&records,&scope.workspace_id,sid,selected.as_deref(),None,true,&[],zone)}.map_err(source)?)
                };
                let journals=records_for_journals(&tx,&scope.workspace_id).await?;
                let mut report=report.as_ref().clone();let mut facet=facet.as_ref().clone();
                report["label_revision_key"]=json!(journal_heads);
                for projection in [&mut report,&mut facet]{
                    if let Some(rows)=projection["ledger"].as_array_mut(){
                        for row in rows.iter_mut(){*row=trades::decorate(row,&journals);}
                        crate::trade_labels::project(&tx,&scope.workspace_id,rows,None).await?;
                    }
                }
                let value=trades::build_trades_page(&report,&journals,page as usize,size as usize,q.get("sort_key").map(String::as_str).unwrap_or(if activity_basis{"report_time_utc"}else{"close_time_utc"}),q.get("sort_direction").map(String::as_str).unwrap_or("desc"),&extra_filters,Some(&facet)).map_err(bad)?;
                retain(cache,page_key,value).as_ref().clone()
            }else{
                let intervals=activity(&tx,&scope.workspace_id).await?;
                let metadata=tx.query("SELECT r.record_id,jsonb_build_object('timing',v.payload_json->'timing') FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id=$1 AND r.kind='replay' AND NOT v.deleted",&[&scope.workspace_id]).await.map_err(|_|ApiError::database())?.iter().map(|r|json!({"record_id":r.get::<_,String>(0),"payload":r.get::<_,Value>(1)})).filter(|r|sid.is_none_or(|id|r["record_id"]==id)&&selected.as_ref().is_none_or(|ids|ids.iter().any(|id|r["record_id"]==*id))).collect::<Vec<_>>();
                let mut report=report.as_ref().clone();report["as_of_utc"]=json!(iso(Utc::now()));merge(&mut report,&dashboard_timing(&metadata,&intervals).map_err(source)?);report["activity_months"]=presentation::activity_months(&metadata,&intervals,zone).map_err(source)?;report["timing_scope"]["timezone"]=json!(zone.name());
                if path=="/api/v2/overview"{report["scope"]["dashboard_source"]=json!(dashboard_source);let mut out=overview(&tx,&scope.workspace_id).await?;out["performance"]=report;out}else{report}
            }
        }
    };tx.commit().await.map_err(|_|ApiError::database())?;Ok(Json(result).into_response())
}
async fn records_for_journals(tx:&Transaction<'_>,workspace:&str)->Result<Vec<Value>,ApiError>{records(tx,workspace,"journal").await}
async fn overview(tx:&Transaction<'_>,workspace:&str)->Result<Value,ApiError>{
    let n:i64=tx.query_one("SELECT count(*) FROM datasets WHERE workspace_id=$1",&[&workspace]).await.map_err(|_|ApiError::database())?.get(0);
    let mut jobs=json!({});for r in tx.query("SELECT status,count(*) FROM research_jobs WHERE workspace_id=$1 GROUP BY status",&[&workspace]).await.map_err(|_|ApiError::database())?{jobs[r.get::<_,String>(0)]=json!(r.get::<_,i64>(1));}
    let mut records=json!({});for r in tx.query("SELECT kind,count(*) FROM workspace_records WHERE workspace_id=$1 GROUP BY kind",&[&workspace]).await.map_err(|_|ApiError::database())?{records[r.get::<_,String>(0)]=json!(r.get::<_,i64>(1));}
    Ok(json!({"counts":{"datasets":n,"research_jobs":jobs,"records":records},"ai":crate::control_routes::ai_status(),"execution":crate::catalog::capabilities(),"blocked_reasons":["u1_owner_visual_approval","real_data_qa","real_ai_provider_approval","demo_broker_acceptance","live_execution_authorization","miro_update_permission"]}))
}
async fn dashboard_sessions(cache:&ProjectionCache,tx:&Transaction<'_>,workspace:&str,records:&[Value],q:&HashMap<String,String>,zone:chrono_tz::Tz,activity_basis:bool)->Result<Value,ApiError>{
    let page=qint(q,"page")?.unwrap_or(1);let size=qint(q,"page_size")?.unwrap_or(6);if page<1||!(1..=25).contains(&size){return Err(bad("invalid_dashboard_page"))}
    let sort=q.get("sort").map(String::as_str).unwrap_or("newest");let search=q.get("search").map(String::as_str).unwrap_or("");let asset=q.get("asset").map(String::as_str).unwrap_or("");let strategy=q.get("strategy").map(String::as_str).unwrap_or("");if !["newest","oldest","last","profit"].contains(&sort)||search.chars().count()>200||asset.chars().count()>128||strategy.chars().count()>128{return Err(bad("invalid_dashboard_filters"))}
    let mut manifests=HashMap::new();for r in tx.query("SELECT dataset_id,manifest_json FROM datasets WHERE workspace_id=$1",&[&workspace]).await.map_err(|_|ApiError::database())?{manifests.insert(r.get::<_,String>(0),r.get::<_,Value>(1));}
    let mut revision_records=records.iter().map(|r|json!([r["record_id"],r["revision"]])).collect::<Vec<_>>();revision_records.sort_by(|a,b|text(&a[0]).cmp(text(&b[0])));let mut revision_datasets=manifests.values().map(|m|json!([m["dataset_id"],m["artifact_sha256"]])).collect::<Vec<_>>();revision_datasets.sort_by(|a,b|text(&a[0]).cmp(text(&b[0])));
    use sha2::{Digest,Sha256};let stamp=format!("{:x}",Sha256::digest(trades::python_json(&json!({"workspace":workspace,"records":revision_records,"datasets":revision_datasets}),true)));
    if q.get("revision").is_some_and(|r|!r.is_empty()&&*r!=stamp){return Err(ApiError::detail(StatusCode::CONFLICT,"dashboard_revision_changed"))}
    let mut items=vec![];let mut by_id=HashMap::new();
    for r in records{let mut r=r.clone();if r.get("has_execution").is_none(){r["has_execution"]=json!(truth(&r["payload"]["execution"])||r["payload"]["asset_states"].as_object().is_some_and(|o|o.values().any(|s|truth(&s["execution"]))));}let mut item=crate::catalog::replay_catalog_item(&r,&manifests)?;item["strategy"]=r["payload"]["playbook_id"].clone();if item["archived"]==false{items.push(item)}by_id.insert(text(&r["record_id"]).to_string(),r);}
    let assets:BTreeSet<String>=items.iter().flat_map(|i|i["instrument_ids"].as_array().unwrap().iter().map(|v|text(v).to_string())).collect();let strategies:BTreeSet<_>=items.iter().filter_map(|i|i["strategy"].as_str()).collect();let unassigned=items.iter().any(|i|i["strategy"].is_null());let total=items.len();let needle=presentation::search_text(search);
    let facets=json!({"assets":assets,"strategies":strategies,"unassigned":unassigned});
    items.retain(|i|{let hay=[text(&i["name"]),text(&i["record_id"]),text(&i["instrument_id"]),text(&i["timeframe"])].join(" ")+" "+&i["instrument_ids"].as_array().unwrap().iter().map(text).collect::<Vec<_>>().join(" ");let hay=presentation::search_text(&hay);needle.split_whitespace().all(|word|hay.contains(word))&&(asset.is_empty()||i["instrument_ids"].as_array().unwrap().contains(&json!(asset)))&&(strategy.is_empty()||if strategy=="unassigned"{i["strategy"].is_null()}else{i["strategy"]==strategy})});
    items.sort_by(|a,b|{let key=if sort=="last"{"updated_at_utc"}else{"created_at_utc"};let date=text(&a[key]).cmp(text(&b[key]));(if sort=="oldest"{date}else{date.reverse()}).then(text(&a["record_id"]).cmp(text(&b["record_id"]))) });
    let mut summaries=HashMap::new();let mut comparable=true;
    if sort=="profit"{for i in &items{let id=text(&i["record_id"]);summaries.insert(id.to_string(),summary(cache,tx,workspace,&by_id[id],zone,activity_basis).await?);}let currencies:BTreeSet<_>=summaries.values().filter(|v|!v["pnl"].is_null()).map(|v|v["currency"].to_string()).collect();comparable=currencies.len()<=1&&!currencies.contains("null");if comparable{items.sort_by(|a,b|{let(aid,bid)=(text(&a["record_id"]),text(&b["record_id"]));let(a,b)=(&summaries[aid]["pnl"],&summaries[bid]["pnl"]);a.is_null().cmp(&b.is_null()).then_with(||b.as_f64().unwrap_or(0.0).partial_cmp(&a.as_f64().unwrap_or(0.0)).unwrap()).then(aid.cmp(bid))});}}
    let count=items.len();let pages=count.div_ceil(size as usize).max(1);let page=(page as usize).min(pages);let mut visible:Vec<_>=items.into_iter().skip((page-1)*size as usize).take(size as usize).collect();
    for i in &mut visible{let id=text(&i["record_id"]).to_string();i["detail"]=if let Some(v)=summaries.get(&id){v.clone()}else{summary(cache,tx,workspace,&by_id[&id],zone,activity_basis).await?};i["dataset"]=if let Some(m)=manifests.get(text(&i["dataset_id"])){let mut d=json!({});for k in ["dataset_id","instrument_id","timeframe","row_count","first_timestamp","last_timestamp"]{d[k]=m[k].clone()}d}else{Value::Null};}
    let summary_values:Vec<&Value>=if sort=="profit"{summaries.values().collect()}else{visible.iter().map(|i|&i["detail"]).collect()};let unavailable=summary_values.iter().filter(|s|s["unavailable"]==true).count();
    Ok(json!({"status":if unavailable>0{"partial"}else{"ready"},"summary_unavailable_count":unavailable,"summary_scope_count":summary_values.len(),"schema_version":"dashboard-session-list-v1","workspace_id":workspace,"revision":stamp,"as_of_utc":iso(Utc::now()),"items":visible,"facets":facets,"total":total,"matching_count":count,"page":page,"page_size":size,"pages":pages,"profit_comparable":comparable,"freshness":"current_revision"}))
}
pub fn analytics_csv(view:&Value)->String{
    fn cell(v:&Value)->String{
        let mut s=match v{Value::Null=>String::new(),Value::String(s)=>s.clone(),Value::Bool(b)=>if *b{"True".into()}else{"False".into()},Value::Array(_)|Value::Object(_)=>trades::python_json(v,false),Value::Number(n) if n.is_f64()=>crate::research_jobs::python_float(n.as_f64().unwrap()).expect("finite JSON number"),_=>v.to_string()};
        if v.is_string()&&matches!(s.chars().next(),Some('='|'+'|'-'|'@')){s="'".to_string()+&s;}
        if s.contains([',','"','\n','\r']){format!("\"{}\"",s.replace('"',"\"\""))}else{s}
    }
    // JSON objects are stored in sorted maps; the public CSV retains the Python
    // projection's field order rather than exposing that implementation detail.
    let provenance=["job_id","workspace_id","dataset_id","dataset_sha256","protocol_sha256","metrics_schema_version","split","playbook_id","playbook_revision","created_at_utc"];
    let replay=["session_id","workspace_id","dataset_id","dataset_sha256","revision","branch_id","parent_session_id","cursor_index","canonical_cursor_index","canonical_execution_event_sequence","historical_view","cutoff_timestamp","created_at_utc","mode","timezone","instrument_id","timeframe","timeframe_seconds","account_currency","open_position_count","pending_order_count","phase_transition_count","execution_event_sequence","phase_index","phase_initial_balance","data_quality"];
    let portfolio=["session_id","workspace_id","revision","dataset_id","dataset_ids","dataset_hashes","branch_id","parent_session_id","cursor_index","canonical_cursor_index","historical_view","cutoff_timestamp","mode","timezone","account_currency","instrument_id","instrument_ids","open_position_count","pending_order_count","execution_event_sequence","data_quality"];
    let metrics=["metric_schema_version","closed_trade_count","wins","losses","breakeven","win_rate_pct","loss_rate_pct","gross_pnl","fees","net_pnl","profit_factor_after_cost","payoff_ratio_after_cost","expectancy_net_per_trade","average_realized_r","realized_r_known_count","gross_pnl_known_count","fees_known_count","closed_trade_balance_max_drawdown","closed_trade_balance_max_drawdown_pct","max_loss_streak","starting_balance","ending_closed_trade_balance","basis"];
    let mut lines=vec!["section,field,value".into()];
    for section in ["provenance","filters","scope","metrics"]{
        let Some(o)=view[section].as_object()else{continue};
        let mut fields:Vec<&str>=match section{
            "provenance"=>{let mut keys=provenance.to_vec();if !view[section]["session_id"].is_null(){for k in if view[section].get("dataset_ids").is_some(){portfolio.as_slice()}else{replay.as_slice()}{if !keys.contains(k){keys.push(k)}}}keys},
            "filters"=>vec!["side","outcome","from_close_utc","to_close_utc"],
            "scope"=>vec!["selected_trade_count","total_trade_count","active_filters","observed_range","balance_curve_scope"],
            _=>if view["analytics_available"]==true{metrics.to_vec()}else{vec![]}
        };
        for k in o.keys(){if !fields.contains(&k.as_str()){fields.push(k)}}
        for k in fields{
            let Some(v)=o.get(k)else{continue};
            if section=="metrics"&&["closed_trade_balance_curve","closed_trade_balance_drawdown_curve","realized_r_values","definitions"].contains(&k){continue}
            let empty_sum=section=="metrics"&&view["analytics_available"]==true&&view["metrics"]["closed_trade_count"]==0&&["gross_pnl","fees","net_pnl"].contains(&k)&&!v.is_null();
            let value=if empty_sum{"0".into()}else{cell(v)};
            lines.push(format!("{section},{},{value}",cell(&json!(k))));
        }
    }
    lines.push(String::new());let mut fields=vec!["trade_id","open_time_utc","close_time_utc","symbol","side","quantity","price_open","price_close","gross_pnl","fees","net_pnl","planned_risk_budget","realized_r","legacy_r","legacy_result"];if view["scope"]["time_basis"]=="activity"{fields.extend(["report_time_utc","close_recorded_at_utc"]);}lines.push(fields.join(","));if let Some(ledger)=view["ledger"].as_array(){for t in ledger{lines.push(fields.iter().map(|k|cell(&t[k])).collect::<Vec<_>>().join(","));}}lines.join("\n")+"\n"
}
async fn prop_evaluate(scope:Workspace,Json(body):Json<Value>)->Result<Json<Value>,ApiError>{let _=scope;if !body.is_object()||body.as_object().unwrap().keys().any(|k|!["profile","snapshot"].contains(&k.as_str()))||!body["profile"].is_object()||!body["snapshot"].is_object(){return Err(bad("profile and snapshot must be objects"))}Ok(Json(super::prop_profile::evaluate_prop_profile(&body["profile"],&body["snapshot"]).map_err(bad)?))}

#[cfg(test)]
mod csv_tests{
 use super::*;
 #[test]
 fn dashboard_search_matches_vietnamese_accents_and_unordered_tokens(){
    let name=presentation::search_text("  Luyện Tập ĐẶT Lệnh EURUSD  ");
    assert_eq!(name,"luyen tap dat lenh eurusd");
    assert_eq!(presentation::search_text("Đa\u{0323}\u{0306}t"),"dat");
    assert!(presentation::search_text("eurusd   LUYỆN").split_whitespace().all(|word|name.contains(word)));
    assert!(!presentation::search_text("eurusd bitcoin").split_whitespace().all(|word|name.contains(word)));
 }
 #[test]
 fn timezone_query_validates_inheritance_conflicts_and_cache_isolation(){
    let q=|pairs:&[(&str,&str)]|pairs.iter().map(|(k,v)|(k.to_string(),v.to_string())).collect::<HashMap<_,_>>();
    assert_eq!(presentation_query(&q(&[])).unwrap().0,chrono_tz::UTC);
    let (zone,extra)=presentation_query(&q(&[("timezone","Asia/Ho_Chi_Minh")])).unwrap();
    assert_eq!(zone.name(),"Asia/Ho_Chi_Minh");assert_eq!(serde_json::from_str::<Value>(&extra).unwrap()["timezone"],"Asia/Ho_Chi_Minh");
    assert_eq!(presentation_query(&q(&[("extra_filters",r#"{"timezone":"America/New_York"}"#)])).unwrap().0.name(),"America/New_York");
    assert_eq!(presentation_query(&q(&[("timezone","UTC+7")])).unwrap_err().0,StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(presentation_query(&q(&[("timezone","UTC"),("extra_filters",r#"{"timezone":"Asia/Ho_Chi_Minh"}"#)])).unwrap_err().1["detail"],"analytics_timezone_conflict");
    let cache=ProjectionCache::default();
    let utc=json!(["summary-v2","w","s",1,"UTC"]).to_string();let local=json!(["summary-v2","w","s",1,zone.name()]).to_string();
    retain(&cache,utc.clone(),json!({"month":"2026-01"}));retain(&cache,local.clone(),json!({"month":"2026-02"}));
    assert_eq!(cached(&cache,&utc).unwrap()["month"],"2026-01");assert_eq!(cached(&cache,&local).unwrap()["month"],"2026-02");
 }
 #[test]
 fn python_csv_bytes(){let cases:Value=serde_json::from_str(include_str!("../../tests/rust_context/csv_oracle.json")).unwrap();for(i,c)in cases.as_array().unwrap().iter().enumerate(){let view=if c["kind"]=="replay"{build_replay_analytics_view(&c["source"],Some(&c["filters"]))}else{build_analytics_view(&c["source"],Some(&c["filters"]))}.unwrap();assert_eq!(analytics_csv(&view),c["expected"].as_str().unwrap(),"case {i}")}}
}

async fn enrich_identities(tx:&Transaction<'_>,workspace:&str,records:&mut[Value])->Result<(),ApiError>{
 let rows=tx.query(crate::catalog::REPLAY_IDENTITIES,&[&workspace]).await.map_err(|_|ApiError::database())?;
 let mut bindings=HashMap::new();for r in rows{let id:String=r.get(0);let v=json!({"session_kind":"prop","prop_session_id":r.get::<_,String>(1),"prop_attempt_id":r.get::<_,String>(2)});if bindings.get(&id).is_some_and(|p|p!=&v){return Err(source("dashboard_source_invalid"))}bindings.insert(id,v);}
 for r in records{if let Some(identity)=bindings.get(text(&r["record_id"])){merge(&mut r["payload"],identity)}}Ok(())
}

// Keep the complete replay ancestry for fill deduplication; narrow only the selected IDs.
fn dashboard_source_ids(records:&[Value],source:&str,sid:Option<&str>,selected:Option<&[String]>)->Vec<String>{
    let mut ids=records.iter().filter(|r| {
        let prop=r["payload"]["session_kind"]=="prop";
        (source=="all" || prop==(source=="prop"))
            && sid.is_none_or(|id|r["record_id"]==id)
            && selected.is_none_or(|ids|ids.iter().any(|id|r["record_id"]==*id))
    }).map(|r|text(&r["record_id"]).to_owned()).collect::<Vec<_>>();
    ids.sort();ids.dedup();ids
}
#[cfg(test)]
mod source_tests {
    use super::*;
    #[test] fn source_intersects_explicit_scope_without_turning_empty_into_all(){
        let records=vec![json!({"record_id":"b","payload":{}}),json!({"record_id":"p","payload":{"session_kind":"prop"}})];
        assert_eq!(dashboard_source_ids(&records,"all",None,None),vec!["b","p"]);
        assert_eq!(dashboard_source_ids(&records,"prop",None,None),vec!["p"]);
        assert_eq!(dashboard_source_ids(&records,"backtest",None,None),vec!["b"]);
        assert!(dashboard_source_ids(&records,"prop",Some("b"),None).is_empty());
        assert!(dashboard_source_ids(&records,"all",None,Some(&[])).is_empty());
        let mut rebound=records.clone();rebound[0]["payload"]["session_kind"]=json!("prop");
        assert_eq!(dashboard_source_ids(&rebound,"prop",None,None),vec!["b","p"]);
    }
}
