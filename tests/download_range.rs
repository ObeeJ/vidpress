use theflate::handlers::jobs::parse_range;

#[test]
fn rejects_ranges_that_would_underflow() {
    assert_eq!(parse_range("bytes=99999999999-", 1000), None);
    assert_eq!(parse_range("bytes=900-100", 1000), None);
    assert_eq!(parse_range("bytes=0-", 0), None);
}

#[test]
fn accepts_well_formed_ranges() {
    assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
    assert_eq!(parse_range("bytes=500-", 1000), Some((500, 999)));
    assert_eq!(parse_range("bytes=0-99999", 1000), Some((0, 999)));
}

#[test]
fn rejects_malformed_headers() {
    for h in ["", "bytes=", "items=0-10", "bytes=abc-def", "bytes=-100"] {
        assert_eq!(parse_range(h, 1000), None, "should reject {h:?}");
    }
}
