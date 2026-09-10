use rusqlite::{params, Connection};
use crate::state::Db;
use crate::jobs::model::{Job, JobStatus};
use crate::media::detect::MediaKind;

pub fn init_db(conn: &Connection) {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'queued',
            media_kind TEXT NOT NULL,
            input_path TEXT NOT NULL,
            output_path TEXT NOT NULL,
            original_bytes INTEGER NOT NULL DEFAULT 0,
            compressed_bytes INTEGER NOT NULL DEFAULT 0,
            duration_secs REAL NOT NULL DEFAULT 0,
            progress INTEGER NOT NULL DEFAULT 0,
            eta_secs INTEGER NOT NULL DEFAULT 0,
            webhook_url TEXT,
            preset TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS webhook_deliveries (
            id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            url TEXT NOT NULL,
            status INTEGER,
            attempted_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS api_keys (
            key TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            plan TEXT NOT NULL DEFAULT 'free',
            webhook_url TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS rate_limit (
            ip TEXT NOT NULL,
            ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rate_limit_ip_ts ON rate_limit(ip, ts);
        CREATE TABLE IF NOT EXISTS transcriptions (
            id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            text TEXT NOT NULL,
            language TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS ingests (
            id         TEXT PRIMARY KEY,
            path       TEXT NOT NULL,
            owner_key  TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_ingests_created ON ingests(created_at);
    ").expect("db init failed");

    // Migrations — each runs individually so a duplicate-column error on an
    // existing DB does not abort the rest. execute_batch() stops at the first
    // failure, which silently skipped every migration after the first on any
    // existing database. (H12)
    const MIGRATIONS: &[&str] = &[
        "ALTER TABLE api_keys ADD COLUMN white_label_domain TEXT",
        "ALTER TABLE api_keys ADD COLUMN white_label_brand TEXT",
        "ALTER TABLE api_keys ADD COLUMN default_destination TEXT",
        "ALTER TABLE jobs ADD COLUMN destination_json TEXT",
        "ALTER TABLE jobs ADD COLUMN remote_url TEXT",
        "ALTER TABLE jobs ADD COLUMN owner_key TEXT",
        "ALTER TABLE transcriptions ADD COLUMN status TEXT",
    ];
    for stmt in MIGRATIONS {
        match conn.execute(stmt, []) {
            Ok(_) => tracing::info!("migration applied: {stmt}"),
            Err(e) if e.to_string().contains("duplicate column") => {}
            Err(e) => tracing::error!("migration failed: {stmt}: {e}"),
        }
    }
    conn.execute_batch("
        CREATE UNIQUE INDEX IF NOT EXISTS idx_wl_domain ON api_keys(white_label_domain)
        WHERE white_label_domain IS NOT NULL;
    ").ok();
}

pub fn upsert_job(db: &Db, job: &Job) {
    let conn = db.lock().unwrap_or_else(|e| e.into_inner());
    // Strip secret credentials before persisting. Non-secret metadata
    // (provider, bucket, endpoint, region, target_path) is kept so the job
    // record retains display/audit context. Credentials must be supplied
    // fresh at export time via POST /export — never read back from the DB.
    // Wire safety is separately guaranteed by PublicJob which strips
    // destination entirely.
    let dest_json = job.destination.as_ref().and_then(|d| {
        serde_json::to_string(&serde_json::json!({
            "provider":    d.provider,
            "bucket":      d.bucket,
            "endpoint":    d.endpoint,
            "region":      d.region,
            "target_path": d.target_path,
        })).ok()
    });
    if let Err(e) = conn.execute(
        "INSERT INTO jobs
         (id,status,media_kind,input_path,output_path,original_bytes,compressed_bytes,
          duration_secs,progress,eta_secs,webhook_url,preset,destination_json,remote_url,owner_key)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
         ON CONFLICT(id) DO UPDATE SET
           status=excluded.status, progress=excluded.progress, eta_secs=excluded.eta_secs,
           compressed_bytes=excluded.compressed_bytes, output_path=excluded.output_path,
           destination_json=excluded.destination_json, remote_url=excluded.remote_url,
           owner_key=excluded.owner_key",
        params![
            job.id,
            format!("{:?}", job.status).to_lowercase(),
            format!("{:?}", job.media_kind).to_lowercase(),
            job.input_path, job.output_path,
            job.original_bytes as i64, job.compressed_bytes as i64,
            job.duration_secs, job.progress as i64, job.eta_secs as i64,
            job.webhook_url, job.preset, dest_json, job.remote_url, job.owner_key
        ],
    ) {
        tracing::error!("upsert_job failed for {}: {e}", job.id);
    }
}

fn map_job_row(row: &rusqlite::Row) -> rusqlite::Result<Job> {
    let status_str: String = row.get(1)?;
    let kind_str: String = row.get(2)?;
    let dest_json: Option<String> = row.get(12)?;
    Ok(Job {
        id: row.get(0)?,
        status: match status_str.as_str() {
            "processing" => JobStatus::Processing,
            "done"       => JobStatus::Done,
            "failed"     => JobStatus::Failed,
            _            => JobStatus::Queued,
        },
        media_kind: match kind_str.as_str() {
            "audiolossless" | "audio_lossless" => MediaKind::AudioLossless,
            "audiolossy" | "audio_lossy"       => MediaKind::AudioLossy,
            "imageanimated" | "image_animated" => MediaKind::ImageAnimated,
            "imagestatic" | "image_static"     => MediaKind::ImageStatic,
            _                                  => MediaKind::Video,
        },
        input_path:       row.get(3)?,
        output_path:      row.get(4)?,
        original_bytes:   row.get::<_, i64>(5)? as u64,
        compressed_bytes: row.get::<_, i64>(6)? as u64,
        duration_secs:    row.get(7)?,
        progress:         row.get::<_, i64>(8)? as u8,
        eta_secs:         row.get::<_, i64>(9)? as u64,
        webhook_url:      row.get(10)?,
        preset:           row.get(11)?,
        destination:      dest_json.and_then(|j| serde_json::from_str(&j).ok()),
        remote_url:       row.get(13)?,
        owner_key:        row.get(14)?,
    })
}

const JOB_SELECT: &str =
    "SELECT id,status,media_kind,input_path,output_path,original_bytes,compressed_bytes,
            duration_secs,progress,eta_secs,webhook_url,preset,destination_json,remote_url,owner_key
     FROM jobs";

pub fn get_job(db: &Db, id: &str) -> Option<Job> {
    let conn = db.lock().unwrap_or_else(|e| e.into_inner());
    conn.query_row(
        &format!("{JOB_SELECT} WHERE id=?1"),
        params![id],
        map_job_row,
    ).ok()
}

/// Scoped accessor — returns `None` when the caller does not own the job.
/// SQLite's `IS` compares NULLs correctly: anonymous job (owner_key NULL)
/// matches `caller = None` and nothing else. Returns 404-equivalent for both
/// "not found" and "wrong owner" so it is not an existence oracle.
pub fn get_job_for(db: &Db, id: &str, caller: Option<&str>) -> Option<Job> {
    let conn = db.lock().unwrap_or_else(|e| e.into_inner());
    match conn.query_row(
        &format!("{JOB_SELECT} WHERE id=?1 AND owner_key IS ?2"),
        params![id, caller],
        map_job_row,
    ) {
        Ok(job) => Some(job),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(e) => {
            tracing::warn!("get_job_for failed for id={id}, caller={caller:?}: {e}");
            None
        }
    }
}

pub fn load_all_jobs(conn: &Connection) -> Vec<Job> {
    let mut stmt = match conn.prepare(JOB_SELECT) {
        Ok(s) => s,
        Err(e) => { tracing::error!("load_all_jobs prepare failed: {e}"); return vec![]; }
    };
    let rows: Vec<Job> = match stmt.query_map([], map_job_row) {
        Ok(r) => r.flatten().collect(),
        Err(e) => { tracing::error!("load_all_jobs query failed: {e}"); vec![] }
    };
    rows
}
