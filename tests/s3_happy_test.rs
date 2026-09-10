use theflate::export::s3;
use theflate::jobs::model::DestinationConfig;

#[tokio::test]
async fn test_s3_export_real_upload_to_minio() {
    std::fs::write("/tmp/s3_happy_test_file.mp4", b"hello theflate").unwrap();
    let cfg = DestinationConfig {
        provider: "s3".into(), bucket: Some("my-test-bucket".into()),
        endpoint: Some("http://localhost:9000".into()), region: Some("us-east-1".into()),
        access_key: Some("testkey".into()), secret_key: Some("testsecret123".into()),
        access_token: None, target_path: Some("exports/happy2.mp4".into()),
    };
    let res = s3::upload(&cfg, "/tmp/s3_happy_test_file.mp4").await;
    println!("RESULT: {:?}", res);
    assert!(res.is_ok());
    let url = res.unwrap();
    assert!(url.starts_with("http://localhost:9000/my-test-bucket/"), "expected path-style URL, got {url}");
}
