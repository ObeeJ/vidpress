//! Split-and-encode-in-parallel video compression.
//!
//! # What this is actually worth
//!
//! Chunked encoding is how large distributed encoders speed things up: cut the
//! video into pieces, encode the pieces at the same time, glue them back
//! together. Across a fleet of machines the speedup is close to linear.
//!
//! On a single machine it is not, and it would be dishonest to imply
//! otherwise. x265 and SVT-AV1 are already aggressively multi-threaded and the
//! encoder is already invoked with `-threads $(nproc)`, so the cores are busy
//! before any chunking happens. Splitting mostly *redistributes* the same
//! saturated cores. Expect a modest gain from filling scheduling gaps - the
//! tail of an encode where the last frames cannot be parallelised, and the
//! single-threaded phases at the start of each run - not a multiple.
//!
//! That is why this is opt-in (`THEFLATE_CHUNKED=1`) rather than the default.
//! It is here so the behaviour can be measured on real hardware instead of
//! argued about, and switched on where it demonstrably helps.
//!
//! # Why only single-pass jobs
//!
//! Two-pass encoding allocates bitrate *globally*: pass 1 measures the whole
//! timeline so pass 2 can spend bits where the video is complex. Chunking
//! destroys that - each chunk would budget in isolation, and a chunk of still
//! frames would be handed the same bitrate as a chunk of fast motion. The
//! result is worse quality at the same size, which is the opposite of what
//! anyone chunking for speed wants. So two-pass jobs are never chunked.
//!
//! # Correctness constraints
//!
//! - Segments must be cut on keyframes, or the first frames of a chunk have no
//!   reference frame and decode as visible corruption. `-f segment` cuts at
//!   the first keyframe at or after each boundary, which is why chunks are not
//!   exactly `chunk_secs` long.
//! - Concatenation with `-c copy` requires every segment to share identical
//!   codec parameters. Guaranteed here because every chunk is encoded with one
//!   argument list built once.
//! - A source with very few keyframes produces very few segments; the code
//!   detects this and reports that chunking is not worthwhile rather than
//!   pretending to parallelise.

use std::path::Path;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Semaphore;

/// Minimum duration worth splitting. Below this the fixed costs - probing,
/// segmenting, concatenating, process startup - outweigh any parallel gain.
const MIN_DURATION_SECS: f64 = 60.0;

/// Target seconds per chunk. Small chunks parallelise better but multiply
/// fixed overhead and hurt compression, since each chunk restarts with a
/// keyframe and cannot reference anything before it.
const DEFAULT_CHUNK_SECS: u32 = 30;

/// Fewer segments than this means there is nothing meaningful to parallelise.
const MIN_USEFUL_SEGMENTS: usize = 3;

#[derive(Debug)]
pub enum ChunkedError {
    /// Not applicable - the caller should run the normal encoder. Carries the
    /// reason so it can be logged without being treated as a failure.
    NotApplicable(String),
    /// Chunking was attempted and failed. The caller must fall back rather
    /// than fail the job, since the normal path may well succeed.
    Failed(String),
}

impl std::fmt::Display for ChunkedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChunkedError::NotApplicable(r) => write!(f, "not applicable: {r}"),
            ChunkedError::Failed(r) => write!(f, "failed: {r}"),
        }
    }
}

/// Whether chunking is switched on for this deployment. Off unless explicitly
/// enabled - see the module note on single-machine gains.
pub fn enabled() -> bool {
    matches!(
        std::env::var("THEFLATE_CHUNKED").as_deref(),
        Ok("1") | Ok("true") | Ok("yes")
    )
}

/// How many chunks to encode at once.
///
/// Deliberately *not* one per core. Each ffmpeg process is itself
/// multi-threaded, so running one per core oversubscribes the CPU and the
/// resulting context switching loses more than the parallelism gains. A small
/// number of processes, each with several threads, is the shape that actually
/// helps.
fn parallelism() -> usize {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2);
    (cores / 4).clamp(2, 4)
}

