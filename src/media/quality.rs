//! Predicting what a target file size will actually look like.
//!
//! Target-size compression is arithmetic: a size and a duration fix the
//! bitrate, and the bitrate fixes the quality. Nothing downstream - codec
//! choice, encoder preset, more CPU - can rescue a target that is simply too
//! small. Asking for 3 MB from a ten minute video means asking for roughly
//! 41 kbps of video, and no encoder in existence makes that look good.
//!
//! The encoder's previous behaviour was to accept any target and quietly
//! downscale until the bitrate fit, clamping at 144 lines of resolution. That
//! is why a 200 MB source could come back looking worse than 3gp: it was
//! encoded at 144p and nobody was told.
//!
//! This module makes that prediction explicit and available *before* the job
//! runs, so the choice belongs to the user rather than to a silent clamp.

/// Bits per pixel per frame - the standard way to judge whether a bitrate
/// suits a resolution, since a bitrate that is generous at 480p is starvation
/// at 4K.
///
/// The thresholds are deliberately conservative and describe the *source*
/// resolution. Falling below one does not mean failure; it means the encoder
/// must downscale to stay watchable, which is itself a quality loss worth
/// reporting.
/// Calibrated for the modern codecs this encoder actually uses (x265, AV1,
/// VP9), not for H.264. The distinction matters: 2.6 Mbps at 1080p30 is
/// roughly 0.04 bpp, which is thin for H.264 but genuinely good for HEVC, and
/// an H.264-era threshold table wrongly condemns it. Streaming services ship
/// 1080p HEVC in the 2-3 Mbps range.
const BPP_GOOD: f64 = 0.04;
const BPP_ACCEPTABLE: f64 = 0.02;
const BPP_POOR: f64 = 0.01;

/// The bits-per-pixel floor the *encoder* enforces before it starts
/// downscaling. This must stay equal to `MIN_BITS_PER_PIXEL` in
/// `jobs::compress`, since this module's job is to predict what that code will
/// really do - a mismatch would make the estimate a lie.
pub const ENCODER_MIN_BPP: f64 = 0.02;

/// The encoder will not downscale below this many lines; past here, quality
/// collapses rather than degrading.
const MIN_HEIGHT: u32 = 144;

/// Audio reserved from the total budget, matching the encoder's `-b:a 128k`.
const AUDIO_KBPS: f64 = 128.0;

/// Frame rate assumed when the probe did not report one. Real rates are
/// carried through when known - this only keeps the estimate defined.
pub const ASSUMED_FPS: f64 = 30.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum QualityTier {
    /// Visually close to the source at its native resolution.
    Good,
    /// Softer, but a reasonable trade for the size.
    Acceptable,
    /// Noticeably degraded; the encoder must downscale to cope.
    Poor,
    /// Below any useful threshold - blocky, heavily downscaled, and not worth
    /// the CPU time to produce.
    Unusable,
}

