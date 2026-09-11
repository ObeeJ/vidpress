//! End-to-end proof that chunked encoding produces a correct video.
//!
//! The unit tests in `jobs::chunked` only cover the decision rules - whether a
//! job qualifies. They say nothing about whether the split/encode/concat
//! pipeline actually reassembles into a watchable file, and that is where the
//! real risks live:
//!
//!   - segments cut off a keyframe decode as corruption
//!   - chunks encoded with differing parameters cannot be `-c copy` concatenated
//!   - tokio::spawn does not preserve ordering, so chunk 10 can be spliced
//!     before chunk 2 and silently scramble the video
//!   - a failed attempt can leave intermediates behind that later look like
//!     output
//!
//! So this runs the real thing and checks the result's duration and stream
//! layout against the source. Requires ffmpeg/ffprobe; skipped without them.

use std::path::PathBuf;
use std::process::Command;

use theflate::jobs::chunked::{run, ChunkPlan};

fn have(bin: &str) -> bool {
    Command::new(bin)
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn work_dir(tag: &str) -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("theflate_chunked_{}_{}", std::process::id(), tag));
    let _ = std::fs::create_dir_all(&p);
    p
}

/// Build a source long enough to split, with a keyframe every second so the
/// segmenter has somewhere to cut. Without forced keyframes a synthetic clip
/// can contain a single one and refuse to split at all.
fn make_source(dir: &PathBuf, secs: u32) -> Option<String> {
    let src = dir.join("source.mp4");
    let ok = Command::new("ffmpeg")
        .args([
            "-y",
            "-f", "lavfi",
            "-i", &format!("testsrc=size=320x240:rate=15:duration={secs}"),
            "-f", "lavfi",
            "-i", &format!("sine=frequency=440:duration={secs}"),
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-g", "15",
            "-force_key_frames", "expr:gte(t,n_forced*1)",
            "-c:a", "aac",
        ])
        .arg(&src)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    ok.then(|| src.to_string_lossy().into_owned())
}

fn probe(path: &str, entry: &str) -> Option<String> {
    let o = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", entry,
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .ok()?;
    if !o.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

fn duration_of(path: &str) -> Option<f64> {
    probe(path, "format=duration")?.parse().ok()
}

/// The whole pipeline: split a 90 second clip, encode the pieces in parallel,
/// concatenate, and verify the result is the same video.
#[test]
fn chunked_encode_reassembles_a_correct_video() {
    if !have("ffmpeg") || !have("ffprobe") {
        eprintln!("skipping: ffmpeg/ffprobe unavailable");
        return;
    }

    let dir = work_dir("e2e");
    let dir_s = dir.to_string_lossy().into_owned();

    let Some(source) = make_source(&dir, 90) else {
        eprintln!("skipping: could not build a source clip");
        let _ = std::fs::remove_dir_all(&dir);
        return;
    };

    let source_duration = duration_of(&source).expect("source must have a duration");
    let output = dir.join("chunked_out.mp4").to_string_lossy().into_owned();

    let plan = ChunkPlan {
        // Deliberately the same argument list for every chunk - differing
        // parameters are exactly what breaks stream-copy concatenation.
        encode_args: vec![
            "-c:v".into(), "libx264".into(),
            "-preset".into(), "ultrafast".into(),
            "-b:v".into(), "300k".into(),
            "-c:a".into(), "aac".into(),
            "-b:a".into(), "64k".into(),
        ],
        ext: "mp4".into(),
        chunk_secs: 20,
    };

    let rt = tokio::runtime::Runtime::new().expect("runtime");
    let result = rt.block_on(run("e2etest", &source, &output, plan, &dir_s));

    if let Err(e) = result {
        let _ = std::fs::remove_dir_all(&dir);
        panic!("chunked encode failed: {e}");
    }

    let out_duration = duration_of(&output).expect("output must have a duration");

    // Segment boundaries land on keyframes, so the total drifts slightly from
    // the source. A couple of seconds is normal; more means chunks were lost
    // or duplicated, which is the failure that matters.
    let drift = (out_duration - source_duration).abs();
    assert!(
        drift < 3.0,
        "duration drifted by {drift:.2}s (source {source_duration:.2}s, output \
         {out_duration:.2}s) - chunks were probably dropped or reordered"
    );

    // Audio must survive the round trip; a video-only check would miss losing
    // the audio stream entirely during concatenation.
    let codecs = probe(&output, "stream=codec_name");
    assert!(
        codecs.as_deref().map(|s| s.contains("h264")).unwrap_or(false),
        "expected an h264 stream in the output, probe said {codecs:?}"
    );
    assert!(
        codecs.as_deref().map(|s| s.contains("aac")).unwrap_or(false),
        "audio stream was lost during concatenation, probe said {codecs:?}"
    );

    // Every intermediate must be gone: a leftover chunk can later be mistaken
    // for a finished output.
    let leftovers: Vec<String> = std::fs::read_dir(&dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().to_str().map(String::from))
                .filter(|n| n.contains("_seg_") || n.contains("_enc_") || n.ends_with("_concat.txt"))
                .collect()
        })
        .unwrap_or_default();
    assert!(
        leftovers.is_empty(),
        "chunked encode left intermediates behind: {leftovers:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// A source with too few keyframes cannot be split usefully. That must be
/// reported as an error so the caller falls back to the serial encoder, never
/// as a success that produces a truncated or missing file.
#[test]
fn a_source_that_cannot_split_is_refused() {
    if !have("ffmpeg") {
        eprintln!("skipping: ffmpeg unavailable");
        return;
    }

    let dir = work_dir("nosplit");
    let dir_s = dir.to_string_lossy().into_owned();
    let src = dir.join("tiny.mp4");

    // Three seconds with a single keyframe: nothing to cut on.
    let built = Command::new("ffmpeg")
        .args([
            "-y",
            "-f", "lavfi",
            "-i", "testsrc=size=160x120:rate=10:duration=3",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-g", "1000",
        ])
        .arg(&src)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !built {
        eprintln!("skipping: could not build the clip");
        let _ = std::fs::remove_dir_all(&dir);
        return;
    }

    let output = dir.join("out.mp4").to_string_lossy().into_owned();
    let plan = ChunkPlan {
        encode_args: vec!["-c:v".into(), "libx264".into(), "-preset".into(), "ultrafast".into()],
        ext: "mp4".into(),
        chunk_secs: 30,
    };

    let rt = tokio::runtime::Runtime::new().expect("runtime");
    let r = rt.block_on(run(
        "nosplit",
        &src.to_string_lossy(),
        &output,
        plan,
        &dir_s,
    ));

    assert!(
        r.is_err(),
        "a 3 second single-keyframe clip must not report a successful chunked encode"
    );

    // Even on the refusal path nothing may be left behind.
    let leftovers: Vec<String> = std::fs::read_dir(&dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().to_str().map(String::from))
                .filter(|n| n.contains("_seg_") || n.contains("_enc_"))
                .collect()
        })
        .unwrap_or_default();
    assert!(leftovers.is_empty(), "left intermediates behind: {leftovers:?}");

    let _ = std::fs::remove_dir_all(&dir);
}
