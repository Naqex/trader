//! Durable public lifecycle. A disconnected reader never cancels or resubmits inference.
#[cfg(test)]
mod tests;
use crate::{
    ai_assistant::AiAssistant,
    auth::{ApiError, Workspace},
};
use axum::http::StatusCode;
use axum::{
    Json,
    extract::{Path, Query, State},
    response::{
        Sse,
        sse::{Event, KeepAlive},
    },
};
use deadpool_postgres::Pool;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::sync::{Mutex, Notify, Semaphore};
use uuid::Uuid;

pub(crate) const ADMISSION: i64 = 0x41495255;
const VIEW: &str = "(result || jsonb_build_object('id',run_id,'conversation_id',conversation_id,'request_key',idempotency_key,'status',status,'outcome',outcome,'selection',COALESCE(config->'workflow'->'roles'->'reviewer'->'selection',config->'selection') - 'provider','provider',COALESCE(config->'workflow'->'roles'->'reviewer'->'selection',config->'selection')->'provider','workflow',config->'workflow'->'version','roles',config->'workflow'->'roles','grounding',config->'grounding','sequence',event_seq,'created_at',created_at,'updated_at',updated_at))";
fn invalid(code: &str) -> ApiError {
    ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, code)
}
fn missing() -> ApiError {
    ApiError::detail(StatusCode::NOT_FOUND, "chatgpt_turn_not_found")
}
fn conflict(code: &str) -> ApiError {
    ApiError::detail(StatusCode::CONFLICT, code)
}
fn db(_: impl std::fmt::Debug) -> ApiError {
    ApiError::database()
}
pub(crate) fn identifier(value: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(value).map_err(|_| missing())
}
pub(crate) fn terminal(value: &Value) -> bool {
    !matches!(
        value["status"].as_str(),
        Some("queued" | "running" | "cancelling")
    )
}

pub struct Engine {
    pub(crate) pool: Pool,
    pub(crate) assistant: Arc<AiAssistant>,
    pub(crate) owner: Uuid,
    pub(crate) workflows: crate::ai_workflows::Workers,
    stopped: AtomicBool,
    wake: Notify,
    cancel: Notify,
    changed: tokio::sync::watch::Sender<u64>,
    worker: Mutex<Option<tokio::task::JoinHandle<()>>>,
    pub(crate) streams: Arc<Semaphore>,
}

