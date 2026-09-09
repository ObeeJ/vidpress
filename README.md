# theflate

> Compress, convert, download, and transcribe any media — instantly. Built for developers and non-technical users alike.

## What it does

- **Compress** video, audio, and images (H.264, AAC, WebP, MP3, FLAC, and more)
- **Convert** between formats (MP4, MOV, MKV, WebM, AVI, MP3, M4A, OGG, WAV, FLAC, JPG, PNG, WebP, GIF)
- **Download** from YouTube, Instagram, TikTok, X (Twitter), Facebook — video or audio-only
- **Transcribe** audio/video to text using OpenAI Whisper (base for free, medium for premium)
- **Preset profiles** — WhatsApp, Instagram Reel, Web, Twitter/X, Original
- **Webhooks** — get notified when jobs complete, with HMAC signing on premium
- **QR code sharing** — scan to download on any device
- **Media preview** — preview before downloading

## Stack

| Layer | Tech |
|---|---|
| Backend | Rust + glideapi (custom framework) |
| Media processing | ffmpeg, ffprobe, yt-dlp, OpenAI Whisper |
| Database | SQLite (rusqlite, bundled) |
| Frontend | Next.js 16, React 19, Zustand, TypeScript |
| Infra | Nginx reverse proxy, cron cleanup |

## Running locally

```bash
# Backend (port 8080)
cd /path/to/theflate
cargo run

# Frontend (port 3000)
cd ui
bun run dev
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `THEFLATE_STORAGE` | `/tmp/theflate_output` | Where compressed files are stored |
| `THEFLATE_DB` | `/tmp/theflate.db` | SQLite database path |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080` | Backend API base URL |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:3000` | Public URL for QR codes and sharing |

## API

Base URL: `http://localhost:8080`

All requests accept `x-api-key: vp_YOUR_KEY` header. Anonymous requests are rate-limited to 10/min per IP.

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/ingest` | optional | Upload file bytes → returns server path |
| `POST` | `/analyze` | optional | Analyze file → codec, size, format options |
| `POST` | `/upload` | optional | Queue compression job |
| `GET` | `/jobs/:id` | optional | Poll job status |
| `GET` | `/download/:id` | optional | Download compressed output |
| `POST` | `/download-url` | premium | Download from YouTube/IG/TikTok/X |
| `POST` | `/transcribe` | premium | Transcribe audio/video to text |
| `GET` | `/transcriptions/:id` | optional | Get transcription result |
| `POST` | `/keys` | none | Create API key |
| `GET` | `/health` | none | Health check |

### Rate limits

| Plan | Limit |
|---|---|
| Anonymous | 10 req/min per IP |
| Free key | 60 req/min |
| Premium | 300 req/min |
| API Starter | 120 req/min |
| API Growth | 600 req/min |
| API Scale / White-label | 3000 req/min |

### Quick start

```bash
# 1. Upload
curl -X POST http://localhost:8080/ingest \
  -H "x-file-name: video.mp4" \
  -H "x-api-key: vp_YOUR_KEY" \
  --data-binary @video.mp4

# 2. Compress
curl -X POST http://localhost:8080/upload \
  -H "content-type: application/json" \
  -H "x-api-key: vp_YOUR_KEY" \
  -d '{"path":"/tmp/theflate_output/abc_video.mp4","preset":"web","webhook_url":"https://yourapp.com/hook"}'

# 3. Poll
curl http://localhost:8080/jobs/JOB_ID -H "x-api-key: vp_YOUR_KEY"

# 4. Download
curl http://localhost:8080/download/JOB_ID -o compressed.mp4
```

### Webhook payload

When a job completes, theflate POSTs to your `webhook_url`:

```json
{
  "id": "uuid",
  "status": "done",
  "media_kind": "video",
  "original_bytes": 408449822,
  "compressed_bytes": 46124172,
  "output_path": "/tmp/theflate_output/uuid_output.mp4",
  "duration_secs": 138.3,
  "progress": 100,
  "eta_secs": 0
}
```

Header: `x-theflate-event: job.done`

Respond with HTTP 2xx to acknowledge. Retries 3 times with exponential backoff on failure.

## Pricing

| Plan | Price | Jobs/month | API req/min |
|---|---|---|---|
| Free | $0 | 10/day | 60 |
| Premium | $2/mo | Unlimited | 300 |
| API Starter | $5/mo | 5,000 | 120 |
| API Growth | $15/mo | 50,000 | 600 |
| API Scale | $49/mo | Unlimited | 3,000 |
| White-label Basic | $19/mo | Unlimited | 3,000 |
| White-label Pro | $49/mo | Unlimited + resell | 3,000 |
| Source License | $299 one-time | Self-host forever | — |

## White-label

Each white-label domain is **exclusively locked** to one account. No two companies can share the same domain.

1. Buy a white-label plan at `/pricing`
2. Enter your domain (e.g. `compress.yourbrand.com`) and brand name
3. Add a CNAME DNS record pointing to the theflate server
4. Your users see your brand — we handle the infrastructure

## Nginx setup

```bash
sudo cp nginx.conf /etc/nginx/sites-available/theflate
sudo ln -s /etc/nginx/sites-available/theflate /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# HTTPS (replace yourdomain.com)
sudo certbot --nginx -d yourdomain.com
```

## Cron cleanup

Already installed. Runs hourly, deletes output files older than 24h, marks stale jobs failed.

```bash
crontab -l | grep theflate
# 0 * * * * /path/to/theflate/cleanup.sh
```

## Deployment

**Frontend** → Cloudflare Pages (set `NEXT_PUBLIC_BASE_URL` to your domain)

**Backend** → Railway or any VPS with ffmpeg, yt-dlp, whisper installed

```bash
# Install dependencies on Ubuntu/Debian
sudo apt install ffmpeg
pip3 install yt-dlp openai-whisper
```
