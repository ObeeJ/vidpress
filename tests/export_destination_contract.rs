use theflate::jobs::model::DestinationConfig;

#[test]
fn export_body_from_ui_deserializes() {
    // Byte-for-byte the shape lib/api.ts exportToDestination() now sends.
    let body: serde_json::Value = serde_json::json!({
        "job_id": "job_abc",
        "provider": "s3",
        "destination": {
            "provider": "s3",
            "bucket": "my-bucket",
            "endpoint": serde_json::Value::Null,
            "region": "us-east-1",
            "access_key": "AKIA_FAKE",
            "secret_key": "SECRET_FAKE",
            "target_path": "exports/clip.mp4"
        }
    });

    let cfg: DestinationConfig =
        serde_json::from_value(body["destination"].clone()).expect("must deserialize");

    assert_eq!(cfg.provider, "s3");
    assert_eq!(cfg.bucket.as_deref(), Some("my-bucket"));
    assert_eq!(cfg.region.as_deref(), Some("us-east-1"));
    assert_eq!(cfg.access_key.as_deref(), Some("AKIA_FAKE"));
    assert_eq!(cfg.secret_key.as_deref(), Some("SECRET_FAKE"));
    assert_eq!(cfg.target_path.as_deref(), Some("exports/clip.mp4"));
    assert!(cfg.endpoint.is_none());
}

#[test]
fn missing_destination_is_rejected_not_defaulted() {
    // The 400 path: absent destination must fail, never silently default.
    let body = serde_json::json!({ "job_id": "job_abc", "provider": "s3" });
    let parsed = serde_json::from_value::<DestinationConfig>(body["destination"].clone());
    assert!(parsed.is_err(), "absent destination must not deserialize");
}
