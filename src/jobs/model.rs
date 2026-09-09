use serde::{Deserialize, Serialize};
use crate::media::detect::MediaKind;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DestinationConfig {
    pub provider:     String,
    pub bucket:       Option<String>,
    pub endpoint:     Option<String>,
    pub region:       Option<String>,
    pub access_key:   Option<String>,
    pub secret_key:   Option<String>,
    pub access_token: Option<String>,
    pub target_path:  Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus { Queued, Processing, Done, Failed }

#[derive(Debug, Clone, Serialize)]
pub struct Job {
    pub id:               String,
    pub status:           JobStatus,
    pub media_kind:       MediaKind,
    pub input_path:       String,
    pub output_path:      String,
    pub original_bytes:   u64,
    pub compressed_bytes: u64,
    pub duration_secs:    f64,
    pub progress:         u8,
    pub eta_secs:         u64,
    pub webhook_url:      Option<String>,
    pub preset:           Option<String>,
    pub destination:      Option<DestinationConfig>,
    pub remote_url:       Option<String>,
    pub owner_key:        Option<String>,
}

/// What a caller is allowed to see. `Job` itself must never reach the wire:
/// it carries `destination` (S3 secret keys) and `input_path` / `output_path`
/// (absolute server paths). Both are stripped here.
#[derive(Debug, Clone, Serialize)]
pub struct PublicJob<'a> {
    pub id:               &'a str,
    pub status:           &'a JobStatus,
    pub media_kind:       &'a MediaKind,
    pub original_bytes:   u64,
    pub compressed_bytes: u64,
    pub duration_secs:    f64,
    pub progress:         u8,
    pub eta_secs:         u64,
    pub preset:           Option<&'a str>,
    pub remote_url:       Option<&'a str>,
    pub has_destination:  bool,
}

impl Job {
    pub fn public(&self) -> PublicJob<'_> {
        PublicJob {
            id:               &self.id,
            status:           &self.status,
            media_kind:       &self.media_kind,
            original_bytes:   self.original_bytes,
            compressed_bytes: self.compressed_bytes,
            duration_secs:    self.duration_secs,
            progress:         self.progress,
            eta_secs:         self.eta_secs,
            preset:           self.preset.as_deref(),
            remote_url:       self.remote_url.as_deref(),
            has_destination:  self.destination.is_some(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::detect::MediaKind;

    fn job_with_secrets() -> Job {
        Job {
            id: "job-1".into(),
            status: JobStatus::Done,
            media_kind: MediaKind::Video,
            input_path: "/srv/theflate/in/secret-name.mp4".into(),
            output_path: "/srv/theflate/out/job-1_output.mp4".into(),
            original_bytes: 100,
            compressed_bytes: 40,
            duration_secs: 12.0,
            progress: 100,
            eta_secs: 0,
            webhook_url: Some("https://customer.example/hook".into()),
            preset: Some("web".into()),
            destination: Some(DestinationConfig {
                provider: "s3".into(),
                bucket: Some("example-bucket".into()),
                endpoint: Some("s3.amazonaws.com".into()),
                region: Some("us-east-1".into()),
                access_key: Some("AKIAEXAMPLE".into()),
                secret_key: Some("SUPER-SECRET-VALUE".into()),
                access_token: Some("TOKEN-VALUE".into()),
                target_path: Some("out/clip.mp4".into()),
            }),
            remote_url: None,
            owner_key: None,
        }
    }

    #[test]
    fn public_view_omits_credentials_and_paths() {
        let wire = serde_json::to_string(&job_with_secrets().public()).unwrap();
        for leaked in [
            "SUPER-SECRET-VALUE",
            "AKIAEXAMPLE",
            "TOKEN-VALUE",
            "example-bucket",
            "/srv/theflate",
            "customer.example",
        ] {
            assert!(!wire.contains(leaked), "PublicJob leaked {leaked}: {wire}");
        }
    }

    #[test]
    fn public_view_keeps_progress_fields_clients_need() {
        let job = job_with_secrets();
        let wire = serde_json::to_string(&job.public()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&wire).unwrap();
        assert_eq!(v["id"], "job-1");
        assert_eq!(v["status"], "done");
        assert_eq!(v["progress"], 100);
        assert_eq!(v["compressed_bytes"], 40);
        assert_eq!(v["has_destination"], true);
    }

    #[test]
    fn full_job_still_round_trips_credentials_for_persistence() {
        let job = job_with_secrets();
        let stored = serde_json::to_string(job.destination.as_ref().unwrap()).unwrap();
        assert!(stored.contains("SUPER-SECRET-VALUE"));
        let back: DestinationConfig = serde_json::from_str(&stored).unwrap();
        assert_eq!(back.secret_key.as_deref(), Some("SUPER-SECRET-VALUE"));
    }
}
