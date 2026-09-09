use theflate::webhook::{is_public_url, sign::signature};

#[test]
fn signature_is_stable_and_timestamped() {
    let s = signature("secret", r#"{"id":"j1"}"#, 1_757_404_860);
    assert!(s.starts_with("t=1757404860,v1="));
    assert_eq!(s, signature("secret", r#"{"id":"j1"}"#, 1_757_404_860));
    assert_ne!(s, signature("other", r#"{"id":"j1"}"#, 1_757_404_860));
}

#[test]
fn ssrf_guard_blocks_known_bypasses() {
    for bad in [
        "http://127.0.0.1/",
        "http://localhost/",
        "http://169.254.169.254/",
        "http://evil.com@127.0.0.1/",
        "http://10.0.0.5/",
        "http://192.168.1.1/",
        "http://172.16.0.1/",
        "file:///etc/passwd",
        "gopher://x/",
    ] {
        assert!(!is_public_url(bad), "should block {bad}");
    }
    assert!(is_public_url("https://github.com/theflate/hook"));
}
