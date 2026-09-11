//! Jobs must not survive a restart still claiming to be running.
//!
//! Job state is persisted in SQLite, but the work happens in child ffmpeg and
//! yt-dlp processes owned by the server process. A deploy, crash or reboot
//! kills the children and leaves the rows untouched - so a job sits at
//! "processing" forever, showing a progress bar that can never move and giving
//! the user no way to tell it is already dead. This was observed in
//! production: a download read as in-progress for twenty minutes after the
//! container had been replaced and nothing was running inside it.
//!
//! Deploys are precisely when restarts happen, so this matters more, not less,
//! once the service is live.

use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use theflate::db::{init_db, load_all_jobs, reconcile_interrupted_jobs, upsert_job};
use theflate::jobs::model::{Job, JobStatus};
use theflate::media::detect::MediaKind;

fn temp_db(tag: &str) -> (Connection, std::path::PathBuf) {
    let mut p = std::env::temp_dir();
    p.push(format!("theflate_restart_{}_{tag}.db", std::process::id()));
    let _ = std::fs::remove_file(&p);
    let conn = Connection::open(&p).expect("open temp db");
    init_db(&conn);
    (conn, p)
}

fn job(id: &str, status: JobStatus, progress: u8) -> Job {
    Job {
        id: id.into(),
        status,
        media_kind: MediaKind::Video,
        input_path: format!("/tmp/in_{id}.mp4"),
        output_path: format!("/tmp/out_{id}.mp4"),
        original_bytes: 1000,
        compressed_bytes: 0,
        duration_secs: 60.0,
        progress,
        eta_secs: 120,
        webhook_url: None,
        preset: None,
        destination: None,
        remote_url: None,
        owner_key: None,
    }
}

/// The exact production symptom: rows left mid-flight by a vanished process.
#[test]
fn interrupted_jobs_are_failed_on_startup() {
    let (conn, path) = temp_db("sweep");
    let db: theflate::state::Db = Arc::new(Mutex::new(Connection::open(&path).unwrap()));

    upsert_job(&db, &job("running", JobStatus::Processing, 47));
    upsert_job(&db, &job("waiting", JobStatus::Queued, 0));
    upsert_job(&db, &job("finished", JobStatus::Done, 100));
    upsert_job(&db, &job("broken", JobStatus::Failed, 12));

    let swept = reconcile_interrupted_jobs(&conn);
    assert_eq!(swept, 2, "only the queued and processing rows should be swept");

    let all = load_all_jobs(&conn);
    let find = |id: &str| {
        all.iter()
            .find(|j| j.id == id)
            .unwrap_or_else(|| panic!("job {id} missing"))
    };

    // The two that could not possibly still be running.
    assert!(matches!(find("running").status, JobStatus::Failed));
    assert!(matches!(find("waiting").status, JobStatus::Failed));

    // Completed work must never be rewritten - that would destroy a finished
    // output's record and make a successful job look broken.
    assert!(matches!(find("finished").status, JobStatus::Done));
    assert_eq!(find("finished").progress, 100);
    assert!(matches!(find("broken").status, JobStatus::Failed));

    // Progress is preserved so "failed at 47%" stays distinguishable from
    // "never started", the same reasoning as the encoder's failure paths.
    assert_eq!(find("running").progress, 47);
    // A dead job has no eta; leaving one would keep a countdown ticking in the
    // UI for work that will never finish.
    assert_eq!(find("running").eta_secs, 0);

    let _ = std::fs::remove_file(&path);
}

/// Running twice must not keep rewriting rows - the second pass has nothing
/// left to sweep. Startup code runs on every boot, so it has to be idempotent.
#[test]
fn reconciliation_is_idempotent() {
    let (conn, path) = temp_db("idem");
    let db: theflate::state::Db = Arc::new(Mutex::new(Connection::open(&path).unwrap()));

    upsert_job(&db, &job("a", JobStatus::Processing, 10));
    assert_eq!(reconcile_interrupted_jobs(&conn), 1);
    assert_eq!(
        reconcile_interrupted_jobs(&conn),
        0,
        "a second sweep must find nothing"
    );

    let _ = std::fs::remove_file(&path);
}

/// An empty database is the normal first-boot case and must be silent.
#[test]
fn empty_database_sweeps_nothing() {
    let (conn, path) = temp_db("empty");
    assert_eq!(reconcile_interrupted_jobs(&conn), 0);
    assert!(load_all_jobs(&conn).is_empty());
    let _ = std::fs::remove_file(&path);
}
