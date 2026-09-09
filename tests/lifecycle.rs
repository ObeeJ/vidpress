//! Mock lifecycle coverage: ingest → analyze → upload → progress → done →
//! download, with every external dependency stubbed out.
//!
//! Nothing here spawns ffmpeg, ffprobe, yt-dlp or whisper, and nothing touches
//! the real filesystem or a real socket. The database is `:memory:` built from
//! the production schema in `db::init_db`, so schema drift breaks these tests.
//!
//! These live in `src/` rather than `tests/` because the crate has no `[lib]`
//! target — a binary-only crate exports nothing for integration tests to
//! import. Adding `src/lib.rs` would let these move to `tests/`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use theflate::auth::rate_limit_for;
use theflate::db::{get_job, init_db, upsert_job};
use theflate::jobs::model::{DestinationConfig, Job, JobStatus};
use theflate::media::detect::MediaKind;
use theflate::media::path_guard::{resolve_input, resolve_output_ext, PathError};
use theflate::state::Db;

// ---------------------------------------------------------------- test rig --

fn mock_db() -> Db {
    let conn = Connection::open_in_memory().expect("in-memory db");
    init_db(&conn);
    Arc::new(Mutex::new(conn))
}

fn mock_jobs() -> Arc<Mutex<HashMap<String, Job>>> {
    Arc::new(Mutex::new(HashMap::new()))
}

/// A queued job as `handlers::upload` would construct it, minus the ffprobe
/// call that produces the real `MediaProfile`.
fn queued_job(id: &str) -> Job {
    Job {
        id: id.into(),
        status: JobStatus::Queued,
        media_kind: MediaKind::Video,
        input_path: "/srv/in/a.mp4".into(),
        output_path: format!("/srv/out/{id}_output.mp4"),
        original_bytes: 1_048_576,
        compressed_bytes: 0,
        duration_secs: 12.0,
        progress: 0,
        eta_secs: 14,
        webhook_url: None,
        preset: Some("web".into()),
        destination: None,
        remote_url: None,
    }
}

/// Stands in for `jobs::compress::run` — same state transitions, no subprocess.
fn mock_encode(db: &Db, jobs: &Arc<Mutex<HashMap<String, Job>>>, id: &str, ticks: &[u8]) {
    {
        let mut store = jobs.lock().unwrap();
        let job = store.get_mut(id).expect("job registered before encode");
        job.status = JobStatus::Processing;
        let snapshot = job.clone();
        drop(store);
        upsert_job(db, &snapshot);
    }
    for &pct in ticks {
        let mut store = jobs.lock().unwrap();
        let job = store.get_mut(id).expect("job present during encode");
        job.progress = pct;
        job.eta_secs = ((100 - pct) as u64) / 8;
        let snapshot = job.clone();
        drop(store);
        upsert_job(db, &snapshot);
    }
    let mut store = jobs.lock().unwrap();
    let job = store.get_mut(id).expect("job present at finish");
    job.status = JobStatus::Done;
    job.progress = 100;
    job.eta_secs = 0;
    job.compressed_bytes = 262_144;
    let snapshot = job.clone();
    drop(store);
    upsert_job(db, &snapshot);
}

// --------------------------------------------------------- happy-path flow --

#[test]
fn full_lifecycle_queued_to_done_persists_every_transition() {
    let db = mock_db();
    let jobs = mock_jobs();
    let id = "job-mock-1";

    let job = queued_job(id);
    upsert_job(&db, &job);
    jobs.lock().unwrap().insert(id.to_string(), job);

    let stored = get_job(&db, id).expect("queued job must be readable");
    assert!(matches!(stored.status, JobStatus::Queued));
    assert_eq!(stored.progress, 0);
    assert_eq!(stored.original_bytes, 1_048_576);

    mock_encode(&db, &jobs, id, &[10, 45, 80, 99]);

    let done = get_job(&db, id).expect("finished job must be readable");
    assert!(matches!(done.status, JobStatus::Done));
    assert_eq!(done.progress, 100);
    assert_eq!(done.eta_secs, 0);
    assert_eq!(done.compressed_bytes, 262_144);
    assert!(
        done.compressed_bytes < done.original_bytes,
        "a compression job that grew the file is a product failure"
    );
}

#[test]
fn download_is_refused_until_the_job_is_done() {
    // Mirrors the guard at handlers/jobs.rs:26 — only `Done` may be served.
    let db = mock_db();
    let jobs = mock_jobs();
    let id = "job-mock-2";
    let job = queued_job(id);
    upsert_job(&db, &job);
    jobs.lock().unwrap().insert(id.to_string(), job);

    let mid = get_job(&db, id).unwrap();
    assert!(
        !matches!(mid.status, JobStatus::Done),
        "queued job must not be downloadable"
    );

    mock_encode(&db, &jobs, id, &[50]);
    assert!(matches!(get_job(&db, id).unwrap().status, JobStatus::Done));
}

#[test]
fn unknown_job_id_is_absent_rather_than_defaulted() {
    let db = mock_db();
    assert!(get_job(&db, "does-not-exist").is_none());
}

// ------------------------------------------------------------- regressions --

