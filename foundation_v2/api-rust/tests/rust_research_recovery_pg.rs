//! Lease recovery must obey the same workspace/engine boundary as admission.
use serde_json::{Value, json};
use std::collections::BTreeMap;
use tokio_postgres::Transaction;
use trading_workspace_api::{config::Config, research_jobs::lifecycle, state::AppState};

async fn seed(tx: &Transaction<'_>, workspace: &str) {
    tx.execute(
        "INSERT INTO workspaces(workspace_id,created_at_utc) VALUES($1,'2026-10-17')",
        &[&workspace],
    )
    .await
    .unwrap();
    tx.execute("INSERT INTO datasets(workspace_id,dataset_id,manifest_json,artifact_sha256,created_at_utc) VALUES($1,'recovery-fixture','{}','fixture','2026-10-17')", &[&workspace]).await.unwrap();
    for (id, strategy, protocol, cancel, max_attempts) in [
        ("close", "close-delta-v1", None, false, 3),
        ("cancel", "close-delta-v1", None, true, 3),
        ("exhausted", "close-delta-v1", None, false, 1),
        (
            "reference",
            "bar-breakout-v1",
            Some(json!({"engine":{"version":"bar-breakout-v1","backend":"reference"}})),
            false,
            3,
        ),
        (
            "scientific",
            "bar-breakout-v1",
            Some(json!({"engine":{"version":"bar-breakout-v1","backend":"nautilus"}})),
            false,
            3,
        ),
        (
            "unknown-backend",
            "bar-breakout-v1",
            Some(json!({"engine":{"version":"bar-breakout-v1","backend":"foreign"}})),
            false,
            3,
        ),
        (
            "unknown-version",
            "bar-breakout-v1",
            Some(json!({"engine":{"version":"future","backend":"reference"}})),
            false,
            3,
        ),
        ("unknown-strategy", "foreign-v1", None, false, 3),
        (
            "close-with-protocol",
            "close-delta-v1",
            Some(json!({"engine":{"backend":"reference"}})),
            false,
            3,
        ),
    ] {
        tx.execute("INSERT INTO research_jobs(workspace_id,job_id,dataset_id,strategy_version,starting_balance,status,cancel_requested,attempt_no,max_attempts,retry_base_seconds,lease_owner,lease_token,lease_expires_at_utc,created_at_utc,updated_at_utc,protocol_json) VALUES($1,$2,'recovery-fixture',$3,10000,'running',$4,1,$5,0,'old-worker','old-token',CURRENT_TIMESTAMP-INTERVAL '1 minute','2026-10-17','unchanged',$6)", &[&workspace,&id,&strategy,&cancel,&max_attempts,&protocol]).await.unwrap();
    }
}

async fn snapshot(tx: &Transaction<'_>, workspace: &str) -> BTreeMap<String, Value> {
    tx.query("SELECT job_id,to_jsonb(research_jobs) FROM research_jobs WHERE workspace_id=$1 ORDER BY job_id", &[&workspace]).await.unwrap().into_iter().map(|row| (row.get(0),row.get(1))).collect()
}

#[tokio::test]
#[ignore = "owned disposable PG only"]
async fn native_recovery_preserves_foreign_workspaces_and_unsupported_engines() {
    let state = AppState::connect(Config::from_environment().unwrap())
        .await
        .unwrap();
    let mut conn = state.pool.get().await.unwrap();
    let database: String = conn
        .query_one("SELECT current_database()", &[])
        .await
        .unwrap()
        .get(0);
    assert!(
        database.starts_with("rust_metadata_"),
        "refuse non-fixture database"
    );
    let prefix = format!("recovery-{}", uuid::Uuid::new_v4().simple());
    let a = format!("{prefix}-a");
    let b = format!("{prefix}-b");
    let c = format!("{prefix}-c");
    let d = format!("{prefix}-d");
    let tx = conn.transaction().await.unwrap();
    for workspace in [&a, &b, &c, &d] {
        seed(&tx, workspace).await;
    }
    tx.commit().await.unwrap();

    let tx = conn.transaction().await.unwrap();
    let original_a = snapshot(&tx, &a).await;
    let original_b = snapshot(&tx, &b).await;
    let recovered = lifecycle::recover_native_scoped(&tx, std::slice::from_ref(&a), false)
        .await
        .unwrap();
    assert_eq!(recovered.len(), 4);
    let native_a = snapshot(&tx, &a).await;
    for id in ["close", "reference"] {
        assert_eq!(native_a[id]["status"], "queued");
        assert_eq!(native_a[id]["error_code"], "LEASE_EXPIRED");
        assert!(native_a[id]["lease_token"].is_null());
    }
    assert_eq!(native_a["cancel"]["status"], "canceled");
    assert!(native_a["cancel"]["error_code"].is_null());
    assert_eq!(native_a["exhausted"]["status"], "failed");
    assert_eq!(native_a["exhausted"]["error_code"], "LEASE_RETRY_EXHAUSTED");
    for id in [
        "scientific",
        "unknown-backend",
        "unknown-version",
        "unknown-strategy",
        "close-with-protocol",
    ] {
        assert_eq!(
            native_a[id], original_a[id],
            "unsupported job changed: {id}"
        );
    }
    assert_eq!(snapshot(&tx, &b).await, original_b);
    tx.commit().await.unwrap();

    let tx = conn.transaction().await.unwrap();
    let recovered = lifecycle::recover_native_scoped(&tx, std::slice::from_ref(&a), true)
        .await
        .unwrap();
    assert_eq!(recovered.len(), 1);
    let scientific_a = snapshot(&tx, &a).await;
    assert_eq!(scientific_a["scientific"]["status"], "queued");
    for id in [
        "unknown-backend",
        "unknown-version",
        "unknown-strategy",
        "close-with-protocol",
    ] {
        assert_eq!(scientific_a[id], original_a[id]);
    }
    assert_eq!(snapshot(&tx, &b).await, original_b);
    let original_d = snapshot(&tx, &d).await;
    assert!(
        lifecycle::recover_native_scoped(&tx, &[], true)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(snapshot(&tx, &d).await, original_d);
    tx.commit().await.unwrap();

    // Admission has its own recovery pass; it must not reintroduce global mutation.
    let tx = conn.transaction().await.unwrap();
    let original_c = snapshot(&tx, &c).await;
    tx.execute("UPDATE research_jobs SET status='queued',attempt_no=0,lease_owner=NULL,lease_token=NULL,lease_expires_at_utc=NULL WHERE workspace_id=$1 AND job_id='close'", &[&c]).await.unwrap();
    let claimed = lifecycle::claim_native_scoped(
        &tx,
        "fixture-native",
        30,
        100,
        std::slice::from_ref(&c),
        false,
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(claimed.workspace_id, c);
    assert!(["close", "reference"].contains(&claimed.job_id.as_str()));
    let claimed_c = snapshot(&tx, &c).await;
    assert_eq!(claimed_c["cancel"]["status"], "canceled");
    assert_eq!(claimed_c["exhausted"]["status"], "failed");
    for id in [
        "scientific",
        "unknown-backend",
        "unknown-version",
        "unknown-strategy",
        "close-with-protocol",
    ] {
        assert_eq!(claimed_c[id], original_c[id]);
    }
    assert_eq!(snapshot(&tx, &b).await, original_b);
    assert_eq!(snapshot(&tx, &d).await, original_d);
    tx.commit().await.unwrap();
    println!(
        "scoped lease recovery: workspace, engine, scientific, empty scope, cancellation, retry exhaustion and admission paths passed"
    );
}
