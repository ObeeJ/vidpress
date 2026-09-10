"use client";

import { useState } from "react";

interface PoemFaqProps {
  showTitle?: boolean;
}

const FAQS = [
  {
    id: "what-is",
    category: "General",
    question: "What exactly does theflate do?",
    content: (
      <p className="pf-muted-body">
        theflate compresses, converts, and transcribes media files: video, audio, and images. Drop a file, pick your output format or preset, and get a smaller file back in seconds. You can also pull video or audio directly from a YouTube, Instagram, TikTok, X, or Facebook link without downloading anything first.
      </p>
    ),
  },
  {
    id: "formats",
    category: "Formats & Codecs",
    question: "Which formats and codecs are supported?",
    content: (
      <div className="pf-muted-body pf-content-body">
        <div><strong>Video:</strong> MP4, MOV, MKV, WebM, AVI, encoded with H.264 or H.265/HEVC</div>
        <div><strong>Audio:</strong> MP3, AAC, M4A, WAV, FLAC, OGG</div>
        <div><strong>Images:</strong> JPG, PNG, WebP, GIF</div>
        <div><strong>Transcription:</strong> Any video or audio file → plain text via OpenAI Whisper</div>
      </div>
    ),
  },
  {
    id: "quality",
    category: "Compression",
    question: "How much smaller will my file get?",
    content: (
      <p className="pf-muted-body">
        Typical results are 60–90% smaller depending on the source. A raw 4K recording shot on an iPhone can go from 400MB down to under 50MB with no visible quality difference at normal viewing sizes. The Web preset targets a balanced quality-to-size ratio; the Original preset preserves quality at the cost of a smaller size reduction.
      </p>
    ),
  },
  {
    id: "privacy",
    category: "Privacy",
    question: "What happens to my files after processing?",
    content: (
      <p className="pf-muted-body">
        Files are stored in isolated temporary directories and automatically deleted after 24 hours. We do not inspect, index, or retain your media. No file content is ever used for advertising or model training.
      </p>
    ),
  },
  {
    id: "api",
    category: "API",
    question: "Can I use theflate programmatically in my own app?",
    content: (
      <p className="pf-muted-body">
        Yes. theflate exposes a REST API. Upload a file, queue a job, poll for completion, download the result. You can attach a webhook URL to get notified the moment a job finishes instead of polling. See the <a href="/docs" style={{ color: "var(--color-signal)", textDecoration: "none", fontWeight: 600 }}>API Docs</a> for the full reference.
      </p>
    ),
  },
  {
    id: "limits",
    category: "Limits",
    question: "Are there any file size or job limits?",
    content: (
      <p className="pf-muted-body">
        There are no hard file size caps enforced at the upload level. Large files are handled the same as small ones. Rate limits apply per IP on anonymous requests (10 req/min). If you need higher throughput, grab an API key.
      </p>
    ),
  },
  {
    id: "transcription",
    category: "Transcription",
    question: "How does the transcription work?",
    content: (
      <p className="pf-muted-body">
        Transcription runs on OpenAI Whisper locally. Your audio never leaves the server to a third-party transcription service. Submit a job ID to <code style={{ fontSize: 12, background: "var(--color-surface-2)", padding: "1px 6px", borderRadius: 4 }}>/transcribe</code> and poll <code style={{ fontSize: 12, background: "var(--color-surface-2)", padding: "1px 6px", borderRadius: 4 }}>/transcriptions/:id</code> for the result.
      </p>
    ),
  },
];

export default function PoemFaq({ showTitle = true }: PoemFaqProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="pf-root">
      {showTitle && (
        <div className="pf-header">
          <h2 className="pf-heading">Frequently asked questions</h2>
          <p className="pf-subheading">
            Everything you need to know about theflate.
          </p>
        </div>
      )}

      <div className="pf-accordion">
        {FAQS.map((item, index) => {
          const isOpen = openIndex === index;
          return (
            <div key={item.id} className={`pf-item${isOpen ? " pf-item-open" : ""}`}>
              <button
                onClick={() => setOpenIndex(isOpen ? null : index)}
                className="pf-trigger"
                aria-expanded={isOpen}
              >
                <div className="pf-trigger-text">
                  <span className="pf-category">{item.category}</span>
                  <span className="pf-question">{item.question}</span>
                </div>
                <div className="pf-chevron" aria-hidden="true">{isOpen ? "−" : "+"}</div>
              </button>

              {isOpen && (
                <div className="pf-panel">
                  {item.content}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
