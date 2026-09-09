use theflate::auth::rate_limit_for;

#[test]
fn library_target_is_importable() {
    assert_eq!(rate_limit_for(Some("free")), 60);
}
