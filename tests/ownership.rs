use std::sync::{Arc, Mutex};
use rusqlite::Connection;
use theflate::{db::{init_db, get_job_for, upsert_job}, state::Db};
use theflate::jobs::model::{Job, JobStatus};
use theflate::media::detect::MediaKind;

fn mem_db() -> Db {
    let c = Connection::open_in_memory().unwrap();
    init_db(&c);
    Arc::new(Mutex::new(c))
}

fn owned_job(id: &str, owner: &str) -> Job {
    Job {
        id: id.into(), status: JobStatus::Done, media_kind: MediaKind::Video,
        input_path: "/in/a.mp4".into(), output_path: "/out/a.mp4".into(),
        original_bytes: 100, compressed_bytes: 40, duration_secs: 1.0,
        progress: 100, eta_secs: 0, webhook_url: None, preset: None,
        destination: None, remote_url: None, owner_key: Some(owner.into()),
    }
}

#[test]
fn a_job_is_invisible_to_other_keys() {
    let db = mem_db();
    upsert_job(&db, &owned_job("job-x", "vp_ALICE"));

    assert!(get_job_for(&db, "job-x", Some("vp_ALICE")).is_some());
    assert!(get_job_for(&db, "job-x", Some("vp_BOB")).is_none(), "cross-tenant read");
    assert!(get_job_for(&db, "job-x", None).is_none(), "anonymous read of owned job");
}

#[test]
fn anonymous_job_visible_only_anonymously() {
    let db = mem_db();
    let mut job = owned_job("job-y", "vp_ALICE");
    job.owner_key = None;
    upsert_job(&db, &job);

    assert!(get_job_for(&db, "job-y", None).is_some());
    assert!(get_job_for(&db, "job-y", Some("vp_ALICE")).is_none());
}