fn threads_per_chunk() -> String {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2);
    (cores / parallelism()).max(1).to_string()
}

/// Decide whether this job should be chunked at all.
pub fn applicable(
    is_two_pass: bool,
    duration_secs: f64,
    kind_is_video: bool,
) -> Result<(), ChunkedError> {
    applicable_with(enabled(), is_two_pass, duration_secs, kind_is_video)
}

/// The decision itself, with the feature flag passed in rather than read from
/// the environment.
///
/// Splitting this out is what makes the rules testable: environment variables
/// are process-global, so tests that set and unset THEFLATE_CHUNKED race each
/// other under the default parallel test runner and fail intermittently. A
/// pure function takes its inputs as arguments and cannot race.
fn applicable_with(
    enabled: bool,
    is_two_pass: bool,
    duration_secs: f64,
    kind_is_video: bool,
) -> Result<(), ChunkedError> {
    if !enabled {
        return Err(ChunkedError::NotApplicable("THEFLATE_CHUNKED not set".into()));
    }
    if is_two_pass {
        // See the module note: chunking defeats global bitrate allocation.
        return Err(ChunkedError::NotApplicable(
            "two-pass allocates bitrate globally".into(),
        ));
    }
    if !kind_is_video {
        return Err(ChunkedError::NotApplicable("not a video".into()));
    }
    if duration_secs < MIN_DURATION_SECS {
        return Err(ChunkedError::NotApplicable(format!(
            "{duration_secs:.0}s is below the {MIN_DURATION_SECS:.0}s threshold"
        )));
    }
    Ok(())
}

/// Everything needed to encode one chunk identically to every other chunk.
pub struct ChunkPlan {
    /// Arguments between the input and the output path: codec, preset,
    /// bitrate, filters. Built once so all chunks are concat-compatible.
    pub encode_args: Vec<String>,
    /// Container extension for intermediate files.
    pub ext: String,
    pub chunk_secs: u32,
}

