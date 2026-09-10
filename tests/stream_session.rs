use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use rusqlite::Connection;
use tempfile::TempDir;

use theflate::db::{get_job, init_db};
use theflate::jobs::stream as stream_job;
use theflate::state::{Db, JobStore};

#[tokio::test]
async fn test_live_stream_session_lifecycle() {
    let tmp = TempDir::new().expect("tempdir");
    let stor = tmp.path().join("storage_stream");
    std::fs::create_dir_all(&stor).ok();
    std::env::set_var("THEFLATE_STORAGE", stor.to_str().unwrap());

    let conn = Connection::open_in_memory().expect("in-memory db");
    init_db(&conn);
    let db: Db = Arc::new(Mutex::new(conn));
    let jobs: JobStore = Arc::new(Mutex::new(HashMap::new()));

    let id = "test-stream-job-1".to_string();
    let mut session = stream_job::start_session(&id).expect("start stream session");

    let sample_data = b"test video chunk data payload";
    let _ = stream_job::write_chunk(&mut session.stdin, sample_data).await;

    stream_job::finish_session(id.clone(), session, &jobs, &db).await;

    let stored = get_job(&db, &id);
    assert!(stored.is_some(), "stream job row must be written to DB");
}
