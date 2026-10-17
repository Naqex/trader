//! Run against the disposable cluster owned by rust_metadata_parity.py.
use axum::{http::{HeaderMap, StatusCode}, response::Response};
use serde_json::{Value, json};
use std::sync::Arc;
use trading_workspace_api::{auth::{ApiError, Workspace}, config::Config, native_mutation::{self, MutationStart}, state::AppState};

async fn state() -> Arc<AppState> {
    let state=AppState::connect(Config::from_environment().unwrap()).await.unwrap();
    let client=state.pool.get().await.unwrap();
    let db:String=client.query_one("SELECT current_database()",&[]).await.unwrap().get(0);
    assert!(db.starts_with("rust_metadata_"),"refuse non-fixture database");
    drop(client); state
}

async fn apply(state:Arc<AppState>,scope:Workspace,key:&str,body:Value,abort:bool)->Result<Response,ApiError> {
    let mut connection=state.pool.get().await.map_err(|_|ApiError::database())?;
    let tx=connection.transaction().await.map_err(|_|ApiError::database())?;
    let mut headers=HeaderMap::new();headers.insert("idempotency-key",key.parse().unwrap());
    let receipt=match native_mutation::begin(&tx,&scope,"POST","/api/v2/journal",None,&headers,&body).await? {
        MutationStart::Replay(response)=>return Ok(response), MutationStart::New(receipt)=>receipt
    };
    let id=uuid::Uuid::new_v4().simple().to_string();
    tx.execute("INSERT INTO workspace_records(workspace_id,kind,record_id,current_revision,created_at_utc,updated_at_utc) VALUES($1,'journal',$2,1,'fixture','fixture')",&[&scope.workspace_id,&id]).await.map_err(|_|ApiError::database())?;
    let value=json!({"record_id":id,"value":body});
    let response=if body["wire_json"]==true {
        native_mutation::finish_json_text(&tx,receipt,StatusCode::CREATED,value).await?
    } else {native_mutation::finish(&tx,receipt,StatusCode::CREATED,value).await?};
    if abort {tx.rollback().await.map_err(|_|ApiError::database())?;return Ok(response)}
    native_mutation::commit(tx,response).await
}

#[tokio::test]
#[ignore="requires explicitly owned disposable PostgreSQL"]
async fn serialized_json_receipt_preserves_wire_bytes_and_rollback() {
    let state=state().await;
    let scope=Workspace{workspace_id:format!("receipt-{}",uuid::Uuid::new_v4()),subject:"local-owner".into()};
    let body=json!({"wire_json":true,"data":"đúng giá 📈".repeat(20000),"amount":"0.1200","null":null});
    let aborted=apply(state.clone(),scope.clone(),"wire",body.clone(),true).await.unwrap();
    let response=apply(state.clone(),scope.clone(),"wire",body.clone(),false).await.unwrap();
    assert_ne!(aborted.headers()["x-command-id"],response.headers()["x-command-id"]);
    assert_eq!(response.headers()["content-type"],"application/json");
    let command=response.headers()["x-command-id"].clone();
    let bytes=axum::body::to_bytes(response.into_body(),1024*1024).await.unwrap();
    let parsed:Value=serde_json::from_slice(&bytes).unwrap();assert_eq!(parsed["value"],body);
    let retry=apply(state.clone(),scope.clone(),"wire",body,false).await.unwrap();
    assert_eq!(retry.headers()["x-command-id"],command);
    assert_eq!(axum::body::to_bytes(retry.into_body(),1024*1024).await.unwrap(),bytes);
    let conn=state.pool.get().await.unwrap();
    let row=conn.query_one("SELECT result_body,result_text,result_headers FROM api_commands WHERE workspace_id=$1 AND idempotency_key='wire'",&[&scope.workspace_id]).await.unwrap();
    assert!(row.get::<_,Option<Value>>(0).is_none());
    assert_eq!(row.get::<_,String>(1).as_bytes(),bytes.as_ref());
    assert_eq!(row.get::<_,Value>(2)["content-type"],"application/json");
    state.pool.close();
}

#[tokio::test]
#[ignore="requires explicitly owned disposable PostgreSQL"]
async fn concurrent_retry_is_one_atomic_effect_and_receipt() {
    let state=state().await;
    let scope=Workspace{workspace_id:format!("receipt-{}",uuid::Uuid::new_v4()),subject:"local-owner".into()};
    let mut tasks=Vec::new();
    for _ in 0..8 {let s=state.clone();let scope=scope.clone();tasks.push(tokio::spawn(async move{apply(s,scope,"concurrent",json!({"note":"same"}),false).await.unwrap()}));}
    let mut ids=Vec::new();for task in tasks {let response=task.await.unwrap();assert_eq!(response.status(),StatusCode::CREATED);ids.push(response.headers()["x-command-id"].to_str().unwrap().to_owned());}
    assert!(ids.iter().all(|id|id==&ids[0]));
    let client=state.pool.get().await.unwrap();
    let row=client.query_one("SELECT (SELECT count(*) FROM workspace_records WHERE workspace_id=$1) AS effects,(SELECT count(*) FROM api_commands WHERE workspace_id=$1 AND status='completed') AS receipts",&[&scope.workspace_id]).await.unwrap();
    assert_eq!(row.get::<_,i64>("effects"),1);assert_eq!(row.get::<_,i64>("receipts"),1);drop(client);
    let error=apply(state.clone(),scope.clone(),"concurrent",json!({"note":"different"}),false).await.unwrap_err();assert_eq!(error.0,StatusCode::CONFLICT);
    assert_eq!(error.1,json!({"detail":"command_idempotency_conflict"}));
    let other=Workspace{workspace_id:format!("receipt-{}",uuid::Uuid::new_v4()),subject:scope.subject.clone()};
    let independent=apply(state.clone(),other,"concurrent",json!({"note":"same"}),false).await.unwrap();
    assert_ne!(independent.headers()["x-command-id"].to_str().unwrap(),ids[0]);
    state.pool.close();
}

