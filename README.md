# VidPress

Video compression as a service. Upload a video, get back a compressed version at maximum speed while preserving visual quality.

Built with Rust + [GlideAPI](https://crates.io/crates/glideapi) + FFmpeg.

## Stack
- **GlideAPI** — Rust web framework
- **FFmpeg** — H.265 compression (ultrafast preset, CRF 24)
- **tokio** — async runtime + background job processing

## Run locally

```bash
# Install FFmpeg
sudo apt install ffmpeg

# Run the server
cargo run
```

Server starts on `http://0.0.0.0:8080`

## API

### Upload a video
```bash
curl -X POST http://localhost:8080/upload \
  --data-binary @myvideo.mp4 \
  -H "Content-Type: application/octet-stream"
```
Response:
```json
{ "job_id": "abc-123", "status": "queued" }
```

### Poll job status
```bash
curl http://localhost:8080/jobs/abc-123
```
Response:
```json
{
  "id": "abc-123",
  "status": "done",
  "original_bytes": 1073741824,
  "compressed_bytes": 52428800
}
```

## Docs
- [PRD](docs/PRD.md)
- [Roadmap](docs/ROADMAP.md)
- [User Stories](docs/USER_STORIES.md)
- [User Flow](docs/USER_FLOW.md)
- [System Design](docs/SYSTEM_DESIGN.md)
