"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import DropZone from "@/components/DropZone";
import FileCard from "@/components/FileCard";
import UrlDownloader from "@/components/UrlDownloader";

const STEPS = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
    ),
    title: "Drop your file",
    desc: "Any video, audio, or image. Even large ones.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
    ),
    title: "Pick your settings",
    desc: "Choose how small you want it and what format.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
    ),
    title: "We compress it",
    desc: "Usually takes under a minute. You'll see live progress.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    ),
    title: "Download or share",
    desc: "Get a download link or scan the QR code on your phone.",
  },
];

const GLOSSARY = [
  { term: "Compress", plain: "Make the file smaller so it's faster to send and takes less storage space." },
  { term: "Format (MP4, MOV, etc.)", plain: "The file type. MP4 works everywhere — phones, WhatsApp, websites. MOV is Apple. WebM is for websites. When in doubt, pick MP4." },
  { term: "Preset", plain: "A ready-made setting for a specific use. Pick WhatsApp if you're sending via WhatsApp, Instagram if you're posting a Reel, etc." },
  { term: "Target size", plain: "How small you want the final file to be. Drag the slider left to make it smaller (lower quality) or right to keep it closer to the original." },
  { term: "Codec", plain: "The technology used to store the video. You don't need to worry about this — we handle it automatically." },
  { term: "QR code", plain: "A scannable square you can point your phone camera at to instantly download the file on your phone." },
];

function Tooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        aria-label="What does this mean?"
        style={{ background: "none", border: "1px solid var(--border)", borderRadius: "50%", width: 16, height: 16, fontSize: 10, color: "var(--muted)", cursor: "pointer", lineHeight: 1, padding: 0, verticalAlign: "middle", marginLeft: 4 }}
      >?</button>
      {show && (
        <span style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)", background: "#1e1e1e", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "var(--text)", width: 220, zIndex: 10, lineHeight: 1.5, pointerEvents: "none" }}>
          {text}
        </span>
      )}
    </span>
  );
}

export { Tooltip };

export default function Home() {
  const { files, networkMbps, setNetworkMbps } = useStore();
  const [showGuide, setShowGuide] = useState(false);

  return (
    <main style={{ minHeight: "100vh", padding: "40px 20px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 28 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.5px" }}>vidpress</h1>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 13 }}>Make any video, audio or image smaller — instantly</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0, marginTop: 4 }}>
            <a href="/pricing" style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--muted)", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>Pricing</a>
            <a href="/docs" style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--muted)", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>API Docs</a>
            <button
              onClick={() => setShowGuide(!showGuide)}
              aria-expanded={showGuide}
              style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid var(--border)", background: showGuide ? "var(--accent)22" : "var(--surface)", color: showGuide ? "var(--accent)" : "var(--muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              {showGuide ? "Hide guide" : "How it works"}
            </button>
          </div>
        </div>

        {/* How it works guide */}
        {showGuide && (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "20px", display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>4 simple steps</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {STEPS.map((s, i) => (
                  <div key={i} style={{ background: "var(--surface2)", borderRadius: 12, padding: "14px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--accent)22", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {s.icon}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)" }}>Step {i + 1}</span>
                    </div>
                    <p style={{ fontWeight: 700, fontSize: 13 }}>{s.title}</p>
                    <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{s.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
              <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Plain English glossary</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {GLOSSARY.map((g) => (
                  <div key={g.term} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", minWidth: 120, flexShrink: 0 }}>{g.term}</span>
                    <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{g.plain}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: "var(--accent)11", border: "1px solid var(--accent)33", borderRadius: 12, padding: "12px 16px" }}>
              <p style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.6 }}>
                <strong>Not sure what to pick?</strong> Just drop your file, leave everything on default, and hit <strong>Compress</strong>. It'll work great for most uses.
              </p>
            </div>
          </div>
        )}

        {/* Network speed */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>How fast is your internet?</span>
            <Tooltip text="We use this to estimate how long it'll take to download your compressed file once it's ready." />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { label: "Slow", sub: "Mobile data / weak WiFi", mbps: 5 },
              { label: "Normal", sub: "Home WiFi", mbps: 50 },
              { label: "Fast", sub: "Fibre / office", mbps: 200 },
            ].map(({ label, sub, mbps }) => (
              <button key={mbps} onClick={() => setNetworkMbps(mbps)}
                style={{ flex: 1, minWidth: 100, padding: "10px 12px", borderRadius: 10, cursor: "pointer", border: `1px solid ${networkMbps === mbps ? "var(--accent)" : "var(--border)"}`, background: networkMbps === mbps ? "var(--accent)22" : "var(--surface2)", color: "var(--text)", textAlign: "left", transition: "all 0.15s" }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Drop zone */}
        <DropZone />

        {/* URL downloader */}
        <UrlDownloader />

        {/* Empty state hint */}
        {files.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, lineHeight: 1.8 }}>
            Supports <strong style={{ color: "var(--text)" }}>MP4, MOV, MKV, AVI, WebM</strong> · <strong style={{ color: "var(--text)" }}>MP3, WAV, FLAC, M4A</strong> · <strong style={{ color: "var(--text)" }}>JPG, PNG, WebP, GIF</strong>
            <br />Files stay on this server and are deleted after 24 hours
          </div>
        )}

        {/* File cards */}
        {files.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {files.map((item) => (
              <FileCard key={item.localUrl} item={item} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
