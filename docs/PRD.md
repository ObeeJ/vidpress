# VidPress — PRD

## Problem
Video files are large. Uploading, storing, and sharing them is slow and expensive. Most users don't need raw quality — they need good-enough quality at a fraction of the size.

## Solution
VidPress is a SaaS that accepts a video upload, compresses it using FFmpeg (H.265, ultrafast, CRF 24) at maximum speed while preserving visual quality, and returns a download link.

---

## Users
- Content creators who share videos online
- Developers who need a video compression API
- Teams managing large video libraries

## Goals
- Compress a 1GB video to under 100MB without visible quality loss
- Processing starts within seconds of upload
- Simple API — one endpoint to upload, one to poll status

## Non-Goals
- Video editing or trimming
- Streaming / HLS output (Phase 3+)
- On-device compression

---

## Core Features

| Feature | Priority |
|---|---|
| Video upload (up to 1GB) | P0 |
| Background FFmpeg compression | P0 |
| Job status polling | P0 |
| Download compressed video | P0 |
| Free tier (3 videos/month) | P1 |
| Stripe billing | P1 |
| REST API + API keys | P1 |
| Bulk upload | P2 |
| rclone cloud-to-cloud transfer | P2 |

---

## Success Metrics
- Compression ratio: ≥ 70% size reduction on typical content
- Processing time: ≤ 2 min for a 1GB video on a 4-core instance
- Uptime: 99.9%
