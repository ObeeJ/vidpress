use rusqlite::Connection;
use theflate::db::init_db;

#[test]
fn every_migration_applies_on_a_second_boot() {
    let c = Connection::open_in_memory().unwrap();
    init_db(&c);
    init_db(&c);   // simulate a restart against an existing database

    for col in ["white_label_domain", "white_label_brand", "default_destination"] {
        let n: i64 = c.query_row(
            &format!("SELECT COUNT(*) FROM pragma_table_info('api_keys') WHERE name='{col}'"),
            [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "api_keys.{col} missing after second init");
    }
    for col in ["destination_json", "remote_url", "owner_key"] {
        let n: i64 = c.query_row(
            &format!("SELECT COUNT(*) FROM pragma_table_info('jobs') WHERE name='{col}'"),
            [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "jobs.{col} missing after second init");
    }
}
