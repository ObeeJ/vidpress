"use client";
import { useState } from "react";

const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:8080";

const MC: Record<string, string> = { GET: "#22c55e", POST: "#7c3aed", DELETE: "#ef4444" };

const ENDPOINTS = [
  { method: "POST", path: "/ingest", auth: "optional", plan: null,
    desc: "Upload raw file bytes. Auto-remuxes .mov/.avi/.mkv → .mp4. Returns server path for use with /analyze and /upload.",
    headers: [{ k: "x-file-name", v: "video.mp4", req: true }, { k: "x-api-key", v: "vp_...", req: false }],
    req: "Binary file bytes",
    res: `{ "path": "/tmp/vidpress_output/abc_video.mp4" }` },
  { method: "POST", path: "/analyze", auth: "optional", plan: null,
    desc: "Analyze a file — returns codec, dimensions, duration, available output formats, and compression estimates. Does not compress.",
    req: `{ "path": "/tmp/vidpress_output/abc_video.mp4" }`,
    res: `{ "kind": "video", "codec_name": "h264", "duration_secs": 138.3,\n  "size_bytes": 408449822, "width": 3840, "height": 2160,\n  "output_ext": "mp4", "available_formats": ["mp4","mov","mkv","webm","avi"],\n  "estimated_output_mb": 38.9, "estimated_time_secs": 207 }` },
  { method: "POST", path: "/upload", auth: "optional", plan: null,
    desc: "Queue a compression job. Returns immediately with job_id. Use webhook_url to get notified on completion instead of polling.",
    req: `{ "path": "/tmp/...",\n  "preset": "web",\n  "output_format": "mp4",\n  "webhook_url": "https://yourapp.com/hook" }`,
    res: `{ "job_id": "uuid", "status": "queued", "estimated_time_secs": 207 }` },
  { method: "GET", path: "/jobs/:id", auth: "optional", plan: null,
    desc: "Poll job status. Poll every 1–2s until status is 'done' or 'failed'. Jobs persist across server restarts.",
    res: `{ "id": "uuid", "status": "done", "progress": 100,\n  "original_bytes": 408449822, "compressed_bytes": 46124172,\n  "duration_secs": 138.3, "eta_secs": 0 }` },
  { method: "GET", path: "/download/:id", auth: "optional", plan: null,
    desc: "Stream the compressed output file. Only works when job status is 'done'.",
    res: "Binary file stream (video/mp4, audio/mp3, image/webp, etc.)" },
  { method: "POST", path: "/download-url", auth: "required", plan: "premium+",
    desc: "Download video or audio from YouTube, Instagram, TikTok, X (Twitter), or Facebook. Returns job_id — poll /jobs/:id for status.",
    req: `{ "url": "https://youtu.be/6fGaxufI0kc",\n  "audio_only": false,\n  "webhook_url": "https://yourapp.com/hook" }`,
    res: `{ "job_id": "uuid", "status": "queued" }` },
  { method: "POST", path: "/transcribe", auth: "required", plan: "premium+",
    desc: "Transcribe audio/video to text. Free = Whisper base. Premium+ = Whisper medium (higher accuracy). Pass job_id of a completed job.",
    req: `{ "job_id": "uuid" }`,
    res: `{ "id": "uuid", "text": "Hello world...", "model": "medium" }` },
  { method: "GET", path: "/transcriptions/:id", auth: "optional", plan: null,
    desc: "Retrieve a transcription by ID.",
    res: `{ "id": "uuid", "job_id": "uuid", "text": "Hello world..." }` },
  { method: "POST", path: "/keys", auth: "none", plan: null,
    desc: "Create an API key. White-label domains are exclusive — attempting to claim a taken domain returns HTTP 409.",
    req: `{ "name": "My App", "plan": "premium",\n  "webhook_url": "https://yourapp.com/hook",\n  "white_label_domain": "compress.yourbrand.com",\n  "white_label_brand": "YourBrand" }`,
    res: `{ "key": "vp_ABC123...", "name": "My App", "plan": "premium" }` },
  { method: "GET", path: "/health", auth: "none", plan: null,
    desc: "Health check.",
    res: `{ "ok": true }` },
];

