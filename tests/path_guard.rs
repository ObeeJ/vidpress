use std::fs;
use theflate::media::path_guard::{ingest_dir, resolve_input};

#[test]
fn a_file_written_where_ingest_writes_is_accepted() {
    let dir = ingest_dir();
    fs::create_dir_all(&dir).expect("create ingest dir");
    let p = format!("{dir}/theflate_test_fixture.mp4");
    fs::write(&p, b"not really an mp4").expect("write fixture");

    let resolved = resolve_input(&p);
    fs::remove_file(&p).ok();

    assert!(resolved.is_ok(), "ingest_dir() must be an accepted root, got {resolved:?}");
}