impl Engine {
    pub fn new(pool: Pool, assistant: Arc<AiAssistant>) -> Arc<Self> {
        Arc::new(Self {
            pool,
            assistant,
            workflows: crate::ai_workflows::Workers::from_environment(),
            owner: Uuid::new_v4(),
            stopped: AtomicBool::new(false),
            wake: Notify::new(),
            cancel: Notify::new(),
            changed: tokio::sync::watch::channel(0).0,
            worker: Mutex::new(None),
            streams: Arc::new(Semaphore::new(16)),
        })
    }
    pub(crate) fn publish(&self) {
        self.changed.send_modify(|v| *v = v.wrapping_add(1));
    }
    pub async fn start(self: &Arc<Self>) {
        let mut worker = self.worker.lock().await;
        if worker.is_some() {
            return;
        }
        let weak = Arc::downgrade(self);
        *worker = Some(tokio::spawn(async move {
            let mut tasks = tokio::task::JoinSet::new();
            loop {
                let Some(engine) = weak.upgrade() else {
                    break;
                };
                if engine.stopped.load(Ordering::Acquire) {
                    break;
                }
                while tasks.try_join_next().is_some() {}
                // Never accumulate one sleeping Tokio task for every queued run.
                if tasks.len() < 6 {
                    match engine.claim().await {
                        Ok(Some((id, input, config))) => {
                            let runner = engine.clone();
                            tasks.spawn(async move {
                                runner.execute(id, input, config).await;
                            });
                            continue;
                        }
                        Ok(None) => (),
                        Err(_) => tracing::warn!("AI queue temporarily unavailable"),
                    }
                }
                tokio::select! { _=engine.wake.notified()=>(), _=tokio::time::sleep(Duration::from_secs(2))=>() }
            }
            tasks.abort_all();
            while tasks.join_next().await.is_some() {}
        }));
    }
    pub async fn shutdown(&self) {
        self.stopped.store(true, Ordering::Release);
        self.wake.notify_waiters();
        if let Some(worker) = self.worker.lock().await.take() {
            let _ = worker.await;
        }
        self.workflows.shutdown().await;
        // Aborted transports may have reached the provider. Never requeue them.
        if let Ok(mut conn) = self.pool.get().await {
            if let Ok(tx) = conn.transaction().await {
                let _=tx.execute("UPDATE ai_runs SET lease_until=clock_timestamp() WHERE owner=$1 AND status IN ('running','cancelling')",&[&self.owner]).await;
                let _ = recover(&tx).await;
                let _ = tx.commit().await;
            }
        }
    }
    pub async fn submit(
        self: &Arc<Self>,
        scope: &Workspace,
        body: Value,
        legacy: bool,
    ) -> Result<Value, ApiError> {
        self.submit_inner(scope, body, legacy, false).await
    }
    pub(crate) async fn submit_inner(
        self: &Arc<Self>,
        scope: &Workspace,
        mut body: Value,
        legacy: bool,
        workflow: bool,
    ) -> Result<Value, ApiError> {
        let context = crate::ai_assistant::chat_context(&body)?;
        let messages = crate::ai_assistant::chat_messages(body.clone())?;
        if body.get("conversation_id").is_some() != body.get("idempotency_key").is_some() {
            return Err(invalid("invalid_ai_idempotency_key"));
        }
        let conversation = body
            .get("conversation_id")
            .map(|v| {
                v.as_str()
                    .ok_or_else(|| invalid("invalid_ai_conversation"))
                    .and_then(identifier)
            })
            .transpose()?
            .unwrap_or_else(Uuid::new_v4);
        let key = body
            .get("idempotency_key")
            .map(|v| {
                v.as_str()
                    .ok_or_else(|| invalid("invalid_ai_idempotency_key"))
                    .and_then(identifier)
            })
            .transpose()?
            .unwrap_or_else(Uuid::new_v4);
        let mut identity = json!({"messages":messages,"context":context,"conversation_id":conversation,"selection":if legacy {Value::Null}else{body["expected_selection"].clone()},"legacy":legacy});
        if workflow {
            identity["workflow"] = json!("evidence-review-v1");
        }
        let hash = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&identity).map_err(db)?)
        );
        // Replay must still work after a default/credential/catalog has changed.
        {
            let conn = self.pool.get().await.map_err(db)?;
            if let Some(row)=conn.query_opt(&format!("SELECT input_hash,{VIEW} FROM ai_runs WHERE workspace_id=$1 AND subject=$2 AND idempotency_key=$3"),&[&scope.workspace_id,&scope.subject,&key]).await.map_err(db)? {
                if row.get::<_,String>(0)!=hash{return Err(conflict("ai_idempotency_conflict"));}
                return Ok(row.get(1));
            }
        }
        let mut roles = serde_json::Map::new();
        if workflow {
            if !self.workflows.configured() {
                return Err(ApiError::detail(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "ai_workflow_not_configured",
                ));
            }
            for role in ["analyst", "reviewer"] {
                let value = crate::ai_profiles::resolve(&self.pool, scope, "evidence-review", role)
                    .await?
                    .ok_or_else(|| invalid("ai_profile_required"))?;
                self.assistant
                    .validate_selection(&value["selection"])
                    .await?;
                roles.insert(role.into(), value);
            }
            body["expected_selection"] = roles["analyst"]["selection"].clone();
        }
        let profile = if !legacy && body.get("expected_selection").is_none() {
            crate::ai_profiles::resolve(&self.pool, scope, "chat", "default").await?
        } else {
            None
        };
        let selection = if let Some(profile) = &profile {
            profile["selection"].clone()
        } else if legacy || body.get("expected_selection").is_none() {
            let account = self.assistant.account(legacy, false).await?;
            json!({"provider":account["provider"],"model":account["selection"]["model"],"effort":account["selection"]["effort"]})
        } else {
            body["expected_selection"].clone()
        };
        crate::ai_assistant::selection_shape(&selection)?;
        body = json!({"messages":messages,"context":context,"selection":selection,"conversation_id":conversation});
        let mut config = json!({"selection":selection,"profile":profile,"grounding":{"policy_version":crate::ai_assistant::POLICY_VERSION,"context":context,"data_access":"none"}});
        if workflow {
            config["workflow"] = json!({"version":"evidence-review-v1","roles":roles});
            config["grounding"]["data_access"] = json!("user-supplied-text");
            config["grounding"]["source_sha256"] = json!(format!(
                "{:x}",
                Sha256::digest(messages[0]["content"].as_str().unwrap().as_bytes())
            ));
        }
        let mut conn = self.pool.get().await.map_err(db)?;
        let tx = conn.transaction().await.map_err(db)?;
        tx.query_one("SELECT pg_advisory_xact_lock($1)", &[&ADMISSION])
            .await
            .map_err(db)?;
        if let Some(row)=tx.query_opt(&format!("SELECT input_hash,{VIEW} FROM ai_runs WHERE workspace_id=$1 AND subject=$2 AND idempotency_key=$3"),&[&scope.workspace_id,&scope.subject,&key]).await.map_err(db)? {
            if row.get::<_,String>(0)!=hash { return Err(conflict("ai_idempotency_conflict")); }
            return Ok(row.get(1));
        }
        let queued=tx.query_one("SELECT count(*),count(*) FILTER(WHERE workspace_id=$1) FROM ai_runs WHERE status IN ('queued','running','cancelling')",&[&scope.workspace_id]).await.map_err(db)?;
        if queued.get::<_, i64>(0) >= 64 || queued.get::<_, i64>(1) >= 16 {
            return Err(ApiError::detail(
                StatusCode::TOO_MANY_REQUESTS,
                "ai_queue_full",
            ));
        }
        let stored=tx.query_one("SELECT (SELECT count(*) FROM ai_conversations WHERE workspace_id=$1 AND subject=$2 AND conversation_id<>$3),(SELECT count(*) FROM ai_runs WHERE workspace_id=$1 AND subject=$2 AND conversation_id=$3)",&[&scope.workspace_id,&scope.subject,&conversation]).await.map_err(db)?;
        if stored.get::<_, i64>(0) >= 500 || stored.get::<_, i64>(1) >= 64 {
            return Err(conflict("ai_history_full"));
        }
        let kind = if workflow { "evidence-review" } else { "chat" };
        tx.execute("INSERT INTO ai_conversations(workspace_id,subject,conversation_id,selection,title,kind) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",&[&scope.workspace_id,&scope.subject,&conversation,&selection,&messages[0]["content"].as_str().unwrap().chars().take(90).collect::<String>(),&kind]).await.map_err(db)?;
        if tx.query_one("SELECT kind FROM ai_conversations WHERE workspace_id=$1 AND subject=$2 AND conversation_id=$3",&[&scope.workspace_id,&scope.subject,&conversation]).await.map_err(db)?.get::<_,String>(0)!=kind {return Err(conflict("ai_idempotency_conflict"));}
        if tx.query_opt("SELECT run_id FROM ai_runs WHERE workspace_id=$1 AND subject=$2 AND conversation_id=$3 AND status IN ('queued','running','cancelling')",&[&scope.workspace_id,&scope.subject,&conversation]).await.map_err(db)?.is_some() { return Err(conflict("ai_conversation_busy")); }
        // Saving a new selection affects this conversation and future runs only.
        tx.execute("UPDATE ai_conversations SET selection=$4,revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=$1 AND subject=$2 AND conversation_id=$3",&[&scope.workspace_id,&scope.subject,&conversation,&selection]).await.map_err(db)?;
        let id = Uuid::new_v4();
        let value:Value=tx.query_one(&format!("INSERT INTO ai_runs(run_id,workspace_id,subject,conversation_id,idempotency_key,input_hash,input,config,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued') RETURNING {VIEW}"),&[&id,&scope.workspace_id,&scope.subject,&conversation,&key,&hash,&body,&config]).await.map_err(db)?.get(0);
        tx.execute(
            "INSERT INTO ai_run_events(run_id,sequence,payload) VALUES($1,1,$2)",
            &[&id, &value],
        )
        .await
        .map_err(db)?;
        tx.commit().await.map_err(db)?;
        self.start().await;
        self.wake.notify_one();
        self.publish();
        Ok(value)
    }
    pub async fn read(&self, scope: &Workspace, id: Uuid, cancel: bool) -> Result<Value, ApiError> {
        let mut conn = self.pool.get().await.map_err(db)?;
        let tx = conn.transaction().await.map_err(db)?;
        let row=tx.query_opt(&format!("SELECT {VIEW} FROM ai_runs WHERE run_id=$1 AND workspace_id=$2 AND subject=$3 FOR UPDATE"),&[&id,&scope.workspace_id,&scope.subject]).await.map_err(db)?.ok_or_else(missing)?;
        let mut value: Value = row.get(0);
        if cancel && !terminal(&value) && value["status"] != "cancelling" {
            let next = if value["status"] == "queued" {
                "cancelled"
            } else {
                "cancelling"
            };
            value = transition(&tx, id, None, next, json!({})).await?;
        }
        if value["workflow"].is_string() {
            let steps=tx.query("SELECT node,selection,status,outcome,result-'text',created_at,updated_at FROM ai_run_steps WHERE run_id=$1 ORDER BY created_at,node",&[&id]).await.map_err(db)?;
            value["steps"]=json!(steps.iter().map(|r|json!({"node":r.get::<_,String>(0),"selection":r.get::<_,Value>(1),"status":r.get::<_,String>(2),"outcome":r.get::<_,String>(3),"result":r.get::<_,Value>(4),"created_at":r.get::<_,chrono::DateTime<chrono::Utc>>(5),"updated_at":r.get::<_,chrono::DateTime<chrono::Utc>>(6)})).collect::<Vec<_>>());
        }
        tx.commit().await.map_err(db)?;
        if cancel {
            self.wake.notify_one();
            self.cancel.notify_waiters();
            self.publish();
        }
        Ok(value)
    }
    pub async fn events(
        &self,
        scope: &Workspace,
        id: Uuid,
        after: i64,
    ) -> Result<Vec<Value>, ApiError> {
        let conn = self.pool.get().await.map_err(db)?;
        Ok(conn.query("SELECT e.payload FROM ai_run_events e JOIN ai_runs r ON r.run_id=e.run_id WHERE e.run_id=$1 AND e.sequence>$2 AND r.workspace_id=$3 AND r.subject=$4 ORDER BY e.sequence LIMIT 64",&[&id,&after,&scope.workspace_id,&scope.subject]).await.map_err(db)?.iter().map(|r|r.get(0)).collect())
    }
    async fn claim(&self) -> Result<Option<(Uuid, Value, Value)>, ApiError> {
        let mut conn = self.pool.get().await.map_err(db)?;
        let tx = conn.transaction().await.map_err(db)?;
        tx.query_one("SELECT pg_advisory_xact_lock($1)", &[&ADMISSION])
            .await
            .map_err(db)?;
        recover(&tx).await?;
        let row=tx.query_opt("SELECT r.run_id,r.input,r.config FROM ai_runs r WHERE r.status='queued' AND ((r.config ? 'workflow' AND $1::boolean AND (SELECT count(*) FROM ai_runs WHERE status IN ('running','cancelling') AND config ? 'workflow')<2) OR (NOT(r.config ? 'workflow') AND (SELECT count(*) FROM ai_model_calls)<4 AND (SELECT count(*) FROM ai_model_calls c WHERE c.workspace_id=r.workspace_id)<3 AND (SELECT count(*) FROM ai_model_calls c WHERE c.route=r.config->'selection'->>'provider') < CASE WHEN r.config->'selection'->>'provider'='chatgpt-web' THEN 1 ELSE 3 END)) ORDER BY r.created_at,r.run_id LIMIT 1 FOR UPDATE OF r SKIP LOCKED",&[&self.workflows.configured()]).await.map_err(db)?;
        let Some(row) = row else {
            tx.commit().await.map_err(db)?;
            return Ok(None);
        };
        let id: Uuid = row.get(0);
        let input: Value = row.get(1);
        let config: Value = row.get(2);
        tx.execute("UPDATE ai_runs SET owner=$2,lease_until=clock_timestamp()+interval '30 seconds' WHERE run_id=$1",&[&id,&self.owner]).await.map_err(db)?;
        if config.get("workflow").is_none() {
            tx.execute("INSERT INTO ai_model_calls(call_id,run_id,owner,route,workspace_id,lease_until) SELECT $1,run_id,$2,config->'selection'->>'provider',workspace_id,lease_until FROM ai_runs WHERE run_id=$3",&[&Uuid::new_v4(),&self.owner,&id]).await.map_err(db)?;
        }
        transition(&tx, id, Some(self.owner), "running", json!({})).await?;
        tx.commit().await.map_err(db)?;
        self.publish();
        Ok(Some((id, input, config)))
    }
    async fn heartbeat(&self, id: Uuid) -> Result<bool, ApiError> {
        let mut conn = self.pool.get().await.map_err(db)?;
        let tx = conn.transaction().await.map_err(db)?;
        let row=tx.query_opt("UPDATE ai_runs SET lease_until=clock_timestamp()+interval '30 seconds' WHERE run_id=$1 AND owner=$2 AND lease_until>clock_timestamp() AND status IN ('running','cancelling') RETURNING status",&[&id,&self.owner]).await.map_err(db)?.ok_or_else(missing)?;
        tx.execute("UPDATE ai_model_calls SET lease_until=clock_timestamp()+interval '30 seconds' WHERE run_id=$1 AND owner=$2",&[&id,&self.owner]).await.map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(row.get::<_, String>(0) == "cancelling")
    }
    async fn execute(self: &Arc<Self>, id: Uuid, input: Value, config: Value) {
        let result = {
            let (progress, mut updates) = tokio::sync::mpsc::channel(2);
            let operation = async {
                if config.get("workflow").is_some() {
                    return self.workflows.execute(self, id, &input, &config).await;
                }
                let request = self
                    .assistant
                    .prepare(
                        &config["selection"],
                        input["messages"].clone(),
                        &input["context"],
                    )
                    .await
                    .map_err(|e| json!({"error":e.1["detail"],"outcome":"not_sent"}))?;
                // Persist uncertainty before touching an external endpoint, never after.
                let conn =
                    self.pool.get().await.map_err(
                        |_| json!({"error":"database_unavailable","outcome":"not_sent"}),
                    )?;
                let sent=conn.execute("UPDATE ai_runs SET outcome='sent' WHERE run_id=$1 AND owner=$2 AND status='running' AND lease_until>clock_timestamp()",&[&id,&self.owner]).await.map_err(|_|json!({"error":"database_unavailable","outcome":"not_sent"}))?;
                if sent != 1 {
                    return Err(json!({"error":"ai_cancelled_before_send","outcome":"not_sent"}));
                }
                drop(conn);
                crate::ai_response::complete(
                    request,
                    config["selection"]["provider"].as_str().unwrap(),
                    Some(progress),
                )
                .await
            };
            tokio::pin!(operation);
            let deadline = tokio::time::sleep(Duration::from_secs(210));
            tokio::pin!(deadline);
            let mut heartbeat = tokio::time::interval(Duration::from_secs(5));
            heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut published = 0;
            loop {
                tokio::select! {
                    result=&mut operation=>break result,
                    Some(text)=updates.recv()=>{
                        if let Ok(mut conn)=self.pool.get().await {
                            if let Ok(tx)=conn.transaction().await {
                                let checkpoint=json!({"text":text,"partial":true,"delta":&text[published..],"offset":published});
                                if transition(&tx,id,Some(self.owner),"running",checkpoint).await.is_ok() {if tx.commit().await.is_ok(){published=text.len();self.publish();}}
                            }
                        }
                    },
                    _=&mut deadline=>break Err(json!({"error":"ai_timeout","outcome":"unknown"})),
                    _=async {tokio::select! { _=heartbeat.tick()=>(),_=self.cancel.notified()=>() }}=>match self.heartbeat(id).await {
                        Ok(false)=>(),
                        Ok(true)=>break Err(json!({"error":"ai_cancelled","outcome":"unknown"})),
                        Err(_)=>return, // Drop transport; expired lease becomes interrupted, never replayed.
                    }
                }
            }
        }; // Drop the HTTP future before releasing its call permit.
        let (status, mut result) = match result {
            Ok(value) => ("completed", value),
            Err(value)
                if value["error"] == "ai_cancelled"
                    || value["error"] == "ai_cancelled_before_send" =>
            {
                ("cancelled", value)
            }
            Err(value) => ("failed", value),
        };
        if let Ok(mut conn) = self.pool.get().await {
            if let Ok(tx) = conn.transaction().await {
                if config.get("workflow").is_some() && status != "completed" {
                    // A sibling may have been sent even when this branch failed
                    // before send. Preserve uncertainty at the parent boundary.
                    if let Ok(row)=tx.query_one("SELECT CASE WHEN count(*) FILTER(WHERE outcome IN ('sent','unknown'))>0 THEN 'unknown' WHEN count(*) FILTER(WHERE outcome='completed')>0 THEN 'completed' WHEN count(*) FILTER(WHERE outcome='rejected')>0 THEN 'rejected' ELSE 'not_sent' END FROM ai_run_steps WHERE run_id=$1",&[&id]).await {result["outcome"]=json!(row.get::<_,String>(0));}
                }
                if transition(&tx, id, Some(self.owner), status, result)
                    .await
                    .is_ok()
                {
                    let _=tx.execute("UPDATE ai_run_steps SET status='interrupted',outcome=CASE WHEN outcome='sent' THEN 'unknown' ELSE outcome END,updated_at=clock_timestamp() WHERE run_id=$1 AND status IN ('waiting','sent')",&[&id]).await;
                    let _ = tx
                        .execute(
                            "DELETE FROM ai_model_calls WHERE run_id=$1 AND owner=$2",
                            &[&id, &self.owner],
                        )
                        .await;
                    let _ = tx.commit().await;
                }
            }
        }
        self.wake.notify_one();
        self.publish();
    }
}

