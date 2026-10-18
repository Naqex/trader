//! Production HTTP routes, disposable database and local CSV only; never owner data.
use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use bigdecimal::BigDecimal;
use tower::ServiceExt;
use trading_workspace_api::{config::Config, data_routes, prop_service, replay_service, state::AppState};

async fn request(app: &axum::Router, method: &str, path: &str, body: Value) -> (u16, Value) {
    let response = app.clone().oneshot(Request::builder().method(method).uri(path)
        .header("x-workspace-id","tenant-a").header("content-type","application/json")
        .body(if method == "GET" { Body::empty() } else { Body::from(body.to_string()) }).unwrap()).await.unwrap();
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status,serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
#[ignore = "owned disposable PostgreSQL via session_trading_options_pg.py only"]
async fn frozen_options_backtest_and_prop_http_workflow() {
    let state = AppState::connect(Config::from_environment().unwrap()).await.unwrap();
    let conn = state.pool.get().await.unwrap();
    let db: String = conn.query_one("SELECT current_database()", &[]).await.unwrap().get(0);
    assert!(db.starts_with("rust_metadata_"),"refuse owner database"); drop(conn);
    let app = data_routes::routes().merge(replay_service::routes()).merge(prop_service::routes()).with_state(state.clone());
    let import = json!({"csv_text":"time,open,high,low,close,volume\n1767268800,1.12044,1.12050,1.12030,1.12044,3\n1767268860,1.12044,1.12050,1.12030,1.12044,3\n1767268920,1.12044,1.12050,1.12030,1.12044,3\n","source":{"source_id":"session-cost-test","provider":"CSV","instrument_mapping":{"EURUSD":"EUR/USD"},"license_use":"owner fixture","retrieved_at_utc":"2026-10-17","export_settings":"UTF-8"},"instrument":{"instrument_id":"EURUSD","asset_class":"forex","base_ccy":"EUR","quote_ccy":"USD","account_ccy":"USD","tick_size":"0.00001","pip_size":"0.0001","contract_size":"100000","quantity_min":"0.01","quantity_step":"0.01","effective_from_utc":"2020-01-01"},"timeframe_seconds":60});
    let (status, imported) = request(&app,"POST","/api/v2/data/csv/import",import).await;
    assert_eq!(status,201,"{imported}");
    let manifest = &imported["dataset"];
    let dataset = manifest["dataset_id"].as_str().unwrap();
    let options = json!({"version":"session-trading-options-v1","costs_enabled":false,"assets":{dataset:{"spread_price":"0.0002","commission_per_lot":"7","commission_charge":"round_trip","slippage_price":"0"}}});
    for prop in [false,true] {
        let mut body = json!({"dataset_id":dataset,"starting_balance":"100000","trading_options":options});
        let mut prop_ident = None;
        if prop {
            let cases: Value = serde_json::from_str(include_str!("../../evidence/rust-native-20261017/prop/fixtures.json")).unwrap();
            let args = cases.as_array().unwrap().iter().find(|case|case["op"]=="event").unwrap()["args"].as_array().unwrap();
            let (mut session,mut attempt,mut phase) = (args[0].clone(),args[1].clone(),args[2].clone());
            let id = format!("cost-prop-{}",uuid::Uuid::new_v4());
            for value in [&mut session,&mut attempt,&mut phase] { value["session_id"] = json!(id); }
            session["status"] = json!("ready"); session["revision"] = json!(1);
            attempt["status"] = json!("ready"); attempt["revision"] = json!(1);
            attempt["data_version"] = manifest["artifact_sha256"].clone();
            attempt["cost_version"] = json!("session-cost-v1");
            phase["last_event_sequence"] = json!(0);
            let resume = json!({"cursor":{"bar_index":0,"timestamp_utc":phase["virtual_time_utc"]},"open_positions":[],"pending_orders":[]});
            let (status,bundle) = request(&app,"POST","/api/v2/prop/session-bundles",json!({"session":session,"attempt":attempt,"phase":phase,"resume_state":resume})).await;
            assert_eq!(status,201,"{bundle}");
            let intent = json!({"workspace_id":"tenant-a","session_id":id,"attempt_id":attempt["attempt_id"],"profile_hash":attempt["profile_hash"],"intent_id":"start","expected_revision":1,"event_sequence":0,"action":"start"});
            let (status,started) = request(&app,"POST",&format!("/api/v2/prop/sessions/{id}/attempts/{}/transitions",attempt["attempt_id"].as_str().unwrap()),intent).await;
            assert_eq!(status,200,"{started}");
            body["prop_session_id"] = json!(id); body["prop_attempt_id"] = attempt["attempt_id"].clone();
            prop_ident = Some((id,attempt["attempt_id"].as_str().unwrap().to_owned(),started));
        }
        let (status,created) = request(&app,"POST","/api/v2/replay/sessions",body).await;
        assert_eq!(status,201,"{created}");
        assert_eq!(created["payload"]["trading_options"]["version"],"session-trading-options-v1");
        let path = format!("/api/v2/replay/sessions/{}",created["record_id"].as_str().unwrap());
        let (status,opened) = request(&app,"POST",&format!("{path}/orders/quick"),json!({"expected_revision":created["revision"],"operation_id":"open","side":"SELL","quantity":"0.01","execution_timing":"current_quote","instrument_spec":manifest["instrument_spec"],"timeframe_seconds":60,"starting_balance":"100000","spread_price":"0.0002","cost_model":{"version":"old-fixture","account_ccy":"USD","commission_per_side_account":"1"}})).await;
        assert_eq!(status,200,"{opened}");
        let execution = &opened["payload"]["execution"];
        assert_eq!(execution["position"]["entry_fill"],"1.12044");
        assert_eq!(execution["floating_pl"],"0");
        assert_eq!(execution["cost_model"]["version"],"session-cost-v1");
        let (status,metadata) = request(&app,"GET",&format!("{path}/metadata"),Value::Null).await;
        assert_eq!(status,200,"{metadata}");
        assert_eq!(metadata["payload"]["trading_options"],created["payload"]["trading_options"]);
        let (status,error) = request(&app,"PATCH",&path,json!({"expected_revision":opened["revision"],"trading_options":options})).await;
        assert_eq!(status,422,"{error}");
        if let Some((session,attempt,started)) = prop_ident {
            let mark = execution["ledger"].as_array().unwrap().iter().find(|event|event["kind"]=="price_mark").unwrap();
            let (status,fed) = request(&app,"POST",&format!("{path}/prop/sessions/{session}/attempts/{attempt}/feed"),json!({"replay_event_sequence":mark["sequence"],"expected_prop_revision":started["attempt"]["revision"],"prop_event_sequence":started["phase"]["last_event_sequence"].as_i64().unwrap()+1})).await;
            assert_eq!(status,200,"{fed}");
            assert_eq!(fed["phase"]["equity"],"100000");
        }
        let (status,closed) = request(&app,"POST",&format!("{path}/orders/close"),json!({"expected_revision":opened["revision"],"operation_id":"close","target_id":execution["position"]["position_id"]})).await;
        assert_eq!(status,200,"{closed}");
        assert_eq!(closed["payload"]["execution"]["balance"].as_str().unwrap().parse::<BigDecimal>().unwrap(),BigDecimal::from(100000));
        let (status,branched) = request(&app,"POST",&format!("{path}/branch"),json!({"expected_revision":closed["revision"],"cursor_index":0})).await;
        assert_eq!(status,201,"{branched}");
        assert_eq!(branched["payload"]["trading_options"],created["payload"]["trading_options"]);
    }
    state.pool.close();
}
