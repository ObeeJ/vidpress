"use client";
import { useState } from "react";

const API_BASE = "https://your-domain.com"; // replace with real domain

const ENDPOINTS = [
  {
    method: "POST", path: "/ingest", auth: "optional",
    desc: "Upload a file to the server. Automatically remuxes .mov/.avi/.mkv to .mp4 for universal compatibility. Returns a path to use with /analyze and /upload.",
    headers: [
      { name: "x-file-name", desc: "Original filename (e.g. video.mp4)", required: true },
      { name: "x-api-key", desc: "Your API key", required: false },
    ],
    body: "Raw file bytes",
    response: `{ "path": "/tmp/vidpress_output/abc123_video.mp4" }`,
  },
  {
    method: "POST", path: "/analyze", auth: "optional",
    desc: "Analyze a file and get compression estimates, codec info, and available output formats — without compressing.",
    body: `{ "path": "/tmp/vidpress_output/abc123_video.mp4" }`,
    response: `{ "kind": "video", "codec_name": "h264", "duration_secs": 138.3, "size_bytes": 408449822, "width": 3840, "height": 2160, "output_ext": "mp4", "available_formats": ["mp4","mov","mkv","webm","avi"], "estimated_output_mb": 38.9, "estimated_time_secs": 207 }`,
  },
  {
    method: "POST", path: "/upload", auth: "optional",
    desc: "Queue a compression job. Returns immediately with a job_id. Poll /jobs/:id or use webhook_url to get notified when done.",
    body: `{ "path": "/tmp/...", "preset": "web", "output_format": "mp4", "webhook_url": "https://yourapp.com/hook" }`,
    response: `{ "job_id": "uuid", "status": "queued", "estimated_time_secs": 207 }`,
  },
  {
    method: "GET", path: "/jobs/:id", auth: "optional",
    desc: "Poll job status. Poll every 1-2 seconds until status is 'done' or 'failed'. Jobs persist across server restarts.",
    response: `{ "id": "uuid", "status": "done", "progress": 100, "original_bytes": 408449822, "compressed_bytes": 46124172, "output_path": "...", "eta_secs": 0 }`,
  },
  {
    method: "GET", path: "/download/:id", auth: "optional",
    desc: "Download the compressed output file. Only available when job status is 'done'. Also accessible via /download/:id on the frontend.",
    response: "Binary file stream",
  },
  {
    method: "POST", path: "/download-url", auth: "required (premium+)",
    desc: "Download video or audio from YouTube, Instagram, TikTok, X (Twitter), or Facebook. Returns a job_id — poll /jobs/:id for status.",
    body: `{ "url": "https://youtube.com/watch?v=...", "audio_only": false, "webhook_url": "https://yourapp.com/hook" }`,
    response: `{ "job_id": "uuid", "status": "queued" }`,
  },
  {
    method: "POST", path: "/transcribe", auth: "required (premium+)",
    desc: "Transcribe audio or video to text. Free keys use Whisper 'base' model. Premium+ keys use 'medium' for higher accuracy. Pass job_id of a completed job or a direct file path.",
    body: `{ "job_id": "uuid" }`,
    response: `{ "id": "uuid", "text": "Hello world...", "model": "medium" }`,
  },
  {
    method: "GET", path: "/transcriptions/:id", auth: "optional",
    desc: "Retrieve a previously created transcription by its ID.",
    response: `{ "id": "uuid", "job_id": "uuid", "text": "Hello world..." }`,
  },
  {
    method: "POST", path: "/keys", auth: "none",
    desc: "Create an API key. For white-label plans, white_label_domain is exclusive — no two accounts can share the same domain.",
    body: `{ "name": "My App", "plan": "premium", "webhook_url": "https://yourapp.com/hook", "white_label_domain": "compress.yourbrand.com", "white_label_brand": "YourBrand" }`,
    response: `{ "key": "vp_ABC123...", "name": "My App", "plan": "premium" }`,
  },
  {
    method: "GET", path: "/health", auth: "none",
    desc: "Health check.",
    response: `{ "ok": true }`,
  },
];

const WEBHOOK_PAYLOAD = `{
  "id": "uuid",
  "status": "done",
  "media_kind": "video",
  "original_bytes": 408449822,
  "compressed_bytes": 46124172,
  "output_path": "/tmp/vidpress_output/uuid_output.mp4",
  "duration_secs": 138.3,
  "progress": 100,
  "eta_secs": 0
}`;

