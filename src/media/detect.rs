use serde::Serialize;
use tokio::process::Command;
use crate::{media::ffmpeg_args::default_video_args, state::HwEncoder};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    Video,
    AudioLossless,
    AudioLossy,
    ImageAnimated,
    ImageStatic,
}

#[derive(Debug, Clone, Serialize)]
pub struct MediaProfile {
    pub kind:                 MediaKind,
    pub codec_name:           String,
    pub duration_secs:        f64,
    pub size_bytes:           u64,
    pub width:                Option<u64>,
    pub height:               Option<u64>,
    #[serde(skip)]
    pub ffmpeg_args:          Vec<String>,
    pub output_ext:           String,
    pub available_formats:    Vec<String>,
    pub estimated_output_mb:  f64,
    pub estimated_time_secs:  u64,
}

pub async fn detect(path: &str) -> Result<MediaProfile, String> {
    detect_with_hw(path, &HwEncoder::Software).await
}

pub async fn detect_with_hw(path: &str, hw: &HwEncoder) -> Result<MediaProfile, String> {
    let out = Command::new("ffprobe")
        .args(["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path])
        .output().await.map_err(|e| e.to_string())?;

    let j: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    let fmt = &j["format"];
    let size_bytes: u64 = fmt["size"].as_str().unwrap_or("0").parse().unwrap_or(0);
    let duration_secs: f64 = fmt["duration"].as_str().unwrap_or("0").parse().unwrap_or(0.0);
    let streams = j["streams"].as_array().ok_or("no streams")?;

    let video_stream = streams.iter().find(|s| s["codec_type"] == "video");
    let audio_stream = streams.iter().find(|s| s["codec_type"] == "audio");
    let width        = video_stream.and_then(|v| v["width"].as_u64());
    let height       = video_stream.and_then(|v| v["height"].as_u64());
    let video_codec  = video_stream.and_then(|v| v["codec_name"].as_str()).unwrap_or("").to_string();
    let audio_codec  = audio_stream.and_then(|a| a["codec_name"].as_str()).unwrap_or("").to_string();
    let nb_frames: u64 = video_stream
        .and_then(|v| v["nb_frames"].as_str())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let size_mb = size_bytes as f64 / 1_048_576.0;
    let input_ext = std::path::Path::new(path)
        .extension().and_then(|e| e.to_str()).unwrap_or("mp4").to_lowercase();

    let is_animated = video_stream.is_some() && audio_stream.is_none()
        && (video_codec == "gif" || (duration_secs < 30.0 && nb_frames < 500 && video_codec == "webp"));
    if is_animated {
        let ext = if input_ext == "gif" { "gif" } else { "webp" };
        return Ok(MediaProfile {
            kind: MediaKind::ImageAnimated, codec_name: video_codec, duration_secs,
            size_bytes, width, height,
            ffmpeg_args: s(&["-c:v","libx264","-preset","fast","-crf","28","-an","-movflags","+faststart"]), // animated gif/webp — no audio, sw only
            output_ext: ext.into(),
            available_formats: vec!["gif".into(), "webp".into(), "mp4".into()],
            estimated_output_mb: size_mb * 0.15,
            estimated_time_secs: (duration_secs * 2.0) as u64 + 5,
        });
    }

    let is_static = video_stream.is_some() && audio_stream.is_none()
        && duration_secs < 0.1
        && matches!(video_codec.as_str(), "mjpeg"|"png"|"webp"|"tiff"|"bmp");
    if is_static {
        let ext = match video_codec.as_str() { "mjpeg" => "jpg", "png" => "png", "webp" => "webp", _ => "jpg" };
        return Ok(MediaProfile {
            kind: MediaKind::ImageStatic, codec_name: video_codec, duration_secs: 0.0,
            size_bytes, width, height,
            ffmpeg_args: s(&["-q:v","80"]),
            output_ext: ext.into(),
            available_formats: vec!["jpg".into(), "png".into(), "webp".into()],
            estimated_output_mb: size_mb * 0.30,
            estimated_time_secs: 2,
        });
    }

    if video_stream.is_some() {
        let ext = match input_ext.as_str() {
            "mp4"|"m4v"|"mov"|"mkv"|"avi"|"webm" => input_ext.as_str(), _ => "mp4"
        }.to_string();
        return Ok(MediaProfile {
            kind: MediaKind::Video, codec_name: video_codec, duration_secs,
            size_bytes, width, height,
            ffmpeg_args: default_video_args(hw),
            output_ext: ext,
            available_formats: vec!["mp4".into(),"mov".into(),"mkv".into(),"webm".into(),"avi".into()],
            estimated_output_mb: size_mb * 0.15,
            estimated_time_secs: (duration_secs * 0.8) as u64 + 5,
        });
    }

    if matches!(audio_codec.as_str(), "flac"|"pcm_s16le"|"pcm_s24le"|"pcm_f32le"|"aiff") {
        let ext = match input_ext.as_str() { "flac"|"wav"|"aiff"|"aif" => input_ext.as_str(), _ => "flac" }.to_string();
        return Ok(MediaProfile {
            kind: MediaKind::AudioLossless, codec_name: audio_codec, duration_secs,
            size_bytes, width: None, height: None,
            ffmpeg_args: s(&["-c:a","aac","-b:a","192k","-vn"]),
            output_ext: ext,
            available_formats: vec!["mp3".into(),"m4a".into(),"ogg".into(),"flac".into(),"wav".into()],
            estimated_output_mb: duration_secs * 192.0 / 8.0 / 1024.0,
            estimated_time_secs: (duration_secs * 0.3) as u64 + 2,
        });
    }

    if audio_stream.is_some() {
        let ext = match input_ext.as_str() { "mp3"|"m4a"|"ogg"|"aac"|"opus" => input_ext.as_str(), _ => "mp3" }.to_string();
        return Ok(MediaProfile {
            kind: MediaKind::AudioLossy, codec_name: audio_codec, duration_secs,
            size_bytes, width: None, height: None,
            ffmpeg_args: s(&["-c:a","aac","-b:a","128k","-vn"]),
            output_ext: ext,
            available_formats: vec!["mp3".into(),"m4a".into(),"ogg".into(),"aac".into()],
            estimated_output_mb: duration_secs * 128.0 / 8.0 / 1024.0,
            estimated_time_secs: (duration_secs * 0.2) as u64 + 2,
        });
    }

    Err("unsupported media type".into())
}

fn s(v: &[&str]) -> Vec<String> { v.iter().map(|s| s.to_string()).collect() }
