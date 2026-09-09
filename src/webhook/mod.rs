pub mod sign;

use std::time::Duration;

/// SSRF guard — resolves the hostname and rejects any address that is
/// loopback, private, link-local, or unspecified. String prefix matching
/// cannot be made correct (decimal IPs, IPv6-mapped, userinfo confusion all
/// defeat it). Resolution defeats all of them at once. (H3, H4)
pub fn is_public_url(url: &str) -> bool {
    let url = url.trim();
    // Only http/https allowed.
    let rest = match url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")) {
        Some(r) => r,
        None => return false,
    };
    // Strip userinfo (defeats http://evil@127.0.0.1/).
    let rest = rest.splitn(2, '@').last().unwrap_or(rest);
    // Extract host (strip path, port, fragment).
    let host_port = rest.splitn(2, '/').next().unwrap_or(rest);
    let host = if host_port.starts_with('[') {
        // IPv6 literal
        host_port.splitn(2, ']').next().unwrap_or(host_port).trim_start_matches('[')
    } else {
        host_port.splitn(2, ':').next().unwrap_or(host_port)
    };
    if host.is_empty() { return false; }

    // Resolve — this is synchronous but called only at request admission time,
    // not in a hot path.
    let addrs = match std::net::ToSocketAddrs::to_socket_addrs(&(host, 80u16)) {
        Ok(a) => a,
        Err(_) => return false, // unresolvable host
    };
    for addr in addrs {
        let ip = addr.ip();
        if ip.is_loopback() || ip.is_unspecified() { return false; }
        match ip {
            std::net::IpAddr::V4(v4) => {
                if v4.is_private() || v4.is_link_local() { return false; }
                // Cloud metadata: 169.254.169.254 is link_local, but also
                // catch decimal-encoded variants via the private/loopback checks above.
            }
            std::net::IpAddr::V6(v6) => {
                if v6.is_loopback() { return false; }
                // IPv6-mapped IPv4 (::ffff:a9fe:a9fe = 169.254.169.254)
                if let Some(v4) = v6.to_ipv4_mapped() {
                    if v4.is_private() || v4.is_link_local() || v4.is_loopback() { return false; }
                }
            }
        }
    }
    true
}

static WEBHOOK_SECRET_WARNED: std::sync::OnceLock<()> = std::sync::OnceLock::new();

pub async fn deliver(url: &str, payload: &str) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let secret = std::env::var("THEFLATE_WEBHOOK_SECRET").ok();
    let sig = match &secret {
        Some(s) if !s.is_empty() => Some(sign::signature(s, payload, ts)),
        _ => {
            WEBHOOK_SECRET_WARNED.get_or_init(|| {
                tracing::warn!("THEFLATE_WEBHOOK_SECRET not set — webhooks delivered unsigned");
            });
            None
        }
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none()) // no redirect following (H3)
        .build()
        .unwrap_or_default();

    for attempt in 0..3u32 {
        let mut req = client.post(url)
            .header("content-type", "application/json")
            .header("x-theflate-event", "job.done")
            .body(payload.to_string());
        if let Some(ref s) = sig {
            req = req.header("x-theflate-signature", s);
        }
        match req.send().await {
            Ok(r) if r.status().is_success() => {
                tracing::info!("webhook delivered to {url} on attempt {attempt}");
                return;
            }
            // Don't retry client errors — they will never succeed.
            Ok(r) if r.status().is_client_error() && r.status().as_u16() != 429 => {
                tracing::warn!("webhook {url} returned {} (not retrying)", r.status());
                return;
            }
            Ok(r) => tracing::warn!("webhook {url} returned {}", r.status()),
            Err(e) => tracing::warn!("webhook {url} failed: {e}"),
        }
        tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;
    }
    tracing::error!("webhook {url} failed after 3 attempts");
}
