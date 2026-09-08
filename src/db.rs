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
    ").expect("db init failed");

    // Migrations — safe to run repeatedly (ok() = no-op if column exists)
    conn.execute_batch("
        ALTER TABLE api_keys ADD COLUMN white_label_domain TEXT;
        ALTER TABLE api_keys ADD COLUMN white_label_brand TEXT;
        ALTER TABLE api_keys ADD COLUMN default_destination TEXT;
        ALTER TABLE jobs ADD COLUMN destination_json TEXT;
        ALTER TABLE jobs ADD COLUMN remote_url TEXT;
    ").ok();
    conn.execute_batch("
        CREATE UNIQUE INDEX IF NOT EXISTS idx_wl_domain ON api_keys(white_label_domain)
        WHERE white_label_domain IS NOT NULL;
    ").ok();
}

pub fn upsert_job(db: &Db, job: &Job) {
    let conn = db.lock().unwrap();
    let dest_json = job.destination.as_ref().and_then(|d| serde_json::to_string(d).ok());
    if let Err(e) = conn.execute(
        "INSERT OR REPLACE INTO jobs
         (id,status,media_kind,input_path,output_path,original_bytes,compressed_bytes,
          duration_secs,progress,eta_secs,webhook_url,preset,destination_json,remote_url)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
        params![
            job.id,
            format!("{:?}", job.status).to_lowercase(),
            format!("{:?}", job.media_kind).to_lowercase(),
            job.input_path, job.output_path,
            job.original_bytes as i64, job.compressed_bytes as i64,
            job.duration_secs, job.progress as i64, job.eta_secs as i64,
            job.webhook_url, job.preset, dest_json, job.remote_url
        ],
    ) {
        tracing::error!("upsert_job failed for {}: {e}", job.id);
    }
}

pub fn get_job(db: &Db, id: &str) -> Option<Job> {
    let conn = db.lock().unwrap();
    conn.query_row(
        "SELECT id,status,media_kind,input_path,output_path,original_bytes,compressed_bytes,
                duration_secs,progress,eta_secs,webhook_url,preset,destination_json,remote_url
         FROM jobs WHERE id=?1",
        params![id],
        |row| {
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
                    "audio_lossless" => MediaKind::AudioLossless,
                    "audio_lossy"    => MediaKind::AudioLossy,
                    "image_animated" => MediaKind::ImageAnimated,
                    "image_static"   => MediaKind::ImageStatic,
                    _                => MediaKind::Video,
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
            })
        },
    ).ok()
}

pub fn load_all_jobs(conn: &Connection) -> Vec<Job> {
    let mut stmt = conn.prepare(
        "SELECT id,status,media_kind,input_path,output_path,original_bytes,compressed_bytes,
                duration_secs,progress,eta_secs,webhook_url,preset
         FROM jobs"
    ).unwrap();
    stmt.query_map([], |row| {
        let status_str: String = row.get(1)?;
        let kind_str: String = row.get(2)?;
        Ok(Job {
            id: row.get(0)?,
            status: match status_str.as_str() {
                "processing" => JobStatus::Failed, // stale on restart
                "done"       => JobStatus::Done,
                "failed"     => JobStatus::Failed,
                _            => JobStatus::Queued,
            },
            media_kind: match kind_str.as_str() {
                "audio_lossless" => MediaKind::AudioLossless,
                "audio_lossy"    => MediaKind::AudioLossy,
                "image_animated" => MediaKind::ImageAnimated,
                "image_static"   => MediaKind::ImageStatic,
                _                => MediaKind::Video,
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
            destination:      None,
            remote_url:       None,
        })
    }).unwrap().flatten().collect()
}
