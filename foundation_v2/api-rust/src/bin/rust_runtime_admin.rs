//! Explicit local schema administration; never called by request handlers.
use std::collections::HashMap;
use tokio_postgres::{NoTls,config::Host};
use trading_workspace_api::rust_runtime;

#[tokio::main]
async fn main()->Result<(),Box<dyn std::error::Error>> {
    let args=std::env::args().skip(1).collect::<Vec<_>>();
    if args.len()==2 && args[0]=="provider-dependency-hash" {
        let hash=trading_workspace_api::provider_routes::dependencies::digest(std::path::Path::new(&args[1]))?;
        println!("{}",serde_json::json!({"sha256":hash}));
        return Ok(());
    }
    if args.len()==2 && args[0]=="scientific-capability" {
        let root=trading_workspace_api::research_jobs::adapter::foundation_root();
        let hash=trading_workspace_api::research_jobs::adapter::engine_code_hash(&root)?;
        let descriptor=trading_workspace_api::research_jobs::adapter::descriptor(&root,std::path::Path::new(&args[1]),&hash)?;
        println!("{}",serde_json::json!({"valid":true,"runtime_identity":descriptor["runtime_identity"]}));
        return Ok(());
    }
    if args.as_slice()==["routes"] {
        let native = std::env::var("TW_V2_RUNTIME_PROFILE").is_ok_and(|v|v=="native");
        println!("{}",serde_json::json!({"contract_version":trading_workspace_api::CONTRACT_VERSION,"runtime_profile":if native{"native"}else{"compatibility"},"required_command_routes":trading_workspace_api::commands::required_worker_manifest_for(native),"routes":trading_workspace_api::commands::route_inventory_for(native)}));
        return Ok(());
    }
    if args.as_slice()!=["check"] && args.as_slice()!=["migrate"] && args.as_slice()!=["migrate","--backup-confirmed"] {
        return Err("usage: rust_runtime_admin routes | check | migrate [--backup-confirmed]".into());
    }
    let dsn=std::env::var("TW_V2_DATABASE_URL").map_err(|_|"TW_V2_DATABASE_URL required")?;
    let config:tokio_postgres::Config=dsn.parse().map_err(|_|"invalid database configuration")?;
    if config.get_hosts().is_empty() || !config.get_hosts().iter().all(|h|matches!(h,Host::Tcp(s) if s=="localhost" || s.parse::<std::net::IpAddr>().is_ok_and(|a|a.is_loopback()))) || !config.get_hostaddrs().iter().all(std::net::IpAddr::is_loopback) {return Err("schema administration requires explicit loopback PostgreSQL".into());}
    let (mut client,connection)=config.connect(NoTls).await.map_err(|_|"database unavailable")?;
    tokio::spawn(async move { let _=connection.await; });
    client.batch_execute("SET statement_timeout='30s'; SET lock_timeout='2s'; SET idle_in_transaction_session_timeout='30s'").await.map_err(|_|"database timeout configuration failed")?;
    if args[0]=="migrate" {
        let applied=rust_runtime::apply_migrations(&mut client,args.len()==2).await?;
        println!("{}",serde_json::json!({"applied":applied}));
    } else {
        let ledger:Option<String>=client.query_one("SELECT to_regclass('public.tw_schema_migrations')::text",&[]).await.map_err(|_|"migration ledger unavailable")?.get(0);
        let mut recorded=HashMap::new();
        if ledger.is_some() {for row in client.query("SELECT version,sha256 FROM tw_schema_migrations",&[]).await.map_err(|_|"migration ledger unavailable")? {recorded.insert(row.get::<_,String>(0),row.get::<_,String>(1));}}
        let pending=rust_runtime::validate_recorded(&recorded,false)?;
        println!("{}",serde_json::json!({"schema_current":pending.is_empty(),"pending":pending,"migration_count":rust_runtime::MIGRATIONS.len()}));
    }
    Ok(())
}