impl QualityTier {
    /// Whether a job at this tier should be refused unless explicitly forced.
    /// Only `Unusable` blocks: `Poor` is a legitimate choice when someone
    /// genuinely needs to hit a hard size limit and accepts the cost.
    pub fn should_block(self) -> bool {
        matches!(self, QualityTier::Unusable)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct QualityEstimate {
    /// Video bitrate after reserving audio, in kbps.
    pub video_kbps: u64,
    /// Bits per pixel at the *source* resolution.
    pub bits_per_pixel: f64,
    /// Height the encoder will downscale to, or the source height when no
    /// downscale is needed.
    pub output_height: u32,
    /// Source height, for comparison against `output_height`.
    pub source_height: u32,
    pub tier: QualityTier,
    /// Smallest target in MB that still reaches `Acceptable` at source
    /// resolution - the number to show someone who asked for too little.
    pub min_recommended_mb: f64,
    /// Plain-language explanation when quality will suffer.
    pub warning: Option<String>,
}

/// Predict the outcome of encoding to `target_mb`.
///
/// `width`/`height` are the source dimensions; when the probe could not
/// determine them the estimate falls back to bitrate-only reasoning and
/// reports the source height as 0.
pub fn estimate(
    target_mb: f64,
    duration_secs: f64,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<f64>,
) -> QualityEstimate {
    let duration = duration_secs.max(1.0);
    let fps = fps.filter(|f| *f > 0.0).unwrap_or(ASSUMED_FPS);

    // Mirrors the encoder: total budget minus the audio allocation, floored so
    // a tiny target cannot produce a zero or negative video bitrate.
    let total_kbps = (target_mb * 8.0 * 1024.0) / duration;
    let video_kbps = (total_kbps - AUDIO_KBPS).max(100.0);

    let (w, h) = match (width, height) {
        (Some(w), Some(h)) if w > 0 && h > 0 => (w, h),
        // Without dimensions there is no bits-per-pixel to compute. Report the
        // bitrate and stay silent rather than inventing a resolution.
        _ => {
            return QualityEstimate {
                video_kbps: video_kbps as u64,
                bits_per_pixel: 0.0,
                output_height: 0,
                source_height: 0,
                tier: QualityTier::Acceptable,
                min_recommended_mb: 0.0,
                warning: None,
            };
        }
    };

    let pixels = w as f64 * h as f64;
    let bits_per_pixel = (video_kbps * 1000.0) / (pixels * fps);

    // The encoder downscales until bits-per-pixel reaches the POOR floor.
    // Predicting the same height here keeps this estimate honest about what
    // will actually be produced.
    let output_height = if bits_per_pixel < ENCODER_MIN_BPP {
        let scale_factor = (bits_per_pixel / ENCODER_MIN_BPP).sqrt();
        (((h as f64 * scale_factor) as u32).max(MIN_HEIGHT)).min(h)
    } else {
        h
    };

    // Bitrate needed for ACCEPTABLE at full resolution, converted back to MB
    // and including the audio allocation the user also has to pay for.
    let needed_kbps = BPP_ACCEPTABLE * pixels * fps / 1000.0;
    let min_recommended_mb = ((needed_kbps + AUDIO_KBPS) * duration) / (8.0 * 1024.0);

    let tier = if bits_per_pixel >= BPP_GOOD {
        QualityTier::Good
    } else if bits_per_pixel >= BPP_ACCEPTABLE {
        QualityTier::Acceptable
    } else if bits_per_pixel >= BPP_POOR {
        QualityTier::Poor
    } else {
        QualityTier::Unusable
    };

    let warning = match tier {
        QualityTier::Good | QualityTier::Acceptable => None,
        QualityTier::Poor => Some(format!(
            "{target_mb:.0} MB gives about {video_kbps:.0} kbps, which is low for \
             {w}x{h}. The video will be downscaled to about {output_height}p and \
             will look noticeably soft. Around {min_recommended_mb:.0} MB would \
             keep it sharp."
        )),
        QualityTier::Unusable => Some(format!(
            "{target_mb:.0} MB for a {duration:.0} second {w}x{h} video is about \
             {video_kbps:.0} kbps. That forces a downscale to roughly \
             {output_height}p and the result will be blocky and hard to watch. \
             Around {min_recommended_mb:.0} MB is the realistic minimum for this \
             video."
        )),
    };

    QualityEstimate {
        video_kbps: video_kbps as u64,
        bits_per_pixel,
        output_height,
        source_height: h,
        tier,
        min_recommended_mb,
        warning,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The reported complaint: 200 MB compressed to 3 MB came back "worse than
    /// 3gp". This must be classified Unusable and must warn, rather than
    /// silently producing 144p.
    #[test]
    fn three_mb_from_a_ten_minute_1080p_video_is_unusable() {
        let e = estimate(3.0, 600.0, Some(1920), Some(1080), Some(30.0));
        assert_eq!(e.tier, QualityTier::Unusable);
        assert!(e.tier.should_block());
        assert!(e.warning.is_some());
        // Assert the relationship, not a hand-picked number: the point is that
        // the source is downscaled drastically, which is what makes the result
        // look worse than 3gp. (It lands near 306p, well under half of 1080.)
        assert!(
            e.output_height < e.source_height / 2,
            "expected a drastic downscale from {}p, got {}p",
            e.source_height,
            e.output_height
        );
        // The recommendation must be meaningfully larger than the ask, or it
        // is not useful advice.
        assert!(e.min_recommended_mb > 3.0);
    }

    #[test]
    fn a_generous_target_is_good_and_silent() {
        let e = estimate(200.0, 600.0, Some(1920), Some(1080), Some(30.0));
        assert_eq!(e.tier, QualityTier::Good);
        assert!(e.warning.is_none());
        assert!(!e.tier.should_block());
        // No downscale when the bitrate is sufficient.
        assert_eq!(e.output_height, 1080);
    }

    /// Identical bitrate, different resolution: bits-per-pixel, not raw
    /// bitrate, decides quality. 2 Mbps is comfortable at 480p and thin at 4K.
    #[test]
    fn the_same_bitrate_judges_differently_by_resolution() {
        let small = estimate(15.0, 60.0, Some(854), Some(480), Some(30.0));
        let large = estimate(15.0, 60.0, Some(3840), Some(2160), Some(30.0));
        assert!(small.bits_per_pixel > large.bits_per_pixel);
        assert!(small.video_kbps.abs_diff(large.video_kbps) <= 1);
        assert!(matches!(
            small.tier,
            QualityTier::Good | QualityTier::Acceptable
        ));
        assert!(matches!(
            large.tier,
            QualityTier::Poor | QualityTier::Unusable
        ));
    }

    /// A higher frame rate spreads the same bitrate across more frames and so
    /// must lower the quality estimate.
    #[test]
    fn higher_fps_lowers_quality_for_a_fixed_budget() {
        let at30 = estimate(20.0, 60.0, Some(1920), Some(1080), Some(30.0));
        let at60 = estimate(20.0, 60.0, Some(1920), Some(1080), Some(60.0));
        assert!(at60.bits_per_pixel < at30.bits_per_pixel);
    }

    /// Missing probe data must not fabricate a resolution or a false warning.
    #[test]
    fn unknown_dimensions_degrade_gracefully() {
        let e = estimate(10.0, 60.0, None, None, None);
        assert_eq!(e.bits_per_pixel, 0.0);
        assert_eq!(e.source_height, 0);
        assert!(e.warning.is_none());
        assert!(!e.tier.should_block());
    }

    /// Guards against divide-by-zero and negative bitrates from absurd input.
    #[test]
    fn degenerate_inputs_stay_finite() {
        for (mb, dur) in [(0.1, 0.0), (0.0, 100.0), (0.001, 100000.0)] {
            let e = estimate(mb, dur, Some(1920), Some(1080), Some(30.0));
            assert!(e.video_kbps >= 100, "bitrate floor breached: {}", e.video_kbps);
            assert!(e.bits_per_pixel.is_finite());
            assert!(e.min_recommended_mb.is_finite());
            assert!(e.output_height >= MIN_HEIGHT);
        }
    }

    /// The recommendation must actually reach Acceptable, otherwise following
    /// the advice would produce another warning.
    #[test]
    fn following_the_recommendation_clears_the_warning() {
        let bad = estimate(3.0, 600.0, Some(1920), Some(1080), Some(30.0));
        let fixed = estimate(
            bad.min_recommended_mb,
            600.0,
            Some(1920),
            Some(1080),
            Some(30.0),
        );
        assert!(
            matches!(fixed.tier, QualityTier::Good | QualityTier::Acceptable),
            "recommended {} MB still landed at {:?}",
            bad.min_recommended_mb,
            fixed.tier
        );
        assert!(!fixed.tier.should_block());
    }

    #[test]
    fn output_height_never_exceeds_source() {
        let e = estimate(500.0, 10.0, Some(640), Some(360), Some(30.0));
        assert_eq!(e.output_height, 360);
    }
}