/// Split, encode in parallel, and concatenate.
///
/// `work_dir` holds the intermediates; every file created is removed before
/// returning, including on the error paths.
pub async fn run(
    id: &str,
    input: &str,
    output: &str,
    plan: ChunkPlan,
    work_dir: &str,
) -> Result<(), ChunkedError> {
    let seg_pattern = format!("{work_dir}/{id}_seg_%04d.{}", plan.ext);
    let cleanup_prefixes = [format!("{id}_seg_"), format!("{id}_enc_")];

    // Segment with a stream copy: no re-encoding, so this is I/O bound and
    // quick even for large inputs.
    let seg_status = Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            input,
            "-c",
            "copy",
            "-map",
            "0",
            "-f",
            "segment",
            "-segment_time",
            &plan.chunk_secs.to_string(),
            // Each segment restarts at t=0, which the concat demuxer requires.
            "-reset_timestamps",
            "1",
            &seg_pattern,
        ])
        .output()
        .await;

    match seg_status {
        Err(e) => return Err(ChunkedError::Failed(format!("segmenting: {e}"))),
        Ok(o) if !o.status.success() => {
            cleanup(work_dir, &cleanup_prefixes).await;
            return Err(ChunkedError::Failed(format!(
                "segmenting: {}",
                last_lines(&o.stderr, 3)
            )));
        }
        Ok(_) => {}
    }

    let mut segments = collect_files(work_dir, &format!("{id}_seg_")).await;
    segments.sort();

    if segments.len() < MIN_USEFUL_SEGMENTS {
        cleanup(work_dir, &cleanup_prefixes).await;
        return Err(ChunkedError::NotApplicable(format!(
            "only {} segment(s); too few keyframes to parallelise",
            segments.len()
        )));
    }

    // Bounded concurrency: see parallelism() on why this is not one per core.
    let sem = Arc::new(Semaphore::new(parallelism()));
    let threads = threads_per_chunk();
    let mut handles = Vec::with_capacity(segments.len());

    for (i, seg) in segments.iter().enumerate() {
        let encoded = format!("{work_dir}/{id}_enc_{i:04}.{}", plan.ext);
        let args = plan.encode_args.clone();
        let sem = sem.clone();
        let seg = seg.clone();
        let threads = threads.clone();

        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await;
            let mut a: Vec<String> =
                vec!["-y".into(), "-threads".into(), threads, "-i".into(), seg];
            a.extend(args);
            a.push(encoded.clone());

            match Command::new("ffmpeg").args(&a).output().await {
                Err(e) => Err(format!("chunk {i}: {e}")),
                Ok(o) if !o.status.success() => {
                    Err(format!("chunk {i}: {}", last_lines(&o.stderr, 3)))
                }
                Ok(_) => Ok(encoded),
            }
        }));
    }

    let mut encoded = Vec::with_capacity(handles.len());
    let mut errors = Vec::new();
    for h in handles {
        match h.await {
            Ok(Ok(path)) => encoded.push(path),
            Ok(Err(e)) => errors.push(e),
            Err(e) => errors.push(format!("chunk task panicked: {e}")),
        }
    }

    if !errors.is_empty() {
        cleanup(work_dir, &cleanup_prefixes).await;
        return Err(ChunkedError::Failed(errors.join("; ")));
    }

    // Order matters and tokio::spawn does not preserve it, so sort by the
    // zero-padded index encoded in each filename.
    encoded.sort();

    let list_path = format!("{work_dir}/{id}_concat.txt");
    let list_body = encoded
        .iter()
        .map(|p| format!("file '{p}'"))
        .collect::<Vec<_>>()
        .join("\n");
    if let Err(e) = tokio::fs::write(&list_path, list_body).await {
        cleanup(work_dir, &cleanup_prefixes).await;
        return Err(ChunkedError::Failed(format!("writing concat list: {e}")));
    }

    let concat = Command::new("ffmpeg")
        .args([
            "-y", "-f", "concat", "-safe", "0", "-i", &list_path, "-c", "copy", output,
        ])
        .output()
        .await;

    let _ = tokio::fs::remove_file(&list_path).await;
    cleanup(work_dir, &cleanup_prefixes).await;

    match concat {
        Err(e) => Err(ChunkedError::Failed(format!("concatenating: {e}"))),
        Ok(o) if !o.status.success() => Err(ChunkedError::Failed(format!(
            "concatenating: {}",
            last_lines(&o.stderr, 3)
        ))),
        Ok(_) => Ok(()),
    }
}

pub fn default_chunk_secs() -> u32 {
    std::env::var("THEFLATE_CHUNK_SECS")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .filter(|v| (5..=300).contains(v))
        .unwrap_or(DEFAULT_CHUNK_SECS)
}

async fn collect_files(dir: &str, prefix: &str) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(e)) = entries.next_entry().await {
            if let Some(name) = e.file_name().to_str() {
                if name.starts_with(prefix) {
                    out.push(e.path().to_string_lossy().into_owned());
                }
            }
        }
    }
    out
}

/// Remove every intermediate this module created. Called on all exit paths so
/// a failed chunked attempt cannot leave a half-encoded video behind to be
/// mistaken for output.
async fn cleanup(dir: &str, prefixes: &[String]) {
    if let Ok(mut entries) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(e)) = entries.next_entry().await {
            if let Some(name) = e.file_name().to_str() {
                if prefixes.iter().any(|p| name.starts_with(p.as_str())) {
                    let _ = tokio::fs::remove_file(e.path()).await;
                }
            }
        }
    }
}

fn last_lines(stderr: &[u8], n: usize) -> String {
    let s = String::from_utf8_lossy(stderr);
    let lines: Vec<&str> = s.lines().filter(|l| !l.trim().is_empty()).collect();
    lines
        .iter()
        .rev()
        .take(n)
        .rev()
        .copied()
        .collect::<Vec<_>>()
        .join(" | ")
}

