"use client";

import { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:8080";

const MC: Record<string, string> = { GET: "#10b981", POST: "#ffffff", DELETE: "#ef4444" };

const ENDPOINTS = [
  {
    method: "POST",
    path: "/ingest",
    auth: "optional",
    desc: "Upload raw file bytes. Auto-remuxes .mov/.avi/.mkv -> .mp4. Returns server path for use with /analyze and /upload.",
    headers: [
      { k: "x-file-name", v: "video.mp4", req: true },
      { k: "x-api-key", v: "vp_...", req: false },
    ],
    req: "Binary file payload",
    res: `{ "path": "/tmp/vidpress_output/abc_video.mp4" }`,
  },
  {
    method: "POST",
    path: "/analyze",
    auth: "optional",
    desc: "Analyze media file - returns codec, dimensions, duration, available output formats, and compression estimates.",
    req: `{ "path": "/tmp/vidpress_output/abc_video.mp4" }`,
    res: `{ "kind": "video", "codec_name": "h264", "duration_secs": 138.3,\n  "size_bytes": 408449822, "width": 3840, "height": 2160,\n  "output_ext": "mp4", "available_formats": ["mp4","mov","mkv","webm","avi"],\n  "estimated_output_mb": 38.9, "estimated_time_secs": 207 }`,
  },
  {
    method: "POST",
    path: "/upload",
    auth: "optional",
    desc: "Queue a compression job. Returns immediately with job_id. Webhooks send completion callbacks.",
    req: `{ "path": "/tmp/...",\n  "preset": "web",\n  "output_format": "mp4",\n  "webhook_url": "https://yourapp.com/hook" }`,
    res: `{ "job_id": "uuid", "status": "queued", "estimated_time_secs": 207 }`,
  },
  {
    method: "GET",
    path: "/jobs/:id",
    auth: "optional",
    desc: "Poll job status. Poll every 1-2s until status is 'done' or 'failed'.",
    res: `{ "id": "uuid", "status": "done", "progress": 100,\n  "original_bytes": 408449822, "compressed_bytes": 46124172,\n  "duration_secs": 138.3, "eta_secs": 0 }`,
  },
  {
    method: "GET",
    path: "/download/:id",
    auth: "optional",
    desc: "Stream the compressed output file. Only works when job status is 'done'.",
    res: "Binary media stream (video/mp4, audio/mp3, image/webp)",
  },
  {
    method: "POST",
    path: "/download-url",
    auth: "required",
    desc: "Download video or audio from YouTube, Instagram, TikTok, X (Twitter), or Facebook. Returns job_id.",
    req: `{ "url": "https://youtu.be/6fGaxufI0kc",\n  "audio_only": false,\n  "webhook_url": "https://yourapp.com/hook" }`,
    res: `{ "job_id": "uuid", "status": "queued" }`,
  },
  {
    method: "POST",
    path: "/transcribe",
    auth: "required",
    desc: "Transcribe audio/video to text using OpenAI Whisper model.",
    req: `{ "job_id": "uuid" }`,
    res: `{ "id": "uuid", "text": "Transcription payload...", "model": "medium" }`,
  },
  {
    method: "POST",
    path: "/keys",
    auth: "none",
    desc: "Create an API key programmatically.",
    req: `{ "name": "My App", "plan": "premium",\n  "webhook_url": "https://yourapp.com/hook" }`,
    res: `{ "key": "vp_ABC123...", "name": "My App", "plan": "premium" }`,
  },
];

const RATES = [
  { tier: "Anonymous", limit: "10 / min", note: "Per IP rate limit" },
  { tier: "Free Sandbox", limit: "60 / min", note: "API key issued" },
  { tier: "Pro Membership", limit: "300 / min", note: "Priority queue" },
  { tier: "API Starter", limit: "120 / min", note: "Webhooks HMAC" },
  { tier: "API Growth", limit: "600 / min", note: "Dedicated worker" },
  { tier: "API Scale", limit: "3,000 / min", note: "SLA Guaranteed" },
];

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <pre style={{ background: "#000000", border: "1px solid #27272a", borderRadius: 8, padding: "12px 14px", fontSize: 12, overflowX: "auto", color: "#f4f4f5", fontFamily: "monospace" }}>
        <code>{code}</code>
      </pre>
      <button
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        style={{ position: "absolute", top: 8, right: 8, padding: "3px 8px", borderRadius: 4, border: "1px solid #27272a", background: "#18181b", color: "#a1a1aa", fontSize: 10, cursor: "pointer" }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export default function DocsPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#000000" }}>
      <Navbar />

      <main style={{ flex: 1, maxWidth: 1000, width: "100%", margin: "0 auto", padding: "60px 20px 80px" }}>
        
        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 9999, background: "#18181b", border: "1px solid #27272a", fontSize: 11, fontWeight: 700, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 12 }}>
            Developer Documentation
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: "-1px", color: "#ffffff", marginBottom: 8 }}>
            theflate API Reference
          </h1>
          <p style={{ fontSize: 14, color: "#a1a1aa", maxWidth: 640 }}>
            Programmatic media compression, format conversion, link extraction, and OpenAI Whisper transcription endpoints.
          </p>
        </div>

        {/* Base URL Box */}
        <div style={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 10, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 40, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: "#71717a", textTransform: "uppercase", fontWeight: 700, marginBottom: 2 }}>Base Endpoint</div>
            <code style={{ fontSize: 14, color: "#ffffff", fontWeight: 700, fontFamily: "monospace" }}>{BASE}</code>
          </div>
          <div style={{ fontSize: 12, color: "#a1a1aa" }}>
            Pass header: <code style={{ background: "#18181b", padding: "2px 8px", borderRadius: 4, color: "#ffffff" }}>x-api-key: vp_YOUR_KEY</code>
          </div>
        </div>

        {/* Rate Limits Grid */}
        <div style={{ marginBottom: 48 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: "#ffffff", marginBottom: 14 }}>Rate Limits & Tiers</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            {RATES.map((r) => (
              <div key={r.tier} style={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#ffffff" }}>{r.tier}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#10b981", margin: "4px 0" }}>{r.limit}</div>
                {r.note && <div style={{ fontSize: 10, color: "#71717a" }}>{r.note}</div>}
              </div>
            ))}
          </div>
        </div>

        {/* Endpoints List */}
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: "#ffffff", marginBottom: 16 }}>API Endpoints</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {ENDPOINTS.map((ep, idx) => {
              const isOpen = openIndex === idx;
              return (
                <div key={ep.path} style={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 10, overflow: "hidden" }}>
                  <button
                    onClick={() => setOpenIndex(isOpen ? null : idx)}
                    style={{ width: "100%", padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 11, fontWeight: 900, color: MC[ep.method], background: "#18181b", padding: "2px 8px", borderRadius: 4, border: "1px solid #27272a" }}>
                        {ep.method}
                      </span>
                      <code style={{ fontSize: 14, fontWeight: 700, color: "#ffffff" }}>{ep.path}</code>
                    </div>
                    <span style={{ fontSize: 12, color: "#71717a" }}>{isOpen ? "−" : "+"}</span>
                  </button>

                  {isOpen && (
                    <div style={{ padding: "0 18px 18px", borderTop: "1px solid #18181b", paddingTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
                      <p style={{ fontSize: 13, color: "#a1a1aa" }}>{ep.desc}</p>
                      
                      {ep.req && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#71717a", textTransform: "uppercase", marginBottom: 6 }}>Request Format</div>
                          <CodeBlock code={ep.req} />
                        </div>
                      )}

                      {ep.res && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#71717a", textTransform: "uppercase", marginBottom: 6 }}>Response Payload</div>
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
