//! Explicit local schema administration; never called by request handlers.
use std::collections::HashMap;
use tokio_postgres::{NoTls,config::Host};
use trading_workspace_api::rust_runtime;

fn materialize_target(args: &[String]) -> Result<Option<&str>, &'static str> {
    if args.first().map(String::as_str) != Some("materialize-replay") { return Ok(None); }
    if args.len() != 4 || args[1] != "--restored-target" || args[3] != "--backup-confirmed"
        || args[2].is_empty() || args[2].len() > 63
    { return Err("materialize-replay requires --restored-target <exact-database-name> --backup-confirmed"); }
    Ok(Some(&args[2]))
}

async fn materialize_replay(client: &mut tokio_postgres::Client, target: &str) -> Result<serde_json::Value, String> {
    let tx = client.transaction().await.map_err(|_| "cannot start replay materialization")?;
    tx.query_one("SELECT pg_advisory_xact_lock($1)", &[&rust_runtime::MIGRATION_LOCK_KEY]).await.map_err(|_| "cannot acquire migration authority")?;
    let current: String = tx.query_one("SELECT current_database()", &[]).await.map_err(|_| "cannot establish restored target")?.get(0);
    if current != target { return Err("explicit restored target does not match connected database".into()); }
    let mut recorded = HashMap::new();
    for row in tx.query("SELECT version,sha256 FROM tw_schema_migrations", &[]).await.map_err(|_| "migration ledger unavailable")? {
        recorded.insert(row.get::<_,String>(0), row.get::<_,String>(1));
    }
    rust_runtime::validate_recorded(&recorded, true)?;
    let isolated = || "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'";
    let connections: i64 = tx.query_one(isolated(), &[]).await.map_err(|_| "cannot verify restored target isolation")?.get(0);
    if connections != 0 { return Err("replay materialization requires a stopped isolated restored target with no other database clients".into()); }
    for lock in [0x54574143_i64, 0x52534A41_i64, 0x41504351_i64] {
        tx.query_one("SELECT pg_advisory_xact_lock($1)", &[&lock]).await.map_err(|_| "cannot acquire worker admission fence")?;
    }
    tx.batch_execute("LOCK TABLE workspace_records, workspace_record_revisions, replay_execution_events, replay_execution_operations, replay_execution_revisions, api_commands, research_jobs, download_job_snapshots IN ACCESS EXCLUSIVE MODE NOWAIT")
        .await.map_err(|_| "active database work prevents replay materialization")?;
    for table in ["api_commands", "research_jobs"] {
        let count: i64 = tx.query_one(&format!("SELECT count(*) FROM {table} WHERE status IN ('queued','running')"), &[]).await.map_err(|_| "cannot verify idle research/API work")?.get(0);
        if count > 0 { return Err("active research/API work prevents replay materialization".into()); }
    }
    let downloads: i64 = tx.query_one("SELECT count(*) FROM download_job_snapshots WHERE snapshot->>'status' IN ('queued','running','pausing')", &[]).await.map_err(|_| "cannot verify idle downloads")?.get(0);
    if downloads > 0 { return Err("active downloads prevent replay materialization".into()); }
    let revisions = tx.query("SELECT workspace_id,kind,record_id,revision FROM workspace_record_revisions WHERE storage_format <> 'full_snapshot' ORDER BY workspace_id,kind,record_id,revision", &[])
        .await.map_err(|_| "cannot enumerate compact replay revisions")?;
    let mut count = 0;
    for row in revisions {
        let workspace: String = row.get(0);
        let kind: String = row.get(1);
        let id: String = row.get(2);
        let revision = i64::from(row.get::<_,i32>(3));
        if kind != "replay" { return Err("unknown compact storage owner".into()); }
        if trading_workspace_api::replay_storage::materialize_revision(&tx, &workspace, &id, revision).await? { count += 1; }
    }
    let remaining: i64 = tx.query_one("SELECT count(*) FROM workspace_record_revisions WHERE storage_format <> 'full_snapshot'", &[]).await.map_err(|_| "cannot verify complete replay materialization")?.get(0);
    if remaining != 0 { return Err("compact replay revisions remain after materialization".into()); }
    tx.batch_execute("SELECT pg_stat_clear_snapshot()").await.map_err(|_| "cannot refresh restored target activity")?;
    let connections: i64 = tx.query_one(isolated(), &[]).await.map_err(|_| "cannot recheck restored target isolation")?.get(0);
    if connections != 0 { return Err("another client connected during replay materialization".into()); }
    tx.commit().await.map_err(|_| "cannot commit replay materialization")?;
    Ok(serde_json::json!({"materialized_revisions":count,"compact_revision_count":0,"compatibility_ready":true,"restored_target":target,"receipt_bytes_preserved":true}))
}