#[tokio::test]
#[ignore="requires explicitly owned disposable PostgreSQL"]
async fn concurrent_serialized_retry_preserves_one_effect_and_identical_bytes() {
    let state=state().await;
    let scope=Workspace{workspace_id:format!("receipt-{}",uuid::Uuid::new_v4()),subject:"local-owner".into()};
    let barrier=Arc::new(tokio::sync::Barrier::new(8));
    let body=json!({"wire_json":true,"data":"dời SL/TP 📈".repeat(20000),"quantity":"0.0100"});
    let mut tasks=Vec::new();
    for _ in 0..8 {
        let (state,scope,barrier,body)=(state.clone(),scope.clone(),barrier.clone(),body.clone());
        tasks.push(tokio::spawn(async move {
            barrier.wait().await;
            let response=apply(state,scope,"wire-concurrent",body,false).await.unwrap();
            assert_eq!(response.status(),StatusCode::CREATED);
            assert_eq!(response.headers()["content-type"],"application/json");
            let id=response.headers()["x-command-id"].clone();
            (id,axum::body::to_bytes(response.into_body(),1024*1024).await.unwrap())
        }));
    }
    let mut responses=Vec::new();
    for task in tasks {responses.push(task.await.unwrap());}
    assert!(responses.iter().all(|response|response==&responses[0]));
    assert_eq!(serde_json::from_slice::<Value>(&responses[0].1).unwrap()["value"],body);
    let client=state.pool.get().await.unwrap();
    let row=client.query_one("SELECT (SELECT count(*) FROM workspace_records WHERE workspace_id=$1) AS effects,(SELECT count(*) FROM api_commands WHERE workspace_id=$1 AND status='completed' AND result_body IS NULL AND result_text IS NOT NULL) AS receipts",&[&scope.workspace_id]).await.unwrap();
    assert_eq!(row.get::<_,i64>("effects"),1);
    assert_eq!(row.get::<_,i64>("receipts"),1);
    drop(client);
    state.pool.close();
}

#[tokio::test]
#[ignore="requires explicitly owned disposable PostgreSQL"]
async fn rollback_removes_effect_and_receipt_before_retry() {
    let state=state().await;
    let scope=Workspace{workspace_id:format!("receipt-{}",uuid::Uuid::new_v4()),subject:"local-owner".into()};
    let aborted=apply(state.clone(),scope.clone(),"rollback",json!({"value":1}),true).await.unwrap();
    let client=state.pool.get().await.unwrap();
    let rows:i64=client.query_one("SELECT count(*) FROM api_commands WHERE workspace_id=$1",&[&scope.workspace_id]).await.unwrap().get(0);
    assert_eq!(rows,0);drop(client);
    let retried=apply(state.clone(),scope.clone(),"rollback",json!({"value":1}),false).await.unwrap();
    assert_ne!(aborted.headers()["x-command-id"],retried.headers()["x-command-id"]);
    let client=state.pool.get().await.unwrap();
    let count:i64=client.query_one("SELECT count(*) FROM workspace_records WHERE workspace_id=$1",&[&scope.workspace_id]).await.unwrap().get(0);assert_eq!(count,1);
    state.pool.close();
}

#[tokio::test]
#[ignore="requires explicitly owned disposable PostgreSQL"]
async fn expired_legacy_pending_receipt_cannot_execute_again() {
    let state=state().await;
    let scope=Workspace{workspace_id:format!("receipt-{}",uuid::Uuid::new_v4()),subject:"local-owner".into()};
    let mut conn=state.pool.get().await.unwrap();
    let tx=conn.transaction().await.unwrap();
    let mut headers=HeaderMap::new();headers.insert("idempotency-key","old-pending".parse().unwrap());
    assert!(matches!(native_mutation::begin(&tx,&scope,"POST","/api/v2/journal",None,&headers,&json!({"value":1})).await.unwrap(),MutationStart::New(_)));
    tx.execute("UPDATE api_commands SET deadline_at_utc=CURRENT_TIMESTAMP-interval '2 hours',expires_at_utc=CURRENT_TIMESTAMP-interval '1 hour' WHERE workspace_id=$1",&[&scope.workspace_id]).await.unwrap();
    tx.commit().await.unwrap();drop(conn);
    let pending=apply(state.clone(),scope.clone(),"old-pending",json!({"value":1}),false).await.unwrap();
    assert_eq!(pending.status(),StatusCode::GATEWAY_TIMEOUT);
    let conn=state.pool.get().await.unwrap();
    let count:i64=conn.query_one("SELECT count(*) FROM workspace_records WHERE workspace_id=$1",&[&scope.workspace_id]).await.unwrap().get(0);
    assert_eq!(count,0);
    state.pool.close();
}
