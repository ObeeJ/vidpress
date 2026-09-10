"use client";

import { useEffect, useRef, useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Wordmark from "@/components/Wordmark";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.theflate.com";

type CodeLang = "curl" | "node" | "python" | "go";
type Workflow = "submit" | "webhook" | "export";

const SECTIONS = [
  { id: "quickstart", num: "01", label: "Quickstart" },
  { id: "delivery", num: "02", label: "Delivery" },
  { id: "examples", num: "03", label: "Examples" },
  { id: "limits", num: "04", label: "Rate limits" },
  { id: "endpoints", num: "05", label: "Endpoints" },
  { id: "status", num: "06", label: "Status codes" },
];

const CODE: Record<CodeLang, { label: string } & Record<Workflow, string>> = {
  curl: {
    label: "cURL",
    submit: `# 1. Stream the raw bytes in — returns an ingest_id.
INGEST=$(curl -s -X POST "${BASE}/ingest" \\
  -H "x-file-name: input_video.mp4" \\
  -H "x-api-key: vp_YOUR_API_KEY" \\
  --data-binary @input_video.mp4)

ID=$(echo "$INGEST" | jq -r .ingest_id)

# 2. Queue the job against that ingest_id.
curl -X POST "${BASE}/upload" \\
  -H "x-api-key: vp_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d "{
    \\"ingest_id\\": \\"$ID\\",
    \\"target_mb\\": 50,
    \\"output_format\\": \\"mp4\\",
    \\"webhook_url\\": \\"https://api.yourapp.com/hooks/theflate\\"
  }"`,
    webhook: `# theflate signs every webhook it sends:
#   X-Theflate-Signature: t=1773317337,v1=5d41402abc4b2a76...
#
# The signed message is "{timestamp}.{raw_body}", HMAC-SHA256 with your key.
# Always compare in constant time, and reject stale timestamps.

# Express handler:
app.post("/hooks/theflate", (req, res) => {
  const { job_id, status, compressed_bytes } = req.body;
  if (status === "done") {
    console.log(\`\${job_id} ready — \${compressed_bytes} bytes\`);
  }
  res.sendStatus(200);
});`,
    export: `# Destinations are attached when the job is QUEUED, not at export time.
curl -X POST "${BASE}/upload" \\
  -H "x-api-key: vp_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "ingest_id": "ing_8f291a0c",
    "target_mb": 50,
    "destination": {
      "provider": "s3",
      "bucket": "acme-media-assets",
      "region": "us-east-1",
      "endpoint": "https://s3.amazonaws.com",
      "target_path": "compressed/video.mp4",
      "access_key": "AKIA...",
      "secret_key": "SECRET..."
    }
  }'

# Then push it once the job is done:
curl -X POST "${BASE}/export" \\
  -H "x-api-key: vp_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "job_id": "job_8f291a0c", "provider": "s3" }'`,
  },

  node: {
    label: "Node",
    submit: `import fs from "node:fs";

const KEY = process.env.THEFLATE_API_KEY!;

// 1. Raw bytes in — the body IS the file, not multipart form data.
const ingestRes = await fetch("${BASE}/ingest", {
  method: "POST",
  headers: { "x-file-name": "input_video.mp4", "x-api-key": KEY },
  body: fs.createReadStream("input_video.mp4"),
  duplex: "half",
});
const { ingest_id } = await ingestRes.json();

// 2. Queue against that id.
const jobRes = await fetch("${BASE}/upload", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-api-key": KEY },
  body: JSON.stringify({
    ingest_id,
    target_mb: 50,
    output_format: "mp4",
    webhook_url: "https://api.yourapp.com/hooks/theflate",
  }),
});

const job = await jobRes.json(); // { job_id, status, estimated_time_secs }`,
    webhook: `import crypto from "node:crypto";

// The signed message is \`\${timestamp}.\${rawBody}\` — pass the RAW body,
// not the parsed object, or the digest will never match.
export function verify(rawBody: string, header: string, secret: string) {
  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.split("=") as [string, string]),
  );
  const { t: timestamp, v1: signature } = parts;

  // Reject replays before spending time on the digest.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest("hex");

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}`,
    export: `const KEY = process.env.THEFLATE_API_KEY!;

// Attach the destination when queueing the job.
await fetch("${BASE}/upload", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-api-key": KEY },
  body: JSON.stringify({
    ingest_id,
    target_mb: 50,
    destination: {
      provider: "s3", // s3 | r2 | b2 | supabase
      bucket: "acme-media-assets",
      region: "us-east-1",
      target_path: \`exports/\${ingest_id}.mp4\`,
      access_key: process.env.AWS_ACCESS_KEY_ID,
      secret_key: process.env.AWS_SECRET_ACCESS_KEY,
    },
  }),
});

// Push it to the bucket once the job reports "done".
const res = await fetch("${BASE}/export", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-api-key": KEY },
  body: JSON.stringify({ job_id, provider: "s3" }),
});

const { remote_url } = await res.json();`,
  },

  python: {
    label: "Python",
    submit: `import os, requests

KEY = os.environ["THEFLATE_API_KEY"]
BASE = "${BASE}"

# 1. Raw bytes in — data=, not files=.
with open("input_video.mp4", "rb") as f:
    ingest = requests.post(
        f"{BASE}/ingest",
        headers={"x-file-name": "input_video.mp4", "x-api-key": KEY},
        data=f,
    ).json()

# 2. Queue against that id.
job = requests.post(
    f"{BASE}/upload",
    headers={"x-api-key": KEY},
    json={
        "ingest_id": ingest["ingest_id"],
        "target_mb": 50,
        "output_format": "mp4",
        "webhook_url": "https://api.yourapp.com/hooks/theflate",
    },
).json()

print(job)  # {"job_id": ..., "status": ..., "estimated_time_secs": ...}`,
    webhook: `import hmac, hashlib, time

def verify(raw_body: bytes, sig_header: str, secret: str) -> bool:
    """raw_body must be the unparsed request body, byte for byte."""
    parts = dict(kv.split("=", 1) for kv in sig_header.split(","))
    timestamp, signature = parts.get("t", ""), parts.get("v1", "")

    # Reject replays before spending time on the digest.
    if not timestamp or abs(time.time() - int(timestamp)) > 300:
        return False

    msg = f"{timestamp}.".encode() + raw_body
    expected = hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)`,
    export: `import os, requests

KEY = os.environ["THEFLATE_API_KEY"]
BASE = "${BASE}"

# Attach the destination when queueing the job.
requests.post(
    f"{BASE}/upload",
    headers={"x-api-key": KEY},
    json={
        "ingest_id": ingest_id,
        "target_mb": 50,
        "destination": {
            "provider": "s3",  # s3 | r2 | b2 | supabase
            "bucket": "acme-media-assets",
            "region": "us-east-1",
            "target_path": f"exports/{ingest_id}.mp4",
            "access_key": os.environ["AWS_ACCESS_KEY_ID"],
            "secret_key": os.environ["AWS_SECRET_ACCESS_KEY"],
        },
    },
)

# Push it to the bucket once the job reports "done".
res = requests.post(
    f"{BASE}/export",
    headers={"x-api-key": KEY},
    json={"job_id": job_id, "provider": "s3"},
).json()

print(res["remote_url"])`,
  },

  go: {
    label: "Go",
    submit: `package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
)

const base = "${BASE}"

func submit(path string) (map[string]any, error) {
	key := os.Getenv("THEFLATE_API_KEY")

	// 1. Raw bytes in — the body IS the file.
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	req, _ := http.NewRequest("POST", base+"/ingest", f)
	req.Header.Set("x-file-name", "input_video.mp4")
	req.Header.Set("x-api-key", key)

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	var ingest struct {
		IngestID string \`json:"ingest_id"\`
	}
	if err := json.NewDecoder(res.Body).Decode(&ingest); err != nil {
		return nil, err
	}

	// 2. Queue against that id.
	payload, _ := json.Marshal(map[string]any{
		"ingest_id":     ingest.IngestID,
		"target_mb":     50,
		"output_format": "mp4",
	})

	jobReq, _ := http.NewRequest("POST", base+"/upload", bytes.NewReader(payload))
	jobReq.Header.Set("Content-Type", "application/json")
	jobReq.Header.Set("x-api-key", key)

	jobRes, err := http.DefaultClient.Do(jobReq)
	if err != nil {
		return nil, err
	}
	defer jobRes.Body.Close()

	var job map[string]any
	err = json.NewDecoder(jobRes.Body).Decode(&job)
	return job, err
}`,
    webhook: `package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"strconv"
	"strings"
	"time"
)

// rawBody must be the unparsed request body, byte for byte.
func verify(rawBody []byte, header, secret string) bool {
	var timestamp, signature string
	for _, kv := range strings.Split(header, ",") {
		k, v, _ := strings.Cut(kv, "=")
		switch k {
		case "t":
			timestamp = v
		case "v1":
			signature = v
		}
	}

	// Reject replays before spending time on the digest.
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || math.Abs(float64(time.Now().Unix()-ts)) > 300 {
		return false
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "."))
	mac.Write(rawBody)
	expected := hex.EncodeToString(mac.Sum(nil))

	return hmac.Equal([]byte(signature), []byte(expected))
}`,
    export: `package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
)

// Push a finished job to its configured destination. The bucket and
// credentials were attached to the job at /upload time.
func export(jobID string) (string, error) {
	payload, _ := json.Marshal(map[string]string{
		"job_id":   jobID,
		"provider": "s3", // s3 | r2 | b2 | supabase
	})

	req, _ := http.NewRequest("POST", base+"/export", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", os.Getenv("THEFLATE_API_KEY"))

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()

	var out struct {
		RemoteURL string \`json:"remote_url"\`
	}
	err = json.NewDecoder(res.Body).Decode(&out)
	return out.RemoteURL, err
}`,
  },
};

type Endpoint = {
  category: string;
  method: string;
  path: string;
  auth: "none" | "optional" | "required" | "admin";
  title: string;
  desc: string;
  req?: string;
  res?: string;
};

const ENDPOINTS: Endpoint[] = [
  {
    category: "ingest",
    method: "POST",
    path: "/ingest",
    auth: "optional",
    title: "Stream raw file bytes",
    desc: "Send the file as the raw request body — not multipart form data. MOV, AVI and MKV containers are remuxed to MP4 on the way in. Returns the ingest_id that every downstream call takes.",
    req: `Headers:
  x-file-name: video.mp4      (required)
  x-api-key:   vp_...         (optional)

Body: the raw file bytes`,
    res: `{ "ingest_id": "ing_8f291a0c" }`,
  },
  {
    category: "ingest",
    method: "POST",
    path: "/analyze",
    auth: "optional",
    title: "Probe stream metadata",
    desc: "Runs ffprobe against an ingested file and returns codecs, resolution, duration, the output formats it can be converted to, and an estimated compressed size you can seed a target_mb slider with.",
    req: `{ "ingest_id": "ing_8f291a0c" }`,
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
  "estimated_time_secs": 18
}`,
  },
  {
    category: "ingest",
    method: "POST",
    path: "/upload",
    auth: "optional",
    title: "Queue a compression job",
    desc: "Queues the actual encode. Give it a target_mb and it runs a two-pass libx265 encode to hit that size; if the target is too small to carry the source resolution, it scales the video down rather than returning a full-resolution smear. Attach a destination here — /export reads it later.",
    req: `{
  "ingest_id": "ing_8f291a0c",
  "target_mb": 50,
  "preset": "web",
  "output_format": "mp4",
  "webhook_url": "https://api.yourapp.com/hooks/theflate",
  "destination": { "provider": "s3", "bucket": "..." }
}`,
    res: `{
  "job_id": "job_8f291a0c",
  "status": "queued",
  "estimated_time_secs": 18
}`,
  },
  {
    category: "ingest",
    method: "GET",
    path: "/jobs/:id",
    auth: "optional",
    title: "Poll job status",
    desc: "Returns progress from 0-100, an ETA, and the original vs compressed byte counts. Poll this until status is \"done\" or \"failed\" — or skip polling entirely and use a webhook.",
    res: `{
  "id": "job_8f291a0c",
  "status": "done",
  "progress": 100,
  "original_bytes": 408449822,
  "compressed_bytes": 51200000,
  "duration_secs": 138.3,
  "download_url": "${BASE}/download/job_8f291a0c"
}`,
  },
  {
    category: "ingest",
    method: "GET",
    path: "/download/:id",
    auth: "optional",
    title: "Stream the output",
    desc: "Returns the finished file. Supports HTTP range requests, so you can point a video element straight at it and seek without downloading the whole file.",
    res: `Binary stream (video/mp4, audio/mpeg, image/webp)`,
  },
  {
    category: "ingest",
    method: "GET",
    path: "/preview/:id",
    auth: "optional",
    title: "Fetch a preview frame",
    desc: "A single representative frame from the output, for thumbnails and before/after comparisons.",
    res: `Binary image stream`,
  },
  {
    category: "ingest",
    method: "POST",
    path: "/download-url",
    auth: "required",
    title: "Pull from a social link",
    desc: "Fetches media straight onto the processing server from YouTube, TikTok, Instagram, X or Facebook. Set audio_only to skip the video stream entirely.",
    req: `{
  "url": "https://youtu.be/dQw4w9WgXcQ",
  "audio_only": false,
  "webhook_url": "https://api.yourapp.com/hooks/theflate"
}`,
    res: `{ "job_id": "job_99a8b1c", "status": "queued" }`,
  },
  {
    category: "ai",
    method: "POST",
    path: "/transcribe",
    auth: "required",
    title: "Transcribe speech to text",
    desc: "Runs Whisper large-v3 locally against a finished job. Returns immediately with a transcription_id — transcription runs in the background, so poll /transcriptions/:id for the text.",
    req: `{ "job_id": "job_8f291a0c" }`,
    res: `202 Accepted

{ "transcription_id": "txn_4c1d", "status": "queued" }`,
  },
  {
    category: "ai",
    method: "GET",
    path: "/transcriptions/:id",
    auth: "optional",
    title: "Fetch a transcript",
    desc: "Poll until status is \"done\". While it is still \"queued\" or \"processing\", text is an empty string.",
    res: `{
  "id": "txn_4c1d",
  "job_id": "job_8f291a0c",
  "text": "Full transcribed text...",
  "status": "done"
}`,
  },
  {
    category: "export",
    method: "POST",
    path: "/export",
    auth: "required",
    title: "Push to your bucket",
    desc: "Streams a finished job straight into the destination that was attached at /upload time — the file never round-trips through your server. Returns 409 if the job has not finished, and 400 if no destination was configured for it.",
    req: `{
  "job_id": "job_8f291a0c",
  "provider": "s3"
}`,
    res: `{
  "status": "exported",
  "remote_url": "https://s3.amazonaws.com/acme-media/exports/video.mp4"
}`,
  },
  {
    category: "keys",
    method: "POST",
    path: "/keys",
    auth: "admin",
    title: "Provision an API key",
    desc: "Mints a key against a plan tier. Requires the x-admin-token header — this is a server-operator endpoint, not a self-service signup route, and returns 403 without it. The plaintext key is shown exactly once and is unrecoverable afterwards.",
    req: `Headers:
  x-admin-token: <server operator token>

{
  "name": "Acme Production",
  "plan": "api_growth",
  "webhook_url": "https://api.yourapp.com/hooks/theflate"
}`,
    res: `{
  "key": "vp_9F8E7D6C5B4A32109F8E7D6C5B4A3210",
  "name": "Acme Production",
  "plan": "api_growth"
}`,
  },
  {
    category: "keys",
    method: "GET",
    path: "/health",
    auth: "none",
    title: "Liveness probe",
    desc: "Unauthenticated readiness check for load balancers and uptime monitors.",
    res: `{ "status": "ok" }`,
  },
];

const CATEGORIES = [
  { id: "all", label: "ALL" },
  { id: "ingest", label: "INGEST" },
  { id: "ai", label: "TRANSCRIPTION" },
  { id: "export", label: "EXPORT" },
  { id: "keys", label: "KEYS" },
];

const RATES = [
  { tier: "Anonymous", limit: "10", note: "per IP" },
  { tier: "Free", limit: "60", note: "key issued" },
  { tier: "Premium", limit: "300", note: "priority queue" },
  { tier: "API Starter", limit: "120", note: "signed webhooks" },
  { tier: "API Growth", limit: "600", note: "dedicated worker" },
  { tier: "API Scale", limit: "3,000", note: "guaranteed SLA" },
];

const STATUS_CODES = [
  { code: "200", ok: true, desc: "Success. The body carries the job, status, or file stream." },
  { code: "202", ok: true, desc: "Accepted and queued. Used by /transcribe, which finishes in the background." },
  { code: "400", ok: false, desc: "Malformed JSON, or a required field like ingest_id or job_id is missing." },
  { code: "401", ok: false, desc: "The x-api-key header is missing or does not match a known key." },
  { code: "403", ok: false, desc: "Admin-only route reached without a valid x-admin-token." },
  { code: "404", ok: false, desc: "No job, transcription, or ingest exists with that id for this caller." },
  { code: "409", ok: false, desc: "The job exists but has not finished yet — wait for status \"done\"." },
  { code: "413", ok: false, desc: "The uploaded file is larger than the server's configured body limit." },
  { code: "415", ok: false, desc: "The file type is not a supported video, audio, or image container." },
  { code: "429", ok: false, desc: "Rate limit exhausted for your IP or key tier. Back off and retry." },
  { code: "500", ok: false, desc: "ffmpeg or the underlying pipeline failed while processing." },
];

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Without this, copying and then unmounting sets state on a dead component.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <div className="docs-code-wrap">
      <pre className="docs-code-block"><code>{code}</code></pre>
      <button
        type="button"
        className="docs-copy-btn"
        data-copied={copied}
        aria-label="Copy code"
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "COPIED" : "COPY"}
      </button>
    </div>
  );
}

function SectionHead({ num, title, id }: { num: string; title: string; id: string }) {
  return (
    <div className="docs-section-head">
      <span className="docs-section-num">{num}</span>
      <h2 className="docs-section-title" id={`${id}-title`}>{title}</h2>
      <span className="docs-section-rule" aria-hidden="true" />
    </div>
  );
}

export default function DocsPage() {
  const [lang, setLang] = useState<CodeLang>("curl");
  const [workflow, setWorkflow] = useState<Workflow>("submit");
  const [category, setCategory] = useState("all");
  const [openPath, setOpenPath] = useState<string | null>("/upload");
  const [activeSection, setActiveSection] = useState("quickstart");
  const [baseCopied, setBaseCopied] = useState(false);
  const baseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (baseTimer.current) clearTimeout(baseTimer.current); }, []);

  // Scrollspy: highlight whichever section currently leads the viewport.
  // rootMargin pins the trigger line near the top so a section becomes active
  // once it leads, not once it fills the screen.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const leading = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (leading) setActiveSection(leading.target.id);
      },
      { rootMargin: "-8% 0px -75% 0px", threshold: 0 },
    );

    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const visibleEndpoints = ENDPOINTS.filter(
    (ep) => category === "all" || ep.category === category,
  );

  return (
    <div className="page-shell">
      <Navbar />

      <div className="docs-layout">
        <nav className="docs-rail" aria-label="Documentation sections">
          <div className="docs-rail-heading">Reference</div>
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="docs-rail-link"
              data-active={activeSection === s.id}
              aria-current={activeSection === s.id ? "true" : undefined}
            >
              <span className="docs-rail-num">{s.num}</span>
              {s.label}
            </a>
          ))}
        </nav>

        <main className="docs-main">
          <header>
            <h1 className="docs-title">
              Build on <Wordmark />
            </h1>
            <p className="docs-lede">
              Target-size video and audio compression, speech-to-text, and direct
              cloud delivery — over plain HTTP and JSON. No SDK required.
            </p>

            <div className="docs-basebar">
              <div className="docs-base-field">
                <span className="docs-field-label">Base URL</span>
                <span className="docs-base-url">
                  {BASE}
                  <button
                    type="button"
                    className="docs-copy-btn docs-copy-btn-static"
                    data-copied={baseCopied}
                    aria-label="Copy base URL"
                    onClick={() => {
                      navigator.clipboard.writeText(BASE);
                      setBaseCopied(true);
                      if (baseTimer.current) clearTimeout(baseTimer.current);
                      baseTimer.current = setTimeout(() => setBaseCopied(false), 1500);
                    }}
                  >
                    {baseCopied ? "COPIED" : "COPY"}
                  </button>
                </span>
              </div>

              <div className="docs-auth-chip">
                <span>auth</span>
                <strong>x-api-key: vp_…</strong>
              </div>
            </div>
          </header>

          {/* 01 — Quickstart */}
          <section className="docs-section" id="quickstart" aria-labelledby="quickstart-title">
            <SectionHead num="01" title="Quickstart" id="quickstart" />
            <div className="docs-steps">
              <div className="docs-step">
                <div className="docs-step-num">Step 01</div>
                <h3 className="docs-step-title">Send the bytes</h3>
                <p className="docs-step-body">
                  <code className="docs-inline-code">POST /ingest</code> with the file as
                  the raw body and an <code className="docs-inline-code">x-file-name</code>{" "}
                  header. You get back an{" "}
                  <code className="docs-inline-code">ingest_id</code>.
                </p>
              </div>

              <div className="docs-step">
                <div className="docs-step-num">Step 02</div>
                <h3 className="docs-step-title">Queue the encode</h3>
                <p className="docs-step-body">
                  <code className="docs-inline-code">POST /upload</code> with that id and a{" "}
                  <code className="docs-inline-code">target_mb</code>. Two-pass encoding
                  works out the bitrate needed to land on your number.
                </p>
              </div>

              <div className="docs-step">
                <div className="docs-step-num">Step 03</div>
                <h3 className="docs-step-title">Collect the result</h3>
                <p className="docs-step-body">
                  Poll <code className="docs-inline-code">GET /jobs/:id</code>, or let a
                  webhook tell you. Add a destination and the file lands in your bucket
                  without touching your server.
                </p>
              </div>
            </div>
          </section>

          {/* 02 — Delivery */}
          <section className="docs-section" id="delivery" aria-labelledby="delivery-title">
            <SectionHead num="02" title="Getting the file back" id="delivery" />
            <div className="docs-steps">
              <div className="docs-step">
                <div className="docs-step-num">Option A · Webhooks</div>
                <h3 className="docs-step-title">Push on completion</h3>
                <p className="docs-step-body">
                  Pass a <code className="docs-inline-code">webhook_url</code> when you
                  queue the job and theflate POSTs to it the moment encoding finishes —
                  signed with HMAC-SHA256 over{" "}
                  <code className="docs-inline-code">{"{timestamp}.{body}"}</code> so you
                  can verify it really came from us. Beats polling for anything longer
                  than a few seconds.
                </p>
              </div>

              <div className="docs-step">
                <div className="docs-step-num">Option B · Destinations</div>
                <h3 className="docs-step-title">Straight to your bucket</h3>
                <p className="docs-step-body">
                  Attach a <code className="docs-inline-code">destination</code> at{" "}
                  <code className="docs-inline-code">/upload</code>, then call{" "}
                  <code className="docs-inline-code">/export</code> once the job is done.
                  Works with S3, Cloudflare R2, Backblaze B2 and Supabase Storage. Your
                  credentials are used for the transfer and are never persisted.
                </p>
              </div>
            </div>
          </section>

          {/* 03 — Examples */}
          <section className="docs-section" id="examples" aria-labelledby="examples-title">
            <SectionHead num="03" title="Examples" id="examples" />

            <div className="docs-panel">
              <div className="docs-panel-bar">
                <div className="docs-segmented" role="tablist" aria-label="Workflow">
                  {([
                    ["submit", "SUBMIT A JOB"],
                    ["webhook", "VERIFY WEBHOOK"],
                    ["export", "EXPORT TO CLOUD"],
                  ] as [Workflow, string][]).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={workflow === id}
                      className="docs-segment"
                      data-primary="true"
                      data-selected={workflow === id}
                      onClick={() => setWorkflow(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="docs-segmented" role="tablist" aria-label="Language">
                  {(Object.keys(CODE) as CodeLang[]).map((l) => (
                    <button
                      key={l}
                      type="button"
                      role="tab"
                      aria-selected={lang === l}
                      className="docs-segment"
                      data-selected={lang === l}
                      onClick={() => setLang(l)}
                    >
                      {CODE[l].label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="docs-panel-body">
                <CodeBlock code={CODE[lang][workflow]} />
              </div>
            </div>
          </section>

          {/* 04 — Rate limits */}
          <section className="docs-section" id="limits" aria-labelledby="limits-title">
            <SectionHead num="04" title="Rate limits" id="limits" />
            <p className="docs-notice">
              Every tier below is <strong>free while theflate is in preview</strong> —
              there is no billing and nothing to buy yet. The limits are here so you
              can see the shape of things; the paid tiers switch on later.
            </p>
            <div className="docs-rate-grid">
              {RATES.map((r) => (
                <div key={r.tier} className="docs-rate">
                  <div className="docs-rate-tier">{r.tier}</div>
                  <div className="docs-rate-limit">
                    {r.limit}
                    <span className="docs-rate-unit"> req/min</span>
                  </div>
                  <div className="docs-rate-note">{r.note}</div>
                </div>
              ))}
            </div>
          </section>

          {/* 05 — Endpoints */}
          <section className="docs-section" id="endpoints" aria-labelledby="endpoints-title">
            <SectionHead num="05" title="Endpoints" id="endpoints" />

            <div className="docs-filter-row">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="docs-pill"
                  data-selected={category === c.id}
                  aria-pressed={category === c.id}
                  onClick={() => setCategory(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="docs-ep-list">
              {visibleEndpoints.map((ep, i) => {
                const isOpen = openPath === ep.path;
                return (
                  <div
                    key={ep.path}
                    className="docs-ep"
                    data-open={isOpen}
                    style={{ "--i": i } as React.CSSProperties}
                  >
                    <button
                      type="button"
                      className="docs-ep-head"
                      aria-expanded={isOpen}
                      onClick={() => setOpenPath(isOpen ? null : ep.path)}
                    >
                      <span className="docs-ep-method" data-method={ep.method}>
                        {ep.method}
                      </span>
                      <code className="docs-ep-path">{ep.path}</code>
                      <span className="docs-ep-title">{ep.title}</span>
                      <span className="docs-ep-auth" data-auth={ep.auth}>
                        {ep.auth}
                      </span>
                      <span className="docs-ep-toggle" aria-hidden="true">
                        {isOpen ? "−" : "+"}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="docs-ep-body">
                        <p className="docs-ep-desc">{ep.desc}</p>

                        {ep.req && (
                          <div>
                            <div className="docs-field-label">Request</div>
                            <CodeBlock code={ep.req} />
                          </div>
                        )}

                        {ep.res && (
                          <div>
                            <div className="docs-field-label">Response</div>
                            <CodeBlock code={ep.res} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 06 — Status codes */}
          <section className="docs-section" id="status" aria-labelledby="status-title">
            <SectionHead num="06" title="Status codes" id="status" />
            <div className="docs-err-grid">
              {STATUS_CODES.map((s) => (
                <div key={s.code} className="docs-err" data-ok={s.ok}>
                  <span className="docs-err-code">{s.code}</span>
                  <span className="docs-err-desc">{s.desc}</span>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>

      <Footer />
    </div>
  );
}
