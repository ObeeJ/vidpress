use crate::media::detect::MediaKind;

pub fn preset_ffmpeg_args(preset: &Option<String>) -> Option<Vec<String>> {
    let s = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    match preset.as_deref() {
        Some("whatsapp") => Some(s(&[
            "-c:v","libx264","-preset","fast","-crf","28",
            "-vf","scale='min(1280,iw)':-2","-c:a","aac","-b:a","96k","-movflags","+faststart",
        ])),
        Some("instagram_reel") => Some(s(&[
            "-c:v","libx264","-preset","fast","-crf","23",
            "-vf","scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
            "-c:a","aac","-b:a","128k","-movflags","+faststart",
        ])),
        Some("web") => Some(s(&[
            "-c:v","libx264","-preset","fast","-crf","23",
            "-vf","scale='min(1920,iw)':-2","-c:a","aac","-b:a","128k","-movflags","+faststart",
        ])),
        Some("twitter") => Some(s(&[
            "-c:v","libx264","-preset","fast","-crf","26",
            "-vf","scale='min(1280,iw)':-2","-c:a","aac","-b:a","96k",
            "-t","140","-movflags","+faststart",
        ])),
        _ => None,
    }
}

pub fn format_ffmpeg_args(kind: &MediaKind, fmt: &str) -> Vec<String> {
    let s = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    match (kind, fmt) {
        (MediaKind::Video | MediaKind::ImageAnimated, "mp4"|"mov"|"m4v") =>
            s(&["-c:v","libx264","-preset","fast","-crf","23","-c:a","aac","-b:a","128k","-movflags","+faststart"]),
        (MediaKind::Video | MediaKind::ImageAnimated, "mkv") =>
            s(&["-c:v","libx264","-preset","fast","-crf","23","-c:a","aac","-b:a","128k"]),
        (MediaKind::Video | MediaKind::ImageAnimated, "webm") =>
            s(&["-c:v","libvpx-vp9","-crf","33","-b:v","0","-c:a","libopus","-b:a","128k"]),
        (MediaKind::Video | MediaKind::ImageAnimated, "avi") =>
            s(&["-c:v","libx264","-preset","fast","-crf","23","-c:a","mp3","-b:a","128k"]),
        (MediaKind::Video | MediaKind::ImageAnimated, "gif") =>
            s(&["-vf","fps=15,scale='min(480,iw)':-1:flags=lanczos","-loop","0"]),
        (MediaKind::AudioLossless | MediaKind::AudioLossy, "mp3") =>
            s(&["-c:a","libmp3lame","-b:a","192k","-vn"]),
        (MediaKind::AudioLossless | MediaKind::AudioLossy, "m4a") =>
            s(&["-c:a","aac","-b:a","192k","-vn"]),
        (MediaKind::AudioLossless | MediaKind::AudioLossy, "ogg") =>
            s(&["-c:a","libvorbis","-q:a","6","-vn"]),
        (MediaKind::AudioLossless | MediaKind::AudioLossy, "flac") =>
            s(&["-c:a","flac","-vn"]),
        (MediaKind::AudioLossless | MediaKind::AudioLossy, "wav") =>
            s(&["-c:a","pcm_s16le","-vn"]),
        (MediaKind::ImageStatic, "jpg")  => s(&["-q:v","85"]),
        (MediaKind::ImageStatic, "png")  => s(&["-compression_level","6"]),
        (MediaKind::ImageStatic, "webp") => s(&["-q:v","80"]),
        _ => vec![],
    }
}
