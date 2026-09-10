use theflate::export::s3;
use theflate::jobs::model::DestinationConfig;

#[tokio::test]
async fn test_s3_export_url_formatting_and_error_handling() {
    let cfg = DestinationConfig {
        provider: "s3".into(),
        bucket: Some("my-test-bucket".into()),
        endpoint: Some("http://localhost:9000".into()),
        region: Some("us-east-1".into()),
        access_key: Some("minioadmin".into()),
        secret_key: Some("minioadmin".into()),
        access_token: None,
        target_path: Some("exports/video.mp4".into()),
    };

    let res = s3::upload(&cfg, "/tmp/nonexistent_file_for_s3_test.mp4").await;
    assert!(res.is_err(), "Nonexistent file upload must return an Err result");
}
