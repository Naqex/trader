//! Checksum-verified schema lifecycle, independent of the Python bootstrap.
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use tokio_postgres::Client;

pub const MIGRATIONS: &[(&str, &[u8])] = &[
    ("0001_baseline.sql", include_bytes!("../../migrations/0001_baseline.sql")),
    ("0002_job_retry.sql", include_bytes!("../../migrations/0002_job_retry.sql")),
    ("0003_api_commands.sql", include_bytes!("../../migrations/0003_api_commands.sql")),
    ("0004_download_jobs.sql", include_bytes!("../../migrations/0004_download_jobs.sql")),
];
pub const MIGRATION_LOCK_KEY: i64 = 0x54574D47;

pub fn expected_migrations() -> Vec<(String,String)> {
    MIGRATIONS.iter().map(|(name,bytes)|(name.to_string(),format!("{:x}",Sha256::digest(bytes)))).collect()
}

pub fn validate_recorded(recorded: &HashMap<String,String>, require_current: bool) -> Result<Vec<String>,String> {
    let expected = expected_migrations();
    if recorded.keys().any(|key|!expected.iter().any(|(name,_)| name==key)) {
        return Err("database schema is newer than this migration authority".into());
    }
    let mut pending = Vec::new();
    for (name,digest) in expected {
        match recorded.get(&name) {
            Some(actual) if actual != &digest => return Err(format!("SQL migration checksum mismatch: {name}")),
            Some(_) => (),
            None => pending.push(name),
        }
    }
    if require_current && !pending.is_empty() { return Err(format!("schema migrations pending: {}",pending.join(", "))); }
    Ok(pending)
}

/// Explicit startup/admin action only. Request handlers never run schema DDL.
/// Existing databases need the same verified backup acknowledgement as the managed launcher.
pub async fn apply_migrations(client: &mut Client, backup_confirmed: bool) -> Result<Vec<String>,String> {
    let tx=client.transaction().await.map_err(|_|"cannot start migration transaction")?;
    tx.query_one("SELECT pg_advisory_xact_lock($1)",&[&MIGRATION_LOCK_KEY]).await.map_err(|_|"cannot acquire migration authority")?;
    let tables:i64=tx.query_one("SELECT count(*) FROM pg_tables WHERE schemaname='public'",&[]).await.map_err(|_|"cannot inspect database schema")?.get(0);
    let ledger:Option<String>=tx.query_one("SELECT to_regclass('public.tw_schema_migrations')::text",&[]).await.map_err(|_|"cannot inspect migration ledger")?.get(0);
    let mut recorded=HashMap::new();
    if ledger.is_some() {
        for row in tx.query("SELECT version,sha256 FROM tw_schema_migrations",&[]).await.map_err(|_|"cannot read migration ledger")? {
            recorded.insert(row.get::<_,String>(0),row.get::<_,String>(1));
        }
    }
    let pending=validate_recorded(&recorded,false)?;
    if pending.is_empty() { tx.commit().await.map_err(|_|"cannot commit schema check")?; return Ok(pending); }
    if tables > 0 && !backup_confirmed { return Err("existing database requires verified DB/artifact backup and explicit backup acknowledgement".into()); }
    // Both the Rust enqueue lock and Python claim locks participate. The managed
    // runtime must still be stopped before this explicit schema administration.
    for lock in [0x54574143_i64,0x52534A41_i64,0x41504351_i64] {
        tx.query_one("SELECT pg_advisory_xact_lock($1)",&[&lock]).await.map_err(|_|"cannot acquire worker admission fence")?;
    }
    for table in ["research_jobs","api_commands"] {
        let exists:Option<String>=tx.query_one("SELECT to_regclass($1)::text",&[&format!("public.{table}")]).await.map_err(|_|"cannot inspect active work")?.get(0);
        if exists.is_some() {
            tx.batch_execute(&format!("LOCK TABLE {table} IN ACCESS EXCLUSIVE MODE NOWAIT")).await.map_err(|_|"active database work prevents schema migration")?;
            let count:i64=tx.query_one(&format!("SELECT count(*) FROM {table} WHERE status IN ('queued','running')"),&[]).await.map_err(|_|"cannot inspect active work")?.get(0);
            if count>0 { return Err("active research/API work prevents schema migration".into()); }
        }
    }
    let downloads:Option<String>=tx.query_one("SELECT to_regclass('public.download_job_snapshots')::text",&[]).await.map_err(|_|"cannot inspect active downloads")?.get(0);
    if downloads.is_some() {
        tx.batch_execute("LOCK TABLE download_job_snapshots IN ACCESS EXCLUSIVE MODE NOWAIT").await.map_err(|_|"active download work prevents schema migration")?;
        let count:i64=tx.query_one("SELECT count(*) FROM download_job_snapshots WHERE snapshot->>'status' IN ('queued','running','pausing')",&[]).await.map_err(|_|"cannot inspect active downloads")?.get(0);
        if count>0 { return Err("active downloads prevent schema migration".into()); }
    }
    tx.batch_execute("CREATE TABLE IF NOT EXISTS tw_schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL,applied_at_utc timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)").await.map_err(|_|"cannot create migration ledger")?;
    for (name,bytes) in MIGRATIONS {
        if !pending.iter().any(|p|p==name) { continue; }
        let sql=std::str::from_utf8(bytes).map_err(|_|"invalid migration encoding")?;
        tx.batch_execute(sql).await.map_err(|_|format!("SQL migration failed: {name}"))?;
        let digest=format!("{:x}",Sha256::digest(bytes));
        tx.execute("INSERT INTO tw_schema_migrations(version,sha256) VALUES($1,$2)",&[name,&digest]).await.map_err(|_|"cannot record migration checksum")?;
    }
    tx.commit().await.map_err(|_|"cannot commit schema migration")?;
    Ok(pending)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn ledger_fails_closed_for_changed_and_future_schema() {
        let recorded:HashMap<_,_>=expected_migrations().into_iter().collect();
        assert!(validate_recorded(&recorded,true).unwrap().is_empty());
        let mut changed=recorded.clone();changed.insert("0001_baseline.sql".into(),"wrong".into());assert!(validate_recorded(&changed,false).is_err());
        let mut future=recorded.clone();future.insert("9999_future.sql".into(),"unknown".into());assert!(validate_recorded(&future,false).is_err());
        let mut missing=recorded;missing.remove("0004_download_jobs.sql");assert_eq!(validate_recorded(&missing,false).unwrap(),vec!["0004_download_jobs.sql"]);assert!(validate_recorded(&missing,true).is_err());
    }
}
