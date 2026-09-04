# VidPress — User Flow

## Web Upload Flow

```
[Landing Page]
      |
      v
[Sign Up / Log In]
      |
      v
[Dashboard]
      |
      v
[Click "Upload Video"]
      |
      v
[Select file (up to 1GB)]
      |
      v
[Upload in progress — progress bar]
      |
      v
[Job queued — show Job ID]
      |
      v
[Polling: status = processing...]
      |
      v
[Status = done]
      |
      v
[Show: original size / compressed size / savings %]
      |
      v
[Download compressed video]
```

---

## API Flow (Developer)

```
POST /upload
  → body: raw video bytes
  ← 202 { job_id, status: "queued" }

GET /jobs/:id
  ← { status: "processing" }   (poll until done)

GET /jobs/:id
  ← { status: "done", compressed_bytes, original_bytes }

GET /download/:id
  ← compressed video file
```

---

## Error States
- File too large (>1GB) → 413 with clear message
- Unsupported format → 400 with supported formats list
- Compression failed → 500, user notified, retry offered
- Free tier limit hit → 402, upgrade prompt shown