pub(crate) async fn transition(
    tx: &tokio_postgres::Transaction<'_>,
    id: Uuid,
    owner: Option<Uuid>,
    status: &str,
    result: Value,
) -> Result<Value, ApiError> {
    let row=tx.query_opt(&format!("UPDATE ai_runs SET status=$3,result=result || ($4::jsonb - ARRAY['outcome','delta','offset']),outcome=COALESCE($4::jsonb->>'outcome',outcome),event_seq=event_seq+1,updated_at=clock_timestamp() WHERE run_id=$1 AND ($2::uuid IS NULL OR (owner=$2 AND lease_until>clock_timestamp())) AND status IN ('queued','running','cancelling') AND ($3<>'running' OR status IN ('queued','running')) RETURNING {VIEW}"),&[&id,&owner,&status,&result]).await.map_err(db)?.ok_or_else(missing)?;
    let value: Value = row.get(0);
    let mut event = value.clone();
    if result["partial"] == true {
        event.as_object_mut().unwrap().remove("text");
        event["delta"] = result["delta"].clone();
        event["offset"] = result["offset"].clone();
    }
    tx.execute(
        "INSERT INTO ai_run_events(run_id,sequence,payload) VALUES($1,$2,$3)",
        &[&id, &value["sequence"].as_i64().unwrap(), &event],
    )
    .await
    .map_err(db)?;
    tx.execute("UPDATE ai_conversations SET updated_at=clock_timestamp() WHERE (workspace_id,subject,conversation_id)=(SELECT workspace_id,subject,conversation_id FROM ai_runs WHERE run_id=$1)",&[&id]).await.map_err(db)?;
    Ok(value)
}
async fn recover(tx: &tokio_postgres::Transaction<'_>) -> Result<(), ApiError> {
    // One statement captures the expired run set and durable event atomically.
    tx.execute(&format!("WITH expired AS (UPDATE ai_runs SET status='interrupted',outcome=CASE WHEN outcome='sent' THEN 'unknown' ELSE outcome END,result=result || jsonb_build_object('error','ai_run_interrupted'),event_seq=event_seq+1,updated_at=clock_timestamp() WHERE status IN ('running','cancelling') AND lease_until<=clock_timestamp() RETURNING *) INSERT INTO ai_run_events(run_id,sequence,payload) SELECT run_id,event_seq,{VIEW} FROM expired"),&[]).await.map_err(db)?;
    tx.execute("DELETE FROM ai_model_calls c WHERE NOT EXISTS(SELECT 1 FROM ai_runs r WHERE r.run_id=c.run_id AND r.status IN ('running','cancelling') AND r.lease_until>clock_timestamp())",&[]).await.map_err(db)?;
    tx.execute("UPDATE ai_run_steps s SET status='interrupted',outcome=CASE WHEN outcome='sent' THEN 'unknown' ELSE outcome END,updated_at=clock_timestamp() WHERE s.status IN ('waiting','sent') AND NOT EXISTS(SELECT 1 FROM ai_runs r WHERE r.run_id=s.run_id AND r.status IN ('running','cancelling') AND r.lease_until>clock_timestamp())",&[]).await.map_err(db)?;
    Ok(())
}

