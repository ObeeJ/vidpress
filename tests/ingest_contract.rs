use std::sync::{Arc, Mutex};
use rusqlite::Connection;
use theflate::{db::init_db, ingest_store, state::Db};

fn mem_db() -> Db {
    let c = Connection::open_in_memory().unwrap();
    init_db(&c);
    Arc::new(Mutex::new(c))
}

#[test]
fn an_id_resolves_only_for_its_owner() {
    let db = mem_db();
    ingest_store::record(&db, "ing-1", "/srv/in/a.mp4", Some("vp_OWNER")).unwrap();

    assert_eq!(ingest_store::resolve(&db, "ing-1", Some("vp_OWNER")).as_deref(), Some("/srv/in/a.mp4"));
    assert_eq!(ingest_store::resolve(&db, "ing-1", Some("vp_OTHER")), None, "cross-tenant read");
    assert_eq!(ingest_store::resolve(&db, "ing-1", None), None, "anonymous read of owned ingest");
}

#[test]
fn anonymous_ingests_are_readable_anonymously_but_not_by_keys() {
    let db = mem_db();
    ingest_store::record(&db, "ing-2", "/srv/in/b.mp4", None).unwrap();
    assert_eq!(ingest_store::resolve(&db, "ing-2", None).as_deref(), Some("/srv/in/b.mp4"));
    assert_eq!(ingest_store::resolve(&db, "ing-2", Some("vp_X")), None);
}

#[test]
fn unknown_ids_never_resolve() {
    let db = mem_db();
    assert_eq!(ingest_store::resolve(&db, "../../etc/passwd", None), None);
    assert_eq!(ingest_store::resolve(&db, "", None), None);
}
