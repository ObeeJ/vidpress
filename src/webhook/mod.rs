pub mod sign;

use std::time::Duration;

/// Returns true only for http/https URLs that resolve to public IP addresses.
/// String prefix matching cannot be made correct - decimal-encoded IPs,
/// octal, IPv6-mapped addresses, and userinfo confusion all defeat it.
/// DNS resolution defeats all of them at once. (H3, H4)
pub fn is_public_url(url: &str) -> bool {
    let url = url.trim();
    // Only http/https - reject file:, gopher:, etc.
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return false;
    }
    let after = match url.splitn(2, "://").nth(1) {
        Some(s) => s,
        None => return false,
    };
    // Strip userinfo (user@host) - a common bypass vector.
    let after = match after.splitn(2, '@').last() {
        Some(s) => s,
        None => return false,
    };
    let host_port = after.splitn(2, '/').next().unwrap_or("");
    let host = if host_port.starts_with('[') {
        // IPv6 literal
        host_port.splitn(2, ']').next().unwrap_or("").trim_start_matches('[')
    } else {
        host_port.splitn(2, ':').next().unwrap_or(host_port)
    };

    if host.is_empty() { return false; }

    // Resolve via DNS and reject any private/loopback/link-local address.
    use std::net::ToSocketAddrs;
    let addrs = match format!("{host}:80").to_socket_addrs() {
        Ok(a) => a,
        Err(_) => return false,
    };
    for addr in addrs {
        let ip = addr.ip();
        if ip.is_loopback() || ip.is_unspecified() {
            return false;
        }
        match ip {
            std::net::IpAddr::V4(v4) => {
                if v4.is_private() || v4.is_link_local() || v4.is_broadcast()
                    || v4.is_documentation() || v4.is_multicast()
                {
                    return false;
                }
            }
            std::net::IpAddr::V6(v6) => {
                if v6.is_multicast() {
                    return false;
                }
                // IPv6-mapped IPv4 (::ffff:a.b.c.d)
                if let Some(v4) = v6.to_ipv4_mapped() {
                    if v4.is_private() || v4.is_link_local() || v4.is_loopback() {
                        return false;
                    }
                }
            }
        }
    }
    true
}

pub async fn deliver(url: &str, payload: &str) {
    let secret = std::env::var("THEFLATE_WEBHOOK_SECRET").ok();
    if secret.is_none() {
        tracing::warn!("THEFLATE_WEBHOOK_SECRET not set; delivering webhook unsigned");
    }

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())  // no redirect following (H3)
        .build()
        .unwrap_or_default();

    for attempt in 0..3u32 {
        let mut req = client.post(url)
            .header("content-type", "application/json")
            .header("x-theflate-event", "job.done");

        if let Some(ref s) = secret {
            req = req.header("x-theflate-signature", sign::signature(s, payload, ts));
        }

        match req.body(payload.to_string()).send().await {
            Ok(r) if r.status().is_success() => {
                tracing::info!("webhook delivered to {url} on attempt {attempt}");
                return;
            }
            // Client errors (4xx) will never succeed - don't retry.
            Ok(r) if r.status().is_client_error() => {
                tracing::warn!("webhook {url} returned {} (client error, not retrying)", r.status());
                return;
            }
            Ok(r) => tracing::warn!("webhook {url} returned {}", r.status()),
            Err(e) => tracing::warn!("webhook {url} failed: {e}"),
        }
        tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;
    }
    tracing::error!("webhook {url} failed after 3 attempts");
}
