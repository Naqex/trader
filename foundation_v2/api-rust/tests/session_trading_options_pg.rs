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
    for legacy in [false,true] {
    let mut manifest = imported["dataset"].clone();
    if legacy {
        // Reproduce the owner's pre-spec slash-symbol manifest in this disposable DB only.
        manifest.as_object_mut().unwrap().remove("instrument_spec");
        manifest["instrument_id"] = json!("EUR/USD");
        let conn = state.pool.get().await.unwrap();
        conn.execute("UPDATE datasets SET manifest_json=$1 WHERE workspace_id='tenant-a' AND dataset_id=$2",&[&manifest,&manifest["dataset_id"].as_str().unwrap()]).await.unwrap();
    }
    let instrument = trading_workspace_api::provider_routes::catalog::replay_instrument(&manifest).unwrap();
    let dataset = manifest["dataset_id"].as_str().unwrap();
    for (prop, v2, mode) in [(false,false,"off"),(true,false,"off"),(false,true,"fixed"),(true,true,"fixed"),(false,true,"off"),(false,true,"light"),(false,true,"medium")] {
        let mut options = json!({"version":if v2 { "session-trading-options-v2" } else { "session-trading-options-v1" },"costs_enabled":false,"assets":{dataset:{"spread_price":"0.0002","commission_per_lot":"7","commission_charge":"round_trip","slippage_price":"0"}}});
        if v2 {
            options["assets"][dataset].as_object_mut().unwrap().remove("slippage_price");
            options["assets"][dataset]["slippage"] = if mode == "fixed" { json!({"mode":mode,"fixed_steps":2}) } else { json!({"mode":mode}) };
        }
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
            attempt["cost_version"] = json!(if v2 { "session-cost-v2" } else { "session-cost-v1" });
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
        assert_eq!(created["payload"]["trading_options"]["version"],options["version"]);
        let path = format!("/api/v2/replay/sessions/{}",created["record_id"].as_str().unwrap());
        let (status,mut opened) = request(&app,"POST",&format!("{path}/orders/quick"),json!({"expected_revision":created["revision"],"operation_id":"open","side":"SELL","quantity":"0.01","execution_timing":"current_quote","instrument_spec":instrument,"timeframe_seconds":60,"starting_balance":"100000","spread_price":"0.0002","cost_model":{"version":"old-fixture","account_ccy":"USD","commission_per_side_account":"1"}})).await;
        assert_eq!(status,200,"{opened}");
        if v2 {
            let (status,protected) = request(&app,"POST",&format!("{path}/orders/protection"),json!({"expected_revision":opened["revision"],"operation_id":"protect","target_id":opened["payload"]["execution"]["position"]["position_id"],"stop_loss":"1.12100","take_profit":"1.12000"})).await;
            assert_eq!(status,200,"{protected}"); opened = protected;
        }
        let execution = &opened["payload"]["execution"];
        let entry_fill = execution["position"]["entry_fill"].as_str().unwrap().parse::<BigDecimal>().unwrap();
        let base = "1.12044".parse::<BigDecimal>().unwrap();
        let expected_fp = (&entry_fill - &base) * BigDecimal::from(1000);
        if v2 {
            assert!(entry_fill <= base);
            assert_eq!(execution["position"]["entry_slippage"]["maximum_ticks"],match mode { "off"=>0,"light"=>10,"medium"=>30,_=>20 });
            if mode == "fixed" { assert_eq!(entry_fill,"1.12024".parse::<BigDecimal>().unwrap()); }
        } else { assert_eq!(entry_fill,base); }
        assert_eq!(execution["floating_pl"].as_str().unwrap().parse::<BigDecimal>().unwrap(),expected_fp);
        assert_eq!(execution["cost_model"]["version"],if v2 { "session-cost-v2" } else { "session-cost-v1" });
        let (status,reloaded) = request(&app,"GET",&path,Value::Null).await;
        assert_eq!(status,200,"{reloaded}");
        assert_eq!(reloaded["payload"]["execution"],opened["payload"]["execution"]);
        let (status,metadata) = request(&app,"GET",&format!("{path}/metadata"),Value::Null).await;
        assert_eq!(status,200,"{metadata}");
        assert_eq!(metadata["payload"]["trading_options"],created["payload"]["trading_options"]);
        let (status,error) = request(&app,"PATCH",&path,json!({"expected_revision":opened["revision"],"trading_options":options})).await;
        assert_eq!(status,422,"{error}");
        if let Some((session,attempt,started)) = prop_ident {
            let mark = execution["ledger"].as_array().unwrap().iter().find(|event|event["kind"]=="price_mark").unwrap();
            let (status,fed) = request(&app,"POST",&format!("{path}/prop/sessions/{session}/attempts/{attempt}/feed"),json!({"replay_event_sequence":mark["sequence"],"expected_prop_revision":started["attempt"]["revision"],"prop_event_sequence":started["phase"]["last_event_sequence"].as_i64().unwrap()+1})).await;
            assert_eq!(status,200,"{fed}");
            assert_eq!(fed["phase"]["equity"].as_str().unwrap().parse::<BigDecimal>().unwrap(),BigDecimal::from(100000)+&expected_fp);
        }
        let (status,closed) = request(&app,"POST",&format!("{path}/orders/close"),json!({"expected_revision":opened["revision"],"operation_id":"close","target_id":execution["position"]["position_id"]})).await;
        assert_eq!(status,200,"{closed}");
        let close_event = closed["payload"]["execution"]["ledger"].as_array().unwrap().iter().find(|event|event["kind"]=="manual_close").unwrap();
        let exit_fill = close_event["details"]["fill_price"].as_str().unwrap().parse::<BigDecimal>().unwrap();
        let expected_balance = BigDecimal::from(100000) + (&entry_fill - exit_fill)*BigDecimal::from(1000);
        assert_eq!(closed["payload"]["execution"]["balance"].as_str().unwrap().parse::<BigDecimal>().unwrap(),expected_balance);
        let (status,branched) = request(&app,"POST",&format!("{path}/branch"),json!({"expected_revision":closed["revision"],"cursor_index":0})).await;
        assert_eq!(status,201,"{branched}");
        assert_eq!(branched["payload"]["trading_options"],created["payload"]["trading_options"]);
        if v2 { assert_eq!(branched["payload"]["trading_options_seed"],created["payload"]["trading_options_seed"]); }
    }
    }
    state.pool.close();
}
