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
}