#[tokio::main]
async fn main()->Result<(),Box<dyn std::error::Error>> {
    let args=std::env::args().skip(1).collect::<Vec<_>>();
    let restore_target=materialize_target(&args)?;
    if args.len()==2 && args[0]=="provider-dependency-hash" {
        let hash=trading_workspace_api::provider_routes::dependencies::digest(std::path::Path::new(&args[1]))?;
        println!("{}",serde_json::json!({"sha256":hash}));
        return Ok(());
    }
    if args.len()==2 && matches!(args[0].as_str(),"scientific-capability"|"scientific-capability-metadata") {
        let root=trading_workspace_api::research_jobs::adapter::foundation_root();
        let hash=trading_workspace_api::research_jobs::adapter::engine_code_hash(&root)?;
        let full=args[0]=="scientific-capability";
        let descriptor=if full{trading_workspace_api::research_jobs::adapter::verify_installation(&root,std::path::Path::new(&args[1]),&hash)?}else{trading_workspace_api::research_jobs::adapter::descriptor(&root,std::path::Path::new(&args[1]),&hash)?};
        println!("{}",serde_json::json!({"valid":true,"verification":if full{"installation"}else{"metadata"},"runtime_identity":descriptor["runtime_identity"],"dependency_sha256":descriptor["dependency_sha256"],"dependency_trees":descriptor["dependency_trees"]}));
        return Ok(());
    }
    if args.as_slice()==["routes"] {
        let native = std::env::var("TW_V2_RUNTIME_PROFILE").is_ok_and(|v|v=="native");
        println!("{}",serde_json::json!({"contract_version":trading_workspace_api::CONTRACT_VERSION,"runtime_profile":if native{"native"}else{"compatibility"},"required_command_routes":trading_workspace_api::commands::required_worker_manifest_for(native),"routes":trading_workspace_api::commands::route_inventory_for(native)}));
        return Ok(());
    }
    if restore_target.is_none() && args.as_slice()!=["check"] && args.as_slice()!=["migrate"] && args.as_slice()!=["migrate","--backup-confirmed"] {
        return Err("usage: rust_runtime_admin routes | check | migrate [--backup-confirmed] | materialize-replay --restored-target <database-name> --backup-confirmed".into());
    }
    let dsn=std::env::var("TW_V2_DATABASE_URL").map_err(|_|"TW_V2_DATABASE_URL required")?;
    let config:tokio_postgres::Config=dsn.parse().map_err(|_|"invalid database configuration")?;
    if config.get_hosts().is_empty() || !config.get_hosts().iter().all(|h|matches!(h,Host::Tcp(s) if s=="localhost" || s.parse::<std::net::IpAddr>().is_ok_and(|a|a.is_loopback()))) || !config.get_hostaddrs().iter().all(std::net::IpAddr::is_loopback) {return Err("schema administration requires explicit loopback PostgreSQL".into());}
    let (mut client,connection)=config.connect(NoTls).await.map_err(|_|"database unavailable")?;
    tokio::spawn(async move { let _=connection.await; });
    client.batch_execute("SET statement_timeout='30s'; SET lock_timeout='2s'; SET idle_in_transaction_session_timeout='30s'").await.map_err(|_|"database timeout configuration failed")?;
    if let Some(target)=restore_target {
        println!("{}",materialize_replay(&mut client,target).await?);
    } else if args[0]=="migrate" {
        let applied=rust_runtime::apply_migrations(&mut client,args.len()==2).await?;
        println!("{}",serde_json::json!({"applied":applied}));
    } else {
        let ledger:Option<String>=client.query_one("SELECT to_regclass('public.tw_schema_migrations')::text",&[]).await.map_err(|_|"migration ledger unavailable")?.get(0);
        let mut recorded=HashMap::new();
        if ledger.is_some() {for row in client.query("SELECT version,sha256 FROM tw_schema_migrations",&[]).await.map_err(|_|"migration ledger unavailable")? {recorded.insert(row.get::<_,String>(0),row.get::<_,String>(1));}}
        let pending=rust_runtime::validate_recorded(&recorded,false)?;
        let column: bool = client.query_one("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='workspace_record_revisions' AND column_name='storage_format')",&[]).await.map_err(|_|"cannot inspect replay storage format")?.get(0);
        let compact: i64 = if column {client.query_one("SELECT count(*) FROM workspace_record_revisions WHERE storage_format <> 'full_snapshot'",&[]).await.map_err(|_|"cannot inspect compact replay revisions")?.get(0)} else {0};
        println!("{}",serde_json::json!({"schema_current":pending.is_empty(),"compatibility_ready":pending.is_empty()&&compact==0,"compact_revision_count":compact,"pending":pending,"migration_count":rust_runtime::MIGRATIONS.len()}));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restored_target_and_backup_acknowledgement_are_explicit() {
        let args = |values: &[&str]| values.iter().map(|s|s.to_string()).collect::<Vec<_>>();
        for values in [vec!["materialize-replay"],vec!["materialize-replay","--backup-confirmed"],vec!["materialize-replay","--restored-target","fixture"],vec!["materialize-replay","--restored-target","","--backup-confirmed"]] {
            assert!(materialize_target(&args(&values)).is_err());
        }
        let valid = args(&["materialize-replay","--restored-target","restored-fixture","--backup-confirmed"]);
        assert_eq!(materialize_target(&valid).unwrap(),Some("restored-fixture"));
        assert_eq!(materialize_target(&args(&["check"])).unwrap(),None);
    }
}
