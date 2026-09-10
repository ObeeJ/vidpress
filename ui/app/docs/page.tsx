"use client";

import { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.theflate.com";

const MC: Record<string, { bg: string; color: string }> = {
  GET: { bg: "rgba(16, 185, 129, 0.12)", color: "#10b981" },
  POST: { bg: "rgba(201, 242, 78, 0.15)", color: "var(--color-signal)" },
  DELETE: { bg: "rgba(239, 68, 68, 0.12)", color: "#ef4444" },
};

const ENDPOINTS = [
  {
    method: "POST",
    path: "/ingest",
    auth: "optional",
    title: "Upload Raw File Bytes",
    desc: "Upload raw binary file streams. Automatically remuxes MOV, AVI, and MKV files to MP4. Returns a server path for subsequent analysis and processing jobs.",
    headers: [
      { k: "x-file-name", v: "video.mp4", req: true },
      { k: "x-api-key", v: "vp_...", req: false },
    ],
    req: "Binary file payload",
    res: `{ "path": "/tmp/theflate_output/abc_video.mp4" }`,
  },
  {
    method: "POST",
    path: "/analyze",
    auth: "optional",
    title: "Inspect Media Metadata",
    desc: "Probe media file streams to extract codec details, dimensions, duration, bitrate, available target output formats, and size estimates.",
    req: `{ "path": "/tmp/theflate_output/abc_video.mp4" }`,
    res: `{
  "kind": "video",
  "codec_name": "h264",
  "duration_secs": 138.3,
  "size_bytes": 408449822,
  "width": 3840,
  "height": 2160,
  "output_ext": "mp4",
  "available_formats": ["mp4", "mov", "mkv", "webm", "avi"],
  "estimated_output_mb": 38.9,
  "estimated_time_secs": 20
}`,
  },
  {
    method: "POST",
    path: "/upload",
    auth: "optional",
    title: "Queue Compression Job",
    desc: "Queue a video or audio compression job. Accepts target file size (target_mb) for two-pass quality encoding. Supports async webhooks for job completion.",
    req: `{
  "path": "/tmp/theflate_output/abc_video.mp4",
  "target_mb": 50,
  "output_format": "mp4",
  "webhook_url": "https://yourapp.com/api/webhooks/theflate"
}`,
    res: `{
  "job_id": "job_8f291a0c",
  "status": "processing",
  "estimated_time_secs": 18
}`,
  },
  {
    method: "GET",
    path: "/jobs/:id",
    auth: "optional",
    title: "Poll Job Progress",
    desc: "Query the status, progress percentage, ETA, and download URL of a queued job.",
    res: `{
  "id": "job_8f291a0c",
  "status": "done",
  "progress": 100,
  "original_bytes": 408449822,
  "compressed_bytes": 51200000,
  "duration_secs": 138.3,
  "download_url": "${BASE}/api/jobs/job_8f291a0c/file"
}`,
  },
  {
    method: "GET",
    path: "/download/:id",
    auth: "optional",
    title: "Download Compressed Output",
    desc: "Stream the compressed output file directly once the job status is 'done'.",
    res: "Binary media stream (video/mp4, audio/mp3, image/webp)",
  },
  {
    method: "POST",
    path: "/download-url",
    auth: "required",
    title: "Download External Video Link",
    desc: "Download video or audio from YouTube, TikTok, Instagram, X (Twitter), or Facebook directly on the server.",
    req: `{
  "url": "https://youtu.be/dQw4w9WgXcQ",
  "audio_only": false,
  "webhook_url": "https://yourapp.com/api/webhooks/theflate"
}`,
    res: `{ "job_id": "job_99a8b1c", "status": "queued" }`,
  },
  {
    method: "POST",
    path: "/transcribe",
    auth: "required",
    title: "Transcribe Speech to Text",
    desc: "Transcribe audio/video speech to plain text using the local OpenAI Whisper model.",
    req: `{ "job_id": "job_8f291a0c", "language": "en" }`,
    res: `{
  "id": "job_8f291a0c",
  "text": "Full transcription payload text content...",
  "model": "base"
}`,
  },
  {
    method: "POST",
    path: "/export/s3",
    auth: "required",
    title: "Direct S3 Cloud Export (Option C)",
    desc: "Export compressed media directly into an AWS S3 or MinIO cloud storage bucket.",
    req: `{
  "job_id": "job_8f291a0c",
  "bucket": "acme-media-outputs",
  "region": "us-east-1",
  "endpoint": "http://localhost:9000",
  "target_path": "exports/compressed_video.mp4",
  "access_key": "minioadmin",
  "secret_key": "minioadmin"
}`,
    res: `{
  "status": "exported",
  "s3_url": "http://localhost:9000/acme-media-outputs/exports/compressed_video.mp4"
}`,
  },
  {
    method: "POST",
    path: "/keys",
    auth: "none",
    title: "Provision API Key",
    desc: "Create an API key programmatically with custom plan limits and webhook defaults.",
    req: `{
  "name": "Acme Production App",
  "plan": "api_growth",
  "webhook_url": "https://yourapp.com/api/webhooks/theflate"
}`,
    res: `{
  "key": "vp_9F8E7D6C5B4A32109F8E7D6C5B4A3210",
  "name": "Acme Production App",
  "plan": "api_growth"
}`,
  },
];

const RATES = [
  { tier: "Anonymous", limit: "10 / min", note: "Per-IP limit" },
  { tier: "Free Sandbox", limit: "60 / min", note: "API key issued" },
  { tier: "Pro Membership", limit: "300 / min", note: "Priority queue" },
  { tier: "API Starter", limit: "120 / min", note: "HMAC signatures" },
  { tier: "API Growth", limit: "600 / min", note: "Dedicated worker" },
  { tier: "API Scale", limit: "3,000 / min", note: "Guaranteed SLA" },
];

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <pre className="docs-code-block">
        <code>{code}</code>
      </pre>
      <button
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="docs-copy-btn"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export default function DocsPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(2);
  const [baseCopied, setBaseCopied] = useState(false);

  return (
    <div className="page-shell">
      <Navbar />

      <main style={{ flex: 1, maxWidth: 1000, width: "100%", margin: "0 auto", padding: "60px 20px 80px" }}>

        {/* Page Header */}
        <div style={{ marginBottom: 40 }}>
          <div style={{
            display: "inline-block",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-signal)",
            marginBottom: 10
          }}>
            Developer Reference
          </div>
          <h1 style={{ fontSize: 40, fontWeight: 900, letterSpacing: "-1.5px", color: "var(--color-fg)", marginBottom: 12, lineHeight: 1.1 }}>
            theflate API
          </h1>
          <p style={{ fontSize: 16, color: "var(--color-fg-2)", maxWidth: 640, lineHeight: 1.6 }}>
            Programmatic media compression, target size reduction, speech-to-text transcription, link downloads, and direct cloud exports.
          </p>
        </div>

        {/* Base Endpoint Card */}
        <div className="card" style={{ padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32, flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div className="label" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-fg-3)" }}>
              Base Endpoint
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <code style={{ fontSize: 16, color: "var(--color-fg)", fontWeight: 800, fontFamily: "monospace" }}>{BASE}</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(BASE);
                  setBaseCopied(true);
                  setTimeout(() => setBaseCopied(false), 1500);
                }}
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  borderRadius: 6,
                  border: "1px solid var(--color-surface-2)",
                  background: "var(--color-surface-1)",
                  color: "var(--color-fg-2)",
                  cursor: "pointer",
                  fontWeight: 600
                }}
              >
                {baseCopied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--color-surface-1)", padding: "8px 14px", borderRadius: 8, border: "1px solid var(--color-surface-2)" }}>
            <span style={{ fontSize: 12, color: "var(--color-fg-3)" }}>Header:</span>
            <code style={{ fontSize: 12, fontWeight: 700, color: "var(--color-fg)", fontFamily: "monospace" }}>x-api-key: vp_YOUR_KEY</code>
            <span style={{ fontSize: 11, color: "var(--color-signal)", fontWeight: 700 }}>(optional)</span>
          </div>
        </div>

        {/* Delivery Options B & C Highlights */}
        <div style={{ marginBottom: 44 }}>
          <div className="label" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-fg-3)", marginBottom: 12 }}>
            Recommended Integration Workflows
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
            {/* Option B */}
            <div className="card" style={{ padding: 24, position: "relative" }}>
              <div style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--color-signal)",
                marginBottom: 10
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-signal)" }} />
                Option B: Instant Webhooks
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: "var(--color-fg)", marginBottom: 8 }}>
                Automatic Push Notifications
              </h3>
              <p style={{ fontSize: 13, color: "var(--color-fg-2)", lineHeight: 1.6 }}>
                Pass a <code className="docs-inline-code">webhook_url</code> when creating any job. As soon as compression or transcription completes, <strong>theflate</strong> sends an HTTP POST payload with full job metadata and download links directly to your server.
              </p>
            </div>

            {/* Option C */}
            <div className="card" style={{ padding: 24, position: "relative" }}>
              <div style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "#10b981",
                marginBottom: 10
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
                Option C: Cloud S3 Export
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: "var(--color-fg)", marginBottom: 8 }}>
                Direct AWS S3 / MinIO Transfer
              </h3>
              <p style={{ fontSize: 13, color: "var(--color-fg-2)", lineHeight: 1.6 }}>
                Call <code className="docs-inline-code">POST /export/s3</code> with your bucket credentials. Processed media drops straight into your company&apos;s AWS S3 or MinIO cloud bucket without any manual download steps.
              </p>
            </div>
          </div>
        </div>

        {/* Rate Limits Grid */}
        <div style={{ marginBottom: 48 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--color-fg)", marginBottom: 16 }}>
            Rate Limits & Plan Tiers
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            {RATES.map((r) => (
              <div key={r.tier} className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-fg)" }}>{r.tier}</div>
                <div style={{ fontSize: 16, fontWeight: 900, color: "var(--color-signal)", margin: "6px 0 4px" }}>{r.limit}</div>
                {r.note && <div style={{ fontSize: 11, color: "var(--color-fg-3)" }}>{r.note}</div>}
              </div>
            ))}
          </div>
        </div>

        {/* Endpoints Accordion */}
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--color-fg)", marginBottom: 16 }}>
            API Endpoints Reference
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {ENDPOINTS.map((ep, idx) => {
              const isOpen = openIndex === idx;
              const mc = MC[ep.method] ?? { bg: "var(--color-surface-2)", color: "var(--color-fg)" };

              return (
                <div key={ep.path} className="card" style={{ overflow: "hidden" }}>
                  <button
                    onClick={() => setOpenIndex(isOpen ? null : idx)}
                    className="docs-endpoint-btn"
                    style={{
                      width: "100%",
                      padding: "16px 20px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: "transparent",
                      border: "none",
                      color: "inherit",
                      cursor: "pointer",
                      textAlign: "left"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <span style={{
                        fontSize: 11,
                        fontWeight: 900,
                        padding: "3px 8px",
                        borderRadius: 6,
                        background: mc.bg,
                        color: mc.color,
                        letterSpacing: "0.04em"
                      }}>
                        {ep.method}
                      </span>
                      <code style={{ fontSize: 15, fontWeight: 800, color: "var(--color-fg)", fontFamily: "monospace" }}>{ep.path}</code>
                      {ep.title && (
                        <span style={{ fontSize: 13, color: "var(--color-fg-3)", fontWeight: 500 }}>
                          — {ep.title}
                        </span>
                      )}
                    </div>

                    <span style={{ fontSize: 16, color: "var(--color-fg-3)", fontWeight: 700, marginLeft: 12 }}>
                      {isOpen ? "−" : "+"}
                    </span>
                  </button>

                  {isOpen && (
                    <div style={{
                      padding: "0 20px 20px",
                      borderTop: "1px solid var(--color-surface-2)",
                      paddingTop: 16,
                      display: "flex",
                      flexDirection: "column",
                      gap: 16
                    }}>
                      <p style={{ fontSize: 14, color: "var(--color-fg-2)", lineHeight: 1.6 }}>
                        {ep.desc}
                      </p>

                      {ep.req && (
                        <div>
                          <div className="label" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-fg-3)", marginBottom: 8 }}>
                            Request Payload / Format
                          </div>
                          <CodeBlock code={ep.req} />
                        </div>
                      )}

                      {ep.res && (
                        <div>
                          <div className="label" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-fg-3)", marginBottom: 8 }}>
                            Response Payload
                          </div>
                          <CodeBlock code={ep.res} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

      </main>

      <Footer />
    </div>
  );
}
