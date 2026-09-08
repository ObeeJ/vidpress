"use client";

import { useState } from "react";
import Link from "next/link";

interface PoemFaqProps {
  showTitle?: boolean;
}

export default function PoemFaq({ showTitle = true }: PoemFaqProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const poemSections = [
    {
      id: "vision",
      category: "P.O.E.M Vision",
      question: "What is your vision and the premise of explosive growth?",
      summary: "A real startup requires explosive growth as a fundamental prerequisite, driven by inherent demand.",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, lineHeight: 1.6 }}>
          <p>
            Startup velocity is defined by market gravity. If you are creating high value for an acute pain point, inherent demand pulls the product from your hands, creating natural explosive growth.
          </p>
          <p>
            <strong>VPX Vision:</strong> Eliminate the friction and financial penalty of digital media handling across the internet. Media files consume over 75% of global bandwidth. We build the lightest, fastest Rust microservice media pipeline that enables instant compression, conversion, and transcription without complex cloud infrastructure.
          </p>
        </div>
      ),
    },
    {
      id: "problem",
      category: "P.O.E.M Problem",
      question: "What exact problem are you solving and who has it?",
      summary: "Massive media sizes create severe cloud bill inflation and broken user experience.",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, lineHeight: 1.6 }}>
          <p>
            The media problem is shared across two primary user bases:
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
            <div style={{ background: "#121215", border: "1px solid #27272a", borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#ffffff", marginBottom: 4 }}>Developers & Engineering Teams</div>
              <div style={{ fontSize: 12, color: "#a1a1aa" }}>
                Faced with skyrocketing S3 storage costs, massive Cloudflare egress fees, and the engineering overhead of setting up and scaling custom FFmpeg worker nodes.
              </div>
            </div>
            <div style={{ background: "#121215", border: "1px solid #27272a", borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#ffffff", marginBottom: 4 }}>Content Creators & Operators</div>
              <div style={{ fontSize: 12, color: "#a1a1aa" }}>
                Stuck waiting hours to upload uncompressed 4K video, hitting strict platform size limits (WhatsApp 16MB cap, email attachments), and risking privacy on ad-cluttered converter sites.
              </div>
            </div>
          </div>
          <p style={{ marginTop: 4 }}>
            <strong>Value of Solution:</strong> Immediate 70% to 90% reduction in storage and egress costs for businesses, combined with instantaneous file delivery and zero infrastructure maintenance.
          </p>
        </div>
      ),
    },
    {
      id: "solution",
      category: "P.O.E.M Solution",
      question: "What is the VPX solution and how does it compare to existing options?",
      summary: "High-performance Rust media pipeline with H.265 compression, OpenAI Whisper, and link downloads.",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, lineHeight: 1.6 }}>
          <p>
            VPX is a unified, high-performance media engine written in Rust and powered by FFmpeg + Whisper AI.
          </p>
          <div style={{ border: "1px solid #27272a", borderRadius: 8, overflow: "hidden", marginTop: 4 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, textAlign: "left" }}>
              <thead>
                <tr style={{ background: "#121215", borderBottom: "1px solid #27272a" }}>
                  <th style={{ padding: "8px 12px", color: "#ffffff", fontWeight: 600 }}>Alternative</th>
                  <th style={{ padding: "8px 12px", color: "#ffffff", fontWeight: 600 }}>The Compromise</th>
                  <th style={{ padding: "8px 12px", color: "#ffffff", fontWeight: 600 }}>VPX Advantage</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: "1px solid #18181b" }}>
                  <td style={{ padding: "8px 12px", fontWeight: 600, color: "#f4f4f5" }}>AWS MediaConvert</td>
                  <td style={{ padding: "8px 12px", color: "#a1a1aa" }}>Complex JSON IAM setup, slow spin-up, expensive per-minute pricing</td>
                  <td style={{ padding: "8px 12px", color: "#10b981", fontWeight: 500 }}>Single API call, sub-second dispatch, flat rate limits</td>
                </tr>
                <tr style={{ borderBottom: "1px solid #18181b" }}>
                  <td style={{ padding: "8px 12px", fontWeight: 600, color: "#f4f4f5" }}>Online Web Converters</td>
                  <td style={{ padding: "8px 12px", color: "#a1a1aa" }}>Ad-heavy, strict 50MB caps, privacy risks, no API access</td>
                  <td style={{ padding: "8px 12px", color: "#10b981", fontWeight: 500 }}>Zero ads, 2GB limits, full programmatic REST API</td>
                </tr>
                <tr>
                  <td style={{ padding: "8px 12px", fontWeight: 600, color: "#f4f4f5" }}>DIY FFmpeg Scripts</td>
                  <td style={{ padding: "8px 12px", color: "#a1a1aa" }}>High server setup, broken queues, worker scaling deadlocks</td>
                  <td style={{ padding: "8px 12px", color: "#10b981", fontWeight: 500 }}>Pre-packaged Rust queue, automated thread scaling</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      id: "strategy",
      category: "P.O.E.M Strategy",
      question: "What is your strategy to bring this solution to life and scale?",
      summary: "Product-led growth loop combining developer API adoption with viral consumer utility.",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, lineHeight: 1.6 }}>
          <p>
            Our strategy relies on three compounding growth channels:
          </p>
          <ol style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8, color: "#a1a1aa" }}>
            <li>
              <strong style={{ color: "#ffffff" }}>1. High-Intent Utility Engine:</strong> Free, instant web tools (URL Downloader for YouTube/TikTok/X, QR file sharing) drive organic search traffic and word-of-mouth adoption.
            </li>
            <li>
              <strong style={{ color: "#ffffff" }}>2. Developer API Hook:</strong> Programmatic REST API keys (`x-api-key`) allow developers to embed VPX directly into their backends for user media uploads, creating locked-in recurring SaaS volume.
            </li>
            <li>
              <strong style={{ color: "#ffffff" }}>3. Open Core & Self-Hosting:</strong> Provide white-label options and open source/self-hostable options for enterprise security and developer community trust.
            </li>
          </ol>
        </div>
      ),
    },
    {
      id: "faq-retention",
      category: "Security & Retention",
      question: "How long are uploaded files retained on VPX nodes?",
      summary: "Automated purge schedules protect privacy and storage hygiene.",
      content: (
        <p style={{ color: "#a1a1aa", lineHeight: 1.6 }}>
          Anonymous uploads are automatically permanently deleted after 24 hours. Premium and API plan outputs are retained for 7 days or until deleted manually via API call. VPX does not retain or sell user media assets.
        </p>
      ),
    },
    {
      id: "faq-codecs",
      category: "Technical Capabilities",
      question: "Which formats, codecs, and Whisper models are supported?",
      summary: "H.264, H.265, AAC, MP3, WebP, FLAC, and OpenAI Whisper.",
      content: (
        <div style={{ color: "#a1a1aa", lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 8 }}>
          <div><strong>Video Formats:</strong> MP4, MOV, MKV, WebM, AVI (Codecs: H.264, H.265/HEVC)</div>
          <div><strong>Audio Formats:</strong> MP3, AAC, M4A, WAV, FLAC, OGG</div>
          <div><strong>Image Formats:</strong> JPG, PNG, WebP, GIF</div>
          <div><strong>AI Transcription:</strong> OpenAI Whisper Base (Free) & Whisper Medium (Premium)</div>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, width: "100%" }}>
      {showTitle && (
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 9999, background: "#18181b", border: "1px solid #27272a", fontSize: 11, fontWeight: 700, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 12 }}>
            P.O.E.M Framework & Architecture
          </div>
          <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-1px", color: "#ffffff" }}>
            Problem. Solution. Strategy.
          </h2>
          <p style={{ fontSize: 14, color: "#a1a1aa", maxWidth: 560, margin: "8px auto 0" }}>
            Explosive growth stems from solving visceral problems with relentless clarity. Explore the foundational premise of VPX.
          </p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {poemSections.map((item, index) => {
          const isOpen = openIndex === index;
          return (
            <div
              key={item.id}
              style={{
                background: isOpen ? "#09090b" : "#000000",
                border: `1px solid ${isOpen ? "#3f3f46" : "#27272a"}`,
                borderRadius: 10,
                overflow: "hidden",
                transition: "border-color 0.15s ease, background 0.15s ease",
              }}
            >
              <button
                onClick={() => setOpenIndex(isOpen ? null : index)}
                style={{
                  width: "100%",
                  padding: "16px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "transparent",
                  border: "none",
                  color: "#ffffff",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#71717a", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    {item.category}
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#f4f4f5" }}>
                    {item.question}
                  </span>
                </div>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    border: "1px solid #27272a",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    color: "#a1a1aa",
                    flexShrink: 0,
                    marginLeft: 16,
                  }}
                >
                  {isOpen ? "−" : "+"}
                </div>
              </button>

              {isOpen && (
                <div
                  style={{
                    padding: "0 20px 20px",
                    borderTop: "1px solid #18181b",
                    paddingTop: 16,
                    color: "#f4f4f5",
                    fontSize: 13,
                  }}
                >
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
