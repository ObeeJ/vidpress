use std::time::Duration;

pub async fn deliver(url: &str, payload: &str) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default();
    for attempt in 0..3u32 {
        match client.post(url)
            .header("content-type", "application/json")
            .header("x-theflate-event", "job.done")
            .body(payload.to_string())
            .send().await
        {
            Ok(r) if r.status().is_success() => {
                tracing::info!("webhook delivered to {url} on attempt {attempt}");
                return;
            }
            Ok(r) => tracing::warn!("webhook {url} returned {}", r.status()),
            Err(e) => tracing::warn!("webhook {url} failed: {e}"),
        }
        tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;
    }
    tracing::error!("webhook {url} failed after 3 attempts");
}
