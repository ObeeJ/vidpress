use aws_sdk_s3::{
    config::{Credentials, Region},
    primitives::ByteStream,
    Client, Config,
};
use crate::jobs::model::DestinationConfig;

/// Upload `local_path` to an S3-compatible endpoint. Returns the canonical
/// object URL on success. Streams the file — never reads it into memory. (C7)
pub async fn upload(cfg: &DestinationConfig, local_path: &str) -> Result<String, String> {
    let access_key = cfg.access_key.as_deref().unwrap_or_default();
    let secret_key = cfg.secret_key.as_deref().unwrap_or_default();
    let bucket     = cfg.bucket.as_deref().unwrap_or("theflate-output");
    let region     = cfg.region.as_deref().unwrap_or("us-east-1");
    let key        = cfg.target_path.as_deref()
        .unwrap_or_else(|| std::path::Path::new(local_path)
            .file_name().and_then(|n| n.to_str()).unwrap_or("output"));

    let creds = Credentials::new(access_key, secret_key, None, None, "theflate");
    let mut builder = Config::builder()
        .credentials_provider(creds)
        .region(Region::new(region.to_string()))
        .behavior_version_latest();

    if let Some(endpoint) = cfg.endpoint.as_deref() {
        let ep = if endpoint.starts_with("http") { endpoint.to_string() }
                 else { format!("https://{endpoint}") };
        builder = builder.endpoint_url(ep);
        // Every non-AWS S3-compatible service we support (MinIO, R2, Supabase
        // Storage) needs path-style addressing (endpoint/bucket/key) — the
        // SDK's default virtual-hosted-style (bucket.endpoint/key) silently
        // drops the bucket and misroutes the object when the endpoint isn't
        // configured to recognize bucket subdomains. Confirmed by a real
        // MinIO upload that landed under the wrong bucket entirely.
        builder = builder.force_path_style(true);
    }

    let client = Client::from_conf(builder.build());
    let stream = ByteStream::from_path(local_path).await
        .map_err(|e| format!("read file: {e}"))?;

    client.put_object()
        .bucket(bucket)
        .key(key)
        .body(stream)
        .send().await
        .map_err(|e| format!("s3 put: {e}"))?;

    let url = match cfg.endpoint.as_deref() {
        // Path-style, matching force_path_style(true) above — a
        // virtual-hosted-style URL here would look plausible but 404 for any
        // endpoint (MinIO, R2, Supabase) not configured for bucket subdomains.
        Some(ep) => {
            let ep = ep.trim_end_matches('/');
            format!("{ep}/{bucket}/{key}")
        }
        None => format!("https://{bucket}.s3.{region}.amazonaws.com/{key}"),
    };
    Ok(url)
}
