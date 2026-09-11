//! Proves the codec/container table against the real ffmpeg muxers.
//!
//! The unit tests in `codec_compat` check the table against itself, which
//! cannot catch the failure that actually happened: the table asserting a
//! pairing that ffmpeg then rejects. The original bug was exactly that shape -
//! libx265 paired with a `.webm` output looked fine in Rust and only died when
//! the WebM muxer wrote its header, minutes into a two-pass encode.
//!
//! So every combination the API is willing to advertise is encoded here for
//! real. If a pairing cannot be muxed, this fails in seconds instead of
//! surfacing as a user's job stuck at 0%.
//!
//! Requires ffmpeg on PATH; skipped when absent so the suite stays green on
//! machines without it.

use std::path::PathBuf;
use std::process::Command;

use theflate::media::codec_compat::{codecs_for, resolve};

fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Whether this ffmpeg build actually has the encoder. A missing encoder is a
/// property of the local build, not a bug in the table, so those cases are
/// reported and skipped rather than failed.
fn encoder_available(name: &str) -> bool {
    Command::new("ffmpeg")
        .args(["-hide_banner", "-encoders"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(name))
        .unwrap_or(false)
}

fn temp_path(name: &str) -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("theflate_muxtest_{}_{}", std::process::id(), name));
    p
}

/// Encode one second of synthetic audio+video with the given choice and report
/// ffmpeg's stderr on failure. Audio matters: AAC-in-WebM was half the
/// original bug, so a video-only probe would have missed it.
fn try_encode(ext: &str, codec_id: &str) -> Result<(), String> {
    let choice = resolve(ext, Some(codec_id)).choice();
    let out = temp_path(&format!("{codec_id}.{ext}"));
    let _ = std::fs::remove_file(&out);

    let mut args: Vec<String> = vec![
        "-y".into(),
        "-f".into(), "lavfi".into(),
        "-i".into(), "testsrc=size=128x128:rate=15:duration=1".into(),
        "-f".into(), "lavfi".into(),
        "-i".into(), "sine=frequency=440:duration=1".into(),
        "-c:v".into(), choice.video.into(),
    ];
    args.extend(choice.preset_args());
    args.extend([
        "-b:v".into(), "200k".into(),
        "-c:a".into(), choice.audio.into(),
        "-b:a".into(), "64k".into(),
    ]);
    if choice.faststart {
        args.extend(["-movflags".into(), "+faststart".into()]);
    }
    args.push(out.to_string_lossy().into_owned());

    let result = Command::new("ffmpeg").args(&args).output();
    let cleanup = || {
        let _ = std::fs::remove_file(&out);
    };

    match result {
        Err(e) => {
            cleanup();
            Err(format!("could not spawn ffmpeg: {e}"))
        }
        Ok(o) if !o.status.success() => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            let tail: Vec<&str> = stderr.lines().rev().take(6).collect();
            cleanup();
            Err(format!(
                "{codec_id} in .{ext} ({} + {}) failed to mux:\n  {}",
                choice.video,
                choice.audio,
                tail.into_iter().rev().collect::<Vec<_>>().join("\n  ")
            ))
        }
        Ok(_) => {
            // A zero exit with an empty file would still be a broken pairing.
            let ok = std::fs::metadata(&out).map(|m| m.len() > 0).unwrap_or(false);
            cleanup();
            if ok {
                Ok(())
            } else {
                Err(format!("{codec_id} in .{ext} produced an empty file"))
            }
        }
    }
}

/// Every advertised pairing must survive a real mux.
#[test]
fn every_advertised_pairing_actually_muxes() {
    if !ffmpeg_available() {
        eprintln!("skipping: ffmpeg not on PATH");
        return;
    }

    let mut failures = Vec::new();
    let mut tested = 0;
    let mut skipped = Vec::new();

    for ext in ["mp4", "webm", "mkv", "avi", "mov"] {
        for choice in codecs_for(ext) {
            if !encoder_available(choice.video) {
                skipped.push(format!("{}/{}", ext, choice.video));
                continue;
            }
            tested += 1;
            if let Err(e) = try_encode(ext, choice.id) {
                failures.push(e);
            }
        }
    }

    if !skipped.is_empty() {
        eprintln!("encoders unavailable in this ffmpeg build: {skipped:?}");
    }
    assert!(
        failures.is_empty(),
        "{} of {tested} advertised pairings cannot be muxed:\n{}",
        failures.len(),
        failures.join("\n")
    );
    assert!(tested > 0, "no pairings were exercised at all");
}

/// The specific regression. HEVC into WebM must never be selected, and
/// whatever is selected instead must genuinely work.
#[test]
fn hevc_request_on_webm_resolves_to_something_that_muxes() {
    if !ffmpeg_available() {
        eprintln!("skipping: ffmpeg not on PATH");
        return;
    }

    let choice = resolve("webm", Some("h265")).choice();
    assert_ne!(
        choice.video, "libx265",
        "h265 must not be selected for a webm container"
    );

    if !encoder_available(choice.video) {
        eprintln!("skipping encode: {} unavailable", choice.video);
        return;
    }
    if let Err(e) = try_encode("webm", choice.id) {
        panic!("the webm substitute is itself broken: {e}");
    }
}

/// Confirms the bug is real rather than theoretical: the pairing the old code
/// produced must genuinely fail, otherwise these guards protect nothing.
#[test]
fn hevc_in_webm_really_is_rejected_by_ffmpeg() {
    if !ffmpeg_available() || !encoder_available("libx265") {
        eprintln!("skipping: ffmpeg or libx265 unavailable");
        return;
    }

    let out = temp_path("forced_hevc.webm");
    let _ = std::fs::remove_file(&out);
    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-f", "lavfi",
            "-i", "testsrc=size=128x128:rate=15:duration=1",
            "-c:v", "libx265",
            "-preset", "ultrafast",
        ])
        .arg(&out)
        .output();
    let _ = std::fs::remove_file(&out);

    match status {
        Ok(o) => assert!(
            !o.status.success(),
            "ffmpeg accepted HEVC in WebM; the compatibility table may now be \
             unnecessary, or this ffmpeg build behaves differently"
        ),
        Err(e) => eprintln!("skipping: {e}"),
    }
}