#[derive(serde::Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct Page {
    before_at: Option<chrono::DateTime<chrono::Utc>>,
    before_id: Option<Uuid>,
    limit: Option<i64>,
}
pub async fn list_conversations(
    State(state): State<Arc<crate::state::AppState>>,
    scope: Workspace,
    Query(page): Query<Page>,
) -> Result<Json<Value>, ApiError> {
    let limit = page.limit.unwrap_or(20);
    if !(1..=50).contains(&limit) || page.before_at.is_some() != page.before_id.is_some() {
        return Err(invalid("invalid_ai_page"));
    }
    let conn = state.pool.get().await.map_err(db)?;
    let rows=conn.query("SELECT conversation_id,title,selection,revision,updated_at FROM ai_conversations WHERE kind='chat' AND workspace_id=$1 AND subject=$2 AND ($3::timestamptz IS NULL OR (updated_at,conversation_id)<($3,$4::uuid)) ORDER BY updated_at DESC,conversation_id DESC LIMIT $5",&[&scope.workspace_id,&scope.subject,&page.before_at,&page.before_id,&(limit+1)]).await.map_err(db)?;
    let items:Vec<Value>=rows.iter().take(limit as usize).map(|r|json!({"id":r.get::<_,Uuid>(0),"title":r.get::<_,String>(1),"selection":r.get::<_,Value>(2),"revision":r.get::<_,i64>(3),"updated_at":r.get::<_,chrono::DateTime<chrono::Utc>>(4)})).collect();
    let next = if rows.len() > limit as usize {
        items
            .last()
            .map(|v| json!({"before_id":v["id"],"before_at":v["updated_at"]}))
    } else {
        None
    };
    Ok(Json(json!({"items":items,"next":next})))
}
pub async fn read_conversation(
    State(state): State<Arc<crate::state::AppState>>,
    scope: Workspace,
    Path(id): Path<String>,
    Query(page): Query<Page>,
) -> Result<Json<Value>, ApiError> {
    let id = identifier(&id)?;
    let conn = state.pool.get().await.map_err(db)?;
    let limit = page.limit.unwrap_or(10);
    if !(1..=20).contains(&limit) || page.before_at.is_some() != page.before_id.is_some() {
        return Err(invalid("invalid_ai_page"));
    }
    let row=conn.query_opt("SELECT title,selection,revision FROM ai_conversations WHERE workspace_id=$1 AND subject=$2 AND conversation_id=$3",&[&scope.workspace_id,&scope.subject,&id]).await.map_err(db)?.ok_or_else(missing)?;
    let rows=conn.query(&format!("SELECT input,{VIEW} FROM ai_runs WHERE workspace_id=$1 AND subject=$2 AND conversation_id=$3 AND ($4::timestamptz IS NULL OR (created_at,run_id)<($4,$5::uuid)) ORDER BY created_at DESC,run_id DESC LIMIT $6"),&[&scope.workspace_id,&scope.subject,&id,&page.before_at,&page.before_id,&(limit+1)]).await.map_err(db)?;
    let mut turns = Vec::new();
    let mut bytes = 0;
    let mut next = None;
    for r in &rows {
        let input: Value = r.get(0);
        let run: Value = r.get(1);
        let size = input["messages"]
            .as_array()
            .and_then(|m| m.last())
            .map_or(0, |m| m["content"].as_str().unwrap_or("").len())
            + run["text"].as_str().unwrap_or("").len();
        if turns.len() >= limit as usize || bytes + size > 524288 {
            next = turns.last().map(
                |(_, v): &(Value, Value)| json!({"before_id":v["id"],"before_at":v["created_at"]}),
            );
            break;
        }
        bytes += size;
        turns.push((input, run));
    }
    let latest = turns.first().map(|(_, r)| r.clone());
    let mut messages = Vec::new();
    for (input, run) in turns.iter().rev() {
        let mut user = input["messages"]
            .as_array()
            .unwrap()
            .last()
            .unwrap()
            .clone();
        user["status"] = run["status"].clone();
        user["id"] = run["id"].clone();
        user["screen"] = input["context"]["screen"].clone();
        messages.push(user);
        if run["status"] == "completed" {
            messages.push(json!({"role":"assistant","content":run["text"],"status":"completed","selection":run["selection"]}));
        }
    }
    Ok(Json(
        json!({"id":id,"title":row.get::<_,String>(0),"selection":row.get::<_,Value>(1),"revision":row.get::<_,i64>(2),"messages":messages,"run":latest,"next":next}),
    ))
}
pub async fn edit_conversation(
    State(state): State<Arc<crate::state::AppState>>,
    scope: Workspace,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let id = identifier(&id)?;
    if body.as_object().is_none_or(|o| o.len() != 2)
        || !body["title"]
            .as_str()
            .is_some_and(|s| !s.trim().is_empty() && s.chars().count() <= 90)
        || !body["revision"].is_i64()
    {
        return Err(invalid("invalid_ai_conversation"));
    }
    let conn = state.pool.get().await.map_err(db)?;
    let changed=conn.execute("UPDATE ai_conversations SET title=$4,revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=$1 AND subject=$2 AND conversation_id=$3 AND revision=$5",&[&scope.workspace_id,&scope.subject,&id,&body["title"].as_str().unwrap().trim(),&body["revision"].as_i64().unwrap()]).await.map_err(db)?;
    if changed == 0 {
        return Err(conflict("ai_conversation_changed"));
    }
    Ok(Json(
        json!({"id":id,"revision":body["revision"].as_i64().unwrap()+1}),
    ))
}
pub async fn delete_conversation(
    State(state): State<Arc<crate::state::AppState>>,
    scope: Workspace,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = identifier(&id)?;
    let mut conn = state.pool.get().await.map_err(db)?;
    let tx = conn.transaction().await.map_err(db)?;
    tx.query_one("SELECT pg_advisory_xact_lock($1)", &[&ADMISSION])
        .await
        .map_err(db)?;
    if tx.query_opt("SELECT run_id FROM ai_runs WHERE workspace_id=$1 AND subject=$2 AND conversation_id=$3 AND status IN ('queued','running','cancelling')",&[&scope.workspace_id,&scope.subject,&id]).await.map_err(db)?.is_some() { return Err(conflict("ai_conversation_busy")); }
    let count=tx.execute("DELETE FROM ai_conversations WHERE workspace_id=$1 AND subject=$2 AND conversation_id=$3",&[&scope.workspace_id,&scope.subject,&id]).await.map_err(db)?;
    if count == 0 {
        return Err(missing());
    }
    tx.commit().await.map_err(db)?;
    Ok(Json(json!({"deleted":true})))
}
#[derive(serde::Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct EventCursor {
    after: Option<i64>,
}
pub async fn stream_events(
    State(state): State<Arc<crate::state::AppState>>,
    scope: Workspace,
    Path(id): Path<String>,
    Query(query): Query<EventCursor>,
    headers: axum::http::HeaderMap,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>>, ApiError>
{
    let id = identifier(&id)?;
    let mut after = match headers.get("last-event-id") {
        Some(v) => v
            .to_str()
            .ok()
            .and_then(|s| s.parse::<i64>().ok())
            .ok_or_else(|| invalid("invalid_ai_cursor"))?,
        None => query.after.unwrap_or(0),
    };
    let snapshot = state.ai_runs.read(&scope, id, false).await?;
    if after < 0 || after > snapshot["sequence"].as_i64().unwrap() {
        return Err(invalid("invalid_ai_cursor"));
    }
    let permit = state
        .ai_runs
        .streams
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::detail(StatusCode::TOO_MANY_REQUESTS, "ai_stream_limit"))?;
    let mut changed = state.ai_runs.changed.subscribe();
    let stream = async_stream::stream! {
        let _permit=permit;
        let deadline=tokio::time::Instant::now()+Duration::from_secs(240);
        loop {
            changed.borrow_and_update();
            match state.ai_runs.events(&scope,id,after).await {
                Ok(events)=>{
                    for value in events {
                        after=value["sequence"].as_i64().unwrap();let done=terminal(&value);
                        yield Ok(Event::default().event("run").id(after.to_string()).data(value.to_string()));
                        if done { return; }
                    }
                    // A reconnect at the terminal cursor still gets a final snapshot.
                    if let Ok(value)=state.ai_runs.read(&scope,id,false).await { if terminal(&value) { yield Ok(Event::default().event("run").id(value["sequence"].to_string()).data(value.to_string()));break; } }
                },
                Err(_)=>{yield Ok(Event::default().event("resync").data("{}"));break;}
            }
            if tokio::time::Instant::now()>=deadline || state.draining.load(Ordering::Acquire) { break; }
            tokio::select! { _=changed.changed()=>(),_=tokio::time::sleep(Duration::from_secs(5))=>() }
        }
    };
    Ok(Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keepalive"),
    ))
}
