# VidPress — System Design

## Architecture Overview

```
                        ┌─────────────┐
                        │   Client    │
                        │ (Web / API) │
                        └──────┬──────┘
                               │ POST /upload (raw bytes)
                               ▼
                        ┌─────────────┐
                        │  GlideAPI   │
                        │ Rust Server │  ← handles HTTP, routing, state
                        └──────┬──────┘
                               │ tokio::spawn
                               ▼
                        ┌─────────────┐
                        │   Worker    │
                        │  (async)    │  ← runs FFmpeg subprocess
                        └──────┬──────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
             ┌────────────┐       ┌────────────┐
             │ /tmp input │       │ /tmp output│
             │  video     │──────▶│  compressed│
             └────────────┘       └────────────┘
```

## MVP (Single Server)
- GlideAPI Rust server handles uploads and job polling
- Jobs stored in-memory (HashMap behind Arc<Mutex>)
- FFmpeg spawned per job via tokio::process::Command
- Input/output stored in /tmp

## Production (AWS)

```
Client
  │
  ▼
CloudFront (CDN)
  │
  ▼
ALB (Load Balancer)
  │
  ▼
ECS Fargate — GlideAPI Rust API servers (stateless)
  │
  ├──▶ S3 (raw video uploads)
  ├──▶ SQS (compression job queue)
  └──▶ RDS Postgres (job metadata, users, billing)

SQS
  │
  ▼
ECS Fargate — Rust Worker Fleet (auto-scales)
  │
  ├──▶ FFmpeg compression
  └──▶ S3 (compressed video output)
```

## Key Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Web framework | GlideAPI (Rust) | FastAPI-style DX, high performance |
| Compression | FFmpeg (libx265, ultrafast, CRF 24) | Best quality/size ratio at max speed |
| Job queue (prod) | SQS | Decouples upload from processing, enables scaling |
| Storage (prod) | S3 | Cheap, durable, integrates with CloudFront |
| Worker scaling | ECS auto-scaling on SQS depth | Scale workers based on queue backlog |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | /upload | Upload raw video bytes, returns job_id |
| GET | /jobs/:id | Poll job status |
| GET | /download/:id | Download compressed video |
| GET | /health | Health check |

## Compression Settings
- Codec: libx265 (H.265)
- Preset: ultrafast (max speed)
- CRF: 24 (visually near-lossless, ~70-90% size reduction)
- Audio: AAC 128k

## Limits
- Max upload: 1GB
- Request timeout: 300s
- Free tier: 3 jobs/month