const METHOD_COLOR: Record<string, string> = {
  GET: "#22c55e", POST: "var(--accent)", DELETE: "#ef4444"
};

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <pre style={{ background: "#0d0d0d", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", fontSize: 12, overflowX: "auto", lineHeight: 1.6, margin: 0 }}>
        <code>{code}</code>
      </pre>
      <button onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        style={{ position: "absolute", top: 8, right: 8, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

export default function DocsPage() {
  return (
    <main style={{ minHeight: "100vh", padding: "60px 20px", background: "var(--bg)" }}>
      <div style={{ maxWidth: 800, margin: "0 auto", display: "flex", flexDirection: "column", gap: 40 }}>

        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px", marginBottom: 8 }}>API Reference</h1>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>Base URL: <code style={{ background: "var(--surface)", padding: "2px 8px", borderRadius: 6 }}>{API_BASE}</code></p>
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
            Add your API key to every request: <code style={{ background: "var(--surface)", padding: "2px 8px", borderRadius: 6 }}>x-api-key: vp_YOUR_KEY</code>
          </p>
        </div>

        {/* Rate limits */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px" }}>
          <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Rate limits</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {[
              { tier: "Anonymous", limit: "10 req/min per IP" },
              { tier: "Free API key", limit: "60 req/min" },
              { tier: "Premium API key", limit: "300 req/min" },
            ].map((r) => (
              <div key={r.tier} style={{ background: "var(--surface2)", borderRadius: 10, padding: "12px" }}>
                <p style={{ fontSize: 12, fontWeight: 700 }}>{r.tier}</p>
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{r.limit}</p>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 12 }}>Rate limit exceeded returns HTTP 429. Retry after 60 seconds.</p>
        </div>

        {/* Endpoints */}
        {ENDPOINTS.map((ep) => (
          <div key={ep.path} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: METHOD_COLOR[ep.method] ?? "var(--text)", background: METHOD_COLOR[ep.method] + "22", padding: "3px 10px", borderRadius: 6 }}>{ep.method}</span>
              <code style={{ fontSize: 14, fontWeight: 700 }}>{ep.path}</code>
              <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>auth: {ep.auth}</span>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ fontSize: 13, color: "var(--muted)" }}>{ep.desc}</p>
              {ep.headers && (
                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Headers</p>
                  {ep.headers.map((h) => (
                    <div key={h.name} style={{ display: "flex", gap: 12, fontSize: 12, marginBottom: 6 }}>
                      <code style={{ color: "var(--accent)", minWidth: 140 }}>{h.name}</code>
                      <span style={{ color: "var(--muted)" }}>{h.desc} {h.required ? "" : "(optional)"}</span>
                    </div>
                  ))}
                </div>
              )}
              {ep.body && ep.body !== "Raw file bytes" && (
                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Request body</p>
                  <CodeBlock code={ep.body} />
                </div>
              )}
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Response</p>
                <CodeBlock code={ep.response ?? ""} />
              </div>
            </div>
          </div>
        ))}

        {/* Webhook docs */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ fontWeight: 700, fontSize: 16 }}>Webhooks</p>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            Pass a <code style={{ background: "var(--surface2)", padding: "2px 6px", borderRadius: 4 }}>webhook_url</code> in your <code style={{ background: "var(--surface2)", padding: "2px 6px", borderRadius: 4 }}>POST /upload</code> or <code style={{ background: "var(--surface2)", padding: "2px 6px", borderRadius: 4 }}>POST /download-url</code> request.
            When the job completes, we POST the job object to your URL with header <code style={{ background: "var(--surface2)", padding: "2px 6px", borderRadius: 4 }}>x-vidpress-event: job.done</code>.
            We retry 3 times with exponential backoff on failure.
          </p>
          <CodeBlock code={WEBHOOK_PAYLOAD} />
          <p style={{ fontSize: 12, color: "var(--muted)" }}>Respond with HTTP 2xx to acknowledge. Any other status triggers a retry.</p>
        </div>

        {/* Quick start */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ fontWeight: 700, fontSize: 16 }}>Quick start (curl)</p>
          <CodeBlock code={`# 1. Upload file
curl -X POST ${API_BASE}/ingest \\
  -H "x-file-name: video.mp4" \\
  -H "x-api-key: vp_YOUR_KEY" \\
  --data-binary @video.mp4

# 2. Compress it
curl -X POST ${API_BASE}/upload \\
  -H "content-type: application/json" \\
  -H "x-api-key: vp_YOUR_KEY" \\
  -d '{"path":"/tmp/vidpress_output/abc_video.mp4","preset":"web","webhook_url":"https://yourapp.com/hook"}'

# 3. Poll status
curl ${API_BASE}/jobs/JOB_ID -H "x-api-key: vp_YOUR_KEY"

# 4. Download
curl ${API_BASE}/download/JOB_ID -o compressed.mp4`} />
        </div>

      </div>
    </main>
  );
}