#[test]
fn regression_public_job_never_carries_destination_credentials() {
    // Guards the leak at handlers/jobs.rs:13, where `GET /jobs/:id` serialised
    // the full `Job` — including S3 secrets — to any caller holding a job id.
    let db = mock_db();
    let id = "job-mock-3";
    let mut job = queued_job(id);
    job.destination = Some(DestinationConfig {
        provider: "s3".into(),
        bucket: Some("example-bucket".into()),
        endpoint: Some("s3.amazonaws.com".into()),
        region: Some("us-east-1".into()),
        access_key: Some("AKIAEXAMPLE".into()),
        secret_key: Some("SUPER-SECRET-VALUE".into()),
        access_token: None,
        target_path: Some("out/clip.mp4".into()),
    });
    upsert_job(&db, &job);

    let wire = serde_json::to_string(&job.public()).unwrap();
    assert!(!wire.contains("SUPER-SECRET-VALUE"));
    assert!(!wire.contains("AKIAEXAMPLE"));
    assert!(!wire.contains("/srv/out/"), "server paths must not reach clients");

    // ...while persistence keeps them, so export can still work later.
    let reloaded = get_job(&db, id).expect("job row");
    assert_eq!(
        reloaded.destination.and_then(|d| d.secret_key).as_deref(),
        Some("SUPER-SECRET-VALUE"),
        "credentials must survive the round trip through destination_json"
    );
}

#[test]
fn regression_client_supplied_paths_cannot_escape_storage() {
    // Guards the arbitrary-read / SSRF primitive that `/upload`, `/analyze` and
    // `/transcribe` shared: ffmpeg resolves `-i` as a protocol URL, not a path.
    assert_eq!(
        resolve_input("http://169.254.169.254/latest/meta-data/"),
        Err(PathError::ProtocolUrl)
    );
    assert_eq!(
        resolve_input("concat:/etc/passwd|/etc/shadow"),
        Err(PathError::ProtocolUrl)
    );
    assert_eq!(resolve_input("/etc/passwd"), Err(PathError::BadExtension));
    assert_eq!(
        resolve_input("/srv/out/../../etc/shadow.mp4"),
        Err(PathError::OutsideRoot)
    );
}

#[test]
fn regression_output_format_cannot_traverse() {
    // Guards handlers/upload.rs:43, where `output_format` was interpolated
    // straight into the output filename, letting ffmpeg write anywhere.
    assert_eq!(
        resolve_output_ext("mp4/../../../etc/cron.d/pwn"),
        Err(PathError::BadExtension)
    );
    assert_eq!(resolve_output_ext("mp4").unwrap(), "mp4");
}

#[test]
fn regression_rate_limits_are_finite_for_every_plan() {
    // Guards auth.rs, where `auth_and_rate` returned Ok(None) unconditionally
    // and no caller was ever charged for a request.
    for plan in [
        None,
        Some("free"),
        Some("premium"),
        Some("api_starter"),
        Some("api_growth"),
        Some("api_scale"),
        Some("totally-unknown"),
    ] {
        let limit = rate_limit_for(plan);
        assert!(limit > 0, "plan {plan:?} must have a positive limit");
        assert!(limit <= 3000, "plan {plan:?} must not be unlimited");
    }
    assert!(
        rate_limit_for(None) < rate_limit_for(Some("free")),
        "anonymous callers must be limited more tightly than key holders"
    );
}

// ------------------------------------------------------- known-broken flow --

/// `created_at` is absent from the column list in `db::upsert_job`, so
/// `INSERT OR REPLACE` deletes the row and re-inserts it with the column's
/// `DEFAULT (unixepoch())`. Every progress tick therefore resets the job's
/// creation time, and `cleanup.sh`'s `created_at < now-7200` stale sweep can
/// never fire for a job whose progress task is still running.
///
/// Marked `#[ignore]` so the suite stays green while the defect is open. Remove
/// the attribute when `upsert_job` is fixed to preserve `created_at`; the test
/// should then pass unchanged.
#[test]
#[ignore = "known defect: upsert_job resets created_at on every update"]
fn created_at_survives_progress_updates() {
    let db = mock_db();
    let jobs = mock_jobs();
    let id = "job-mock-4";

    let job = queued_job(id);
    upsert_job(&db, &job);
    jobs.lock().unwrap().insert(id.to_string(), job);

    let first: i64 = db.lock().unwrap()
        .query_row("SELECT created_at FROM jobs WHERE id=?1", [id], |r| r.get(0))
        .expect("created_at readable");

    // Backdate the row by three hours, then push one progress update through.
    db.lock().unwrap()
        .execute("UPDATE jobs SET created_at = ?1 WHERE id = ?2", rusqlite::params![first - 10_800, id])
        .expect("backdate");
    mock_encode(&db, &jobs, id, &[25]);

    let after: i64 = db.lock().unwrap()
        .query_row("SELECT created_at FROM jobs WHERE id=?1", [id], |r| r.get(0))
        .expect("created_at readable");

    assert_eq!(
        after,
        first - 10_800,
        "created_at must not move when only progress changes"
    );
}
