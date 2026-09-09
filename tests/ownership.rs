use std::sync::{Arc, Mutex};
use rusqlite::Connection;
use theflate::{db::{init_db, get_job_for}, state::Db};

fn mem_db() -> Db {
    let c = Connection::open_in_memory().unwrap();
    init_db(&c);
    Arc::new(Mutex::new(c))
}

#[test]
fn a_job_is_invisible_to_other_keys() {
    let db = mem_db();
    db.lock().unwrap().execute(
        "INSERT INTO jobs(id,status,media_kind,input_path,output_path,owner_key)
         VALUES('job-x','done','video','/in/a.mp4','/out/a.mp4','vp_ALICE')", []).unwrap();

    assert!(get_job_for(&db, "job-x", Some("vp_ALICE")).is_some());
    assert!(get_job_for(&db, "job-x", Some("vp_BOB")).is_none(), "cross-tenant read");
    assert!(get_job_for(&db, "job-x", None).is_none(), "anonymous read of owned job");
}