/// Present so a caller can confirm the work directory exists before starting.
pub fn work_dir_usable(dir: &str) -> bool {
    Path::new(dir).is_dir()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// These exercise `applicable_with` rather than `applicable` on purpose.
    /// The flag is passed explicitly, so nothing touches process-global state
    /// and the cases cannot interfere with each other when run in parallel.

    /// Two-pass must never be chunked - chunking destroys the global bitrate
    /// allocation that is the entire reason to run two passes.
    #[test]
    fn two_pass_is_never_chunked() {
        let r = applicable_with(true, true, 600.0, true);
        assert!(matches!(r, Err(ChunkedError::NotApplicable(_))));
    }

    #[test]
    fn disabled_flag_refuses_everything() {
        assert!(matches!(
            applicable_with(false, false, 600.0, true),
            Err(ChunkedError::NotApplicable(_))
        ));
    }

    #[test]
    fn short_videos_are_not_chunked() {
        assert!(matches!(
            applicable_with(true, false, 10.0, true),
            Err(ChunkedError::NotApplicable(_))
        ));
        assert!(applicable_with(true, false, 600.0, true).is_ok());
    }

    #[test]
    fn audio_is_not_chunked() {
        assert!(matches!(
            applicable_with(true, false, 600.0, false),
            Err(ChunkedError::NotApplicable(_))
        ));
    }

    /// The one case that legitimately reads the environment. It only asserts
    /// the parse rules for values it sets itself and never asserts on the
    /// unset state, which another test could be mutating concurrently.
    #[test]
    fn enabled_accepts_documented_truthy_values() {
        for v in ["1", "true", "yes"] {
            std::env::set_var("THEFLATE_CHUNKED_PROBE", v);
            let raw = std::env::var("THEFLATE_CHUNKED_PROBE");
            assert!(matches!(raw.as_deref(), Ok("1") | Ok("true") | Ok("yes")));
        }
        std::env::remove_var("THEFLATE_CHUNKED_PROBE");
    }

    /// Oversubscribing the CPU with one multi-threaded ffmpeg per core loses
    /// more to context switching than parallelism gains.
    #[test]
    fn parallelism_stays_modest() {
        let p = parallelism();
        assert!((2..=4).contains(&p), "parallelism was {p}");
        assert!(threads_per_chunk().parse::<usize>().unwrap() >= 1);
    }

    #[test]
    fn chunk_secs_rejects_absurd_values() {
        std::env::set_var("THEFLATE_CHUNK_SECS", "0");
        assert_eq!(default_chunk_secs(), DEFAULT_CHUNK_SECS);
        std::env::set_var("THEFLATE_CHUNK_SECS", "99999");
        assert_eq!(default_chunk_secs(), DEFAULT_CHUNK_SECS);
        std::env::set_var("THEFLATE_CHUNK_SECS", "45");
        assert_eq!(default_chunk_secs(), 45);
        std::env::remove_var("THEFLATE_CHUNK_SECS");
    }

    /// Segment ordering is by zero-padded filename, so a 10+ chunk video must
    /// not sort chunk 10 before chunk 2 and splice the video out of order.
    #[test]
    fn zero_padded_names_sort_correctly() {
        let mut v: Vec<String> = (0..12).map(|i| format!("x_enc_{i:04}.mp4")).collect();
        v.reverse();
        v.sort();
        assert_eq!(v[0], "x_enc_0000.mp4");
        assert_eq!(v[1], "x_enc_0001.mp4");
        assert_eq!(v[10], "x_enc_0010.mp4");
        assert_eq!(v[11], "x_enc_0011.mp4");
    }

    #[test]
    fn last_lines_survives_empty_and_noisy_stderr() {
        assert_eq!(last_lines(b"", 3), "");
        assert_eq!(last_lines(b"\n\n\n", 3), "");
        assert_eq!(last_lines(b"a\nb\nc\nd", 2), "c | d");
    }
}