const RATES = [
  { tier: "Anonymous", limit: "10 / min", note: "Per IP" },
  { tier: "Free key", limit: "60 / min", note: "" },
  { tier: "Premium", limit: "300 / min", note: "" },
  { tier: "API Starter", limit: "120 / min", note: "" },
  { tier: "API Growth", limit: "600 / min", note: "" },
  { tier: "API Scale / White-label", limit: "3,000 / min", note: "" },
];

const PRESETS = ["web", "whatsapp", "instagram_reel", "twitter", "original"];

function Code({ code, lang = "" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <pre style={{ background: "#0a0a0a", border: "1px solid #1e1e1e", borderRadius: 10, padding: "14px 16px", fontSize: 12, overflowX: "auto", lineHeight: 1.7, margin: 0, color: "#e5e5e5" }}>
        <code>{code}</code>
      </pre>
      <button onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        style={{ position: "absolute", top: 8, right: 8, padding: "3px 10px", borderRadius: 6, border: "1px solid #333", background: "#111", color: "#888", fontSize: 11, cursor: "pointer" }}>
        {copied ? "✓" : "Copy"}
      </button>
    </div>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 6, background: color + "22", color, border: `1px solid ${color}44`, whiteSpace: "nowrap" }}>{text}</span>;
}

export default function DocsPage() {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>

      {/* Header */}
      <div style={{ borderBottom: "1px solid var(--border)", padding: "32px 40px 24px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <a href="/" style={{ color: "var(--muted)", fontSize: 13, textDecoration: "none" }}>← vidpress</a>
            <span style={{ color: "var(--border)" }}>/</span>
            <span style={{ fontSize: 13, color: "var(--text)" }}>API Reference</span>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.5px", marginBottom: 8 }}>API Reference</h1>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <code style={{ background: "var(--surface)", border: "1px solid var(--border)", padding: "4px 12px", borderRadius: 8, fontSize: 13 }}>{BASE}</code>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Add your key: <code style={{ background: "var(--surface)", padding: "2px 8px", borderRadius: 6, fontSize: 12 }}>x-api-key: vp_YOUR_KEY</code></span>
            <a href="/pricing" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>Get a key →</a>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 40px 80px", display: "flex", flexDirection: "column", gap: 40 }}>

        {/* Rate limits */}
        <section>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Rate limits</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {RATES.map((r) => (
              <div key={r.tier} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" }}>
                <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{r.tier}</p>
                <p style={{ fontSize: 18, fontWeight: 800 }}>{r.limit}</p>
                {r.note && <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{r.note}</p>}
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>Rate limit exceeded → HTTP 429. Retry after 60 seconds.</p>
        </section>

        {/* Presets */}
        <section>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Presets</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {PRESETS.map((p) => (
              <code key={p} style={{ background: "var(--surface)", border: "1px solid var(--border)", padding: "4px 12px", borderRadius: 8, fontSize: 12 }}>{p}</code>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>Pass as <code style={{ background: "var(--surface)", padding: "1px 6px", borderRadius: 4 }}>preset</code> in <code style={{ background: "var(--surface)", padding: "1px 6px", borderRadius: 4 }}>POST /upload</code>. Overrides default ffmpeg args.</p>
        </section>

        {/* Endpoints */}
        <section>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Endpoints</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ENDPOINTS.map((ep) => {
              const isOpen = open === ep.path;
              return (
                <div key={ep.path} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
                  <button onClick={() => setOpen(isOpen ? null : ep.path)}
                    style={{ width: "100%", padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <Badge text={ep.method} color={MC[ep.method] ?? "#888"} />
                    <code style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", flex: 1 }}>{ep.path}</code>
                    {ep.plan && <Badge text={ep.plan} color="#f59e0b" />}
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>{ep.auth}</span>
                    <span style={{ color: "var(--muted)", fontSize: 14, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
                  </button>
                  {isOpen && (
                    <div style={{ padding: "0 18px 18px", display: "flex", flexDirection: "column", gap: 14, borderTop: "1px solid var(--border)" }}>
                      <p style={{ fontSize: 13, color: "var(--muted)", paddingTop: 14, lineHeight: 1.6 }}>{ep.desc}</p>
                      {ep.headers && (
                        <div>
                          <p style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Headers</p>
                          {ep.headers.map((h) => (
                            <div key={h.k} style={{ display: "flex", gap: 12, fontSize: 12, marginBottom: 6, alignItems: "center" }}>
                              <code style={{ color: "var(--accent)", minWidth: 120 }}>{h.k}</code>
                              <code style={{ color: "var(--muted)" }}>{h.v}</code>
                              {!h.req && <span style={{ fontSize: 10, color: "var(--muted)" }}>optional</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      {ep.req && ep.req !== "Binary file bytes" && (
                        <div>
                          <p style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Request body</p>
                          <Code code={ep.req} />
                        </div>
                      )}
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Response</p>
                        <Code code={ep.res ?? ""} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Webhook */}
        <section>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Webhooks</h2>
          <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.7 }}>
            Pass <code style={{ background: "var(--surface)", padding: "1px 6px", borderRadius: 4 }}>webhook_url</code> in <code style={{ background: "var(--surface)", padding: "1px 6px", borderRadius: 4 }}>POST /upload</code> or <code style={{ background: "var(--surface)", padding: "1px 6px", borderRadius: 4 }}>POST /download-url</code>.
            We POST the job object to your URL with header <code style={{ background: "var(--surface)", padding: "1px 6px", borderRadius: 4 }}>x-vidpress-event: job.done</code> when complete.
            Retries 3× with exponential backoff. Respond HTTP 2xx to acknowledge.
          </p>
          <Code code={`POST https://yourapp.com/hook
x-vidpress-event: job.done
content-type: application/json

{
  "id": "uuid",
  "status": "done",
  "media_kind": "video",
  "original_bytes": 408449822,
  "compressed_bytes": 46124172,
  "output_path": "/tmp/vidpress_output/uuid_output.mp4",
  "duration_secs": 138.3,
  "progress": 100,
  "eta_secs": 0
}`} />
        </section>

        {/* Quick start */}
        <section>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Quick start</h2>
          <Code code={`# 1. Upload your file
curl -X POST ${BASE}/ingest \\
  -H "x-file-name: video.mp4" \\
  -H "x-api-key: vp_YOUR_KEY" \\
  --data-binary @video.mp4
# → { "path": "/tmp/vidpress_output/abc_video.mp4" }

# 2. Compress it
curl -X POST ${BASE}/upload \\
  -H "content-type: application/json" \\
  -H "x-api-key: vp_YOUR_KEY" \\
  -d '{"path":"/tmp/vidpress_output/abc_video.mp4","preset":"web","webhook_url":"https://yourapp.com/hook"}'
# → { "job_id": "uuid", "status": "queued" }

# 3. Poll status (or use webhook instead)
curl ${BASE}/jobs/JOB_ID -H "x-api-key: vp_YOUR_KEY"

# 4. Download
curl ${BASE}/download/JOB_ID -o compressed.mp4

# Download from YouTube (premium+)
curl -X POST ${BASE}/download-url \\
  -H "content-type: application/json" \\
  -H "x-api-key: vp_YOUR_KEY" \\
  -d '{"url":"https://youtu.be/6fGaxufI0kc","audio_only":false}'

# Extract audio only
curl -X POST ${BASE}/download-url \\
  -H "content-type: application/json" \\
  -H "x-api-key: vp_YOUR_KEY" \\
  -d '{"url":"https://youtu.be/6fGaxufI0kc","audio_only":true}'`} />
        </section>

      </div>
    </main>
  );
}
