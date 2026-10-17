//! PostgreSQL owns research leases. No language-specific worker can bypass these fences.
use chrono::Utc;
use serde_json::Value;
use tokio_postgres::{Row, Transaction};

pub const RESEARCH_ADMISSION_LOCK: i64 = 0x52534A41;
#[derive(Clone, Debug)]
pub struct ClaimedJob {
    pub workspace_id: String,
    pub job_id: String,
    pub dataset_id: String,
    pub strategy_version: String,
    pub starting_balance: f64,
    pub protocol: Option<Value>,
    pub protocol_sha256: Option<String>,
    pub attempt_no: i32,
    pub lease_owner: String,
    pub lease_token: String,
}
fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true)
}
fn database() -> String {
    "research_database_unavailable".into()
}
pub async fn recover(tx: &Transaction<'_>) -> Result<Vec<Row>, String> {
    recover_filtered(tx, 0, None).await
}
pub async fn recover_native_scoped(tx:&Transaction<'_>,workspaces:&[String],scientific:bool)->Result<Vec<Row>,String>{
    recover_filtered(tx,if scientific{3}else{2},Some(workspaces)).await
}
// Keep recovery and admission under the same ownership boundary: recovering a
// lease mutates retry, cancellation and failure state even without claiming it.
const OWNED_JOB: &str = "($3::boolean OR workspace_id=ANY($2)) AND ($1::integer=0 OR (protocol_json IS NULL AND strategy_version='close-delta-v1') OR ($1::integer>=2 AND strategy_version='bar-breakout-v1' AND protocol_json->'engine'->>'version'='bar-breakout-v1' AND (protocol_json->'engine'->>'backend'='reference' OR ($1::integer=3 AND protocol_json->'engine'->>'backend'='nautilus'))))";
async fn recover_filtered(tx:&Transaction<'_>,supported_mode:i32,workspaces:Option<&[String]>)->Result<Vec<Row>,String>{
    let unrestricted=workspaces.is_none();let allowed=workspaces.unwrap_or(&[]).to_vec();
    let sql=format!("UPDATE research_jobs SET status=CASE WHEN cancel_requested THEN 'canceled' WHEN attempt_no>=max_attempts THEN 'failed' ELSE 'queued' END,error_code=CASE WHEN cancel_requested THEN NULL WHEN attempt_no>=max_attempts THEN 'LEASE_RETRY_EXHAUSTED' ELSE 'LEASE_EXPIRED' END,available_at_utc=CURRENT_TIMESTAMP+(LEAST(300.0,retry_base_seconds*power(2.0,LEAST(attempt_no-1,16)))*(0.8+random()*0.4)*INTERVAL '1 second'),lease_owner=NULL,lease_token=NULL,lease_expires_at_utc=NULL,updated_at_utc=$4 WHERE status='running' AND (lease_expires_at_utc IS NULL OR lease_expires_at_utc<=CURRENT_TIMESTAMP) AND {OWNED_JOB} RETURNING workspace_id,job_id,status");
    tx.query(&sql,&[&supported_mode,&allowed,&unrestricted,&now()]).await.map_err(|_|database())
}
pub async fn claim(
    tx: &Transaction<'_>,
    worker: &str,
    lease_seconds: i32,
    max_active: i64,
) -> Result<Option<ClaimedJob>, String> {
    claim_filtered(tx, worker, lease_seconds, max_active, 0, None).await
}
/// Native workers must never take an engine job they cannot execute.
pub async fn claim_close_delta(
    tx: &Transaction<'_>,
    worker: &str,
    lease_seconds: i32,
    max_active: i64,
) -> Result<Option<ClaimedJob>, String> {
    claim_filtered(tx, worker, lease_seconds, max_active, 1, None).await
}
/// Mixed native workers own only deterministic implementations declared here.
pub async fn claim_native(tx:&Transaction<'_>,worker:&str,lease_seconds:i32,max_active:i64)->Result<Option<ClaimedJob>,String>{
    claim_filtered(tx,worker,lease_seconds,max_active,2,None).await
}
pub async fn claim_native_scoped(tx:&Transaction<'_>,worker:&str,lease_seconds:i32,max_active:i64,workspaces:&[String],scientific:bool)->Result<Option<ClaimedJob>,String>{
    claim_filtered(tx,worker,lease_seconds,max_active,if scientific{3}else{2},Some(workspaces)).await
}
async fn claim_filtered(
    tx: &Transaction<'_>,
    worker: &str,
    lease_seconds: i32,
    max_active: i64,
    supported_mode: i32,
    workspaces: Option<&[String]>,
) -> Result<Option<ClaimedJob>, String> {
    let worker = worker.trim();
    if worker.is_empty() || lease_seconds <= 0 || max_active <= 0 {
        return Err("invalid research worker resource limits".into());
    }
    tx.query_one(
        "SELECT pg_advisory_xact_lock($1)",
        &[&RESEARCH_ADMISSION_LOCK],
    )
    .await
    .map_err(|_| database())?;
    recover_filtered(tx,supported_mode,workspaces).await?;
    let count:i64=tx.query_one("SELECT count(*) FROM research_jobs WHERE status='running' AND cancel_requested=false AND lease_expires_at_utc>CURRENT_TIMESTAMP",&[]).await.map_err(|_|database())?.get(0);
    if count >= max_active {
        return Ok(None);
    }
    let unrestricted=workspaces.is_none();let allowed=workspaces.unwrap_or(&[]).to_vec();
    let sql=format!("SELECT * FROM research_jobs WHERE status='queued' AND cancel_requested=false AND attempt_no<max_attempts AND available_at_utc<=CURRENT_TIMESTAMP AND {OWNED_JOB} ORDER BY created_at_utc,job_id FOR UPDATE SKIP LOCKED LIMIT 1");
    let Some(row)=tx.query_opt(&sql,&[&supported_mode,&allowed,&unrestricted]).await.map_err(|_|database())? else {return Ok(None)};
    let workspace: String = row.get("workspace_id");
    let id: String = row.get("job_id");
    let token = uuid::Uuid::new_v4().simple().to_string();
    let attempt:i32=tx.query_one("UPDATE research_jobs SET status='running',attempt_no=attempt_no+1,lease_owner=$3,lease_token=$4,lease_expires_at_utc=CURRENT_TIMESTAMP+($5*INTERVAL '1 second'),updated_at_utc=$6,error_code=NULL WHERE workspace_id=$1 AND job_id=$2 AND status='queued' AND cancel_requested=false RETURNING attempt_no",&[&workspace,&id,&worker,&token,&f64::from(lease_seconds),&now()]).await.map_err(|_|database())?.get(0);
    Ok(Some(ClaimedJob {
        workspace_id: workspace,
        job_id: id,
        dataset_id: row.get("dataset_id"),
        strategy_version: row.get("strategy_version"),
        starting_balance: row.get("starting_balance"),
        protocol: row.get("protocol_json"),
        protocol_sha256: row.get("protocol_sha256"),
        attempt_no: attempt,
        lease_owner: worker.into(),
        lease_token: token,
    }))
}
pub async fn renew(
    tx: &Transaction<'_>,
    job: &ClaimedJob,
    lease_seconds: i32,
) -> Result<bool, String> {
    if lease_seconds <= 0 {
        return Err("lease_seconds must be positive".into());
    }
    Ok(tx.execute("UPDATE research_jobs SET lease_expires_at_utc=CURRENT_TIMESTAMP+($6*INTERVAL '1 second'),updated_at_utc=$7 WHERE workspace_id=$1 AND job_id=$2 AND status='running' AND attempt_no=$3 AND lease_owner=$4 AND lease_token=$5 AND cancel_requested=false AND lease_expires_at_utc>CURRENT_TIMESTAMP",&[&job.workspace_id,&job.job_id,&job.attempt_no,&job.lease_owner,&job.lease_token,&f64::from(lease_seconds),&now()]).await.map_err(|_|database())?==1)
}
pub async fn checkpoint(
    tx: &Transaction<'_>,
    job: &ClaimedJob,
    checkpoint: Value,
    progress: Option<Value>,
) -> Result<bool, String> {
    if checkpoint.get("attempt_no").and_then(Value::as_i64) != Some(i64::from(job.attempt_no)) {
        return Err("checkpoint attempt mismatch".into());
    }
    crate::jobs::validate_checkpoint(checkpoint.clone(), progress.clone())
        .map_err(|_| "checkpoint_untrusted".to_string())?;
    Ok(tx.execute("UPDATE research_jobs SET checkpoint_json=$6,progress_json=$7,updated_at_utc=$8 WHERE workspace_id=$1 AND job_id=$2 AND status='running' AND attempt_no=$3 AND lease_owner=$4 AND lease_token=$5 AND cancel_requested=false AND lease_expires_at_utc>CURRENT_TIMESTAMP",&[&job.workspace_id,&job.job_id,&job.attempt_no,&job.lease_owner,&job.lease_token,&checkpoint,&progress,&now()]).await.map_err(|_|database())?==1)
}
pub async fn complete(
    tx: &Transaction<'_>,
    job: &ClaimedJob,
    path: &str,
    sha: &str,
) -> Result<bool, String> {
    let row=tx.query_opt("SELECT status,cancel_requested,attempt_no,lease_owner,lease_token,(lease_expires_at_utc>CURRENT_TIMESTAMP) AS lease_valid FROM research_jobs WHERE workspace_id=$1 AND job_id=$2 FOR UPDATE",&[&job.workspace_id,&job.job_id]).await.map_err(|_|database())?.ok_or("stale_job_attempt")?;
    if row.get::<_, String>("status") == "canceled" && row.get::<_, bool>("cancel_requested") {
        return Ok(false);
    }
    if row.get::<_, String>("status") != "running"
        || row.get::<_, i32>("attempt_no") != job.attempt_no
        || row.get::<_, Option<String>>("lease_owner").as_deref() != Some(&job.lease_owner)
        || row.get::<_, Option<String>>("lease_token").as_deref() != Some(&job.lease_token)
        || row.get::<_, Option<bool>>("lease_valid") != Some(true)
    {
        return Err("stale_job_attempt".into());
    }
    if row.get::<_, bool>("cancel_requested") {
        return Ok(false);
    }
    tx.execute("UPDATE research_jobs SET status='completed',result_path=$3,result_sha256=$4,error_code=NULL,lease_owner=NULL,lease_token=NULL,lease_expires_at_utc=NULL,updated_at_utc=$5 WHERE workspace_id=$1 AND job_id=$2",&[&job.workspace_id,&job.job_id,&path,&sha,&now()]).await.map_err(|_|database())?;
    Ok(true)
}
pub async fn fail(
    tx: &Transaction<'_>,
    job: &ClaimedJob,
    error: &str,
    retryable: bool,
) -> Result<bool, String> {
    let sql = if retryable {
        "UPDATE research_jobs SET status=CASE WHEN cancel_requested THEN 'canceled' WHEN attempt_no>=max_attempts THEN 'failed' ELSE 'queued' END,error_code=CASE WHEN cancel_requested THEN NULL ELSE $6 END,available_at_utc=CURRENT_TIMESTAMP+(LEAST(300.0,retry_base_seconds*power(2.0,LEAST(attempt_no-1,16)))*(0.8+random()*0.4)*INTERVAL '1 second'),lease_owner=NULL,lease_token=NULL,lease_expires_at_utc=NULL,updated_at_utc=$7 WHERE workspace_id=$1 AND job_id=$2 AND status='running' AND attempt_no=$3 AND lease_owner=$4 AND lease_token=$5 AND lease_expires_at_utc>CURRENT_TIMESTAMP"
    } else {
        "UPDATE research_jobs SET status=CASE WHEN cancel_requested THEN 'canceled' ELSE 'failed' END,error_code=CASE WHEN cancel_requested THEN NULL ELSE $6 END,lease_owner=NULL,lease_token=NULL,lease_expires_at_utc=NULL,updated_at_utc=$7 WHERE workspace_id=$1 AND job_id=$2 AND status='running' AND attempt_no=$3 AND lease_owner=$4 AND lease_token=$5 AND lease_expires_at_utc>CURRENT_TIMESTAMP"
    };
    Ok(tx
        .execute(
            sql,
            &[
                &job.workspace_id,
                &job.job_id,
                &job.attempt_no,
                &job.lease_owner,
                &job.lease_token,
                &error,
                &now(),
            ],
        )
        .await
        .map_err(|_| database())?
        == 1)
}
