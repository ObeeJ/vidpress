"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";

export default function DropZone() {
  const addFiles = useStore((s) => s.addFiles);
  const setNetworkMbps = useStore((s) => s.setNetworkMbps);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handle = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    addFiles(Array.from(files));
  }, [addFiles]);

  useEffect(() => {
    const nav = navigator as Navigator & { connection?: { downlink?: number } };
    const detected = nav.connection?.downlink;
    if (detected && detected > 0) {
      setNetworkMbps(detected);
    } else {
      const start = Date.now();
      fetch("https://www.google.com/favicon.ico", { cache: "no-store", mode: "no-cors" })
        .then(() => {
          const ms = Date.now() - start;
          const mbps = Math.round((1 / 1024 / (ms / 1000)) * 8 * 100) / 100;
          if (mbps > 0 && mbps < 10000) setNetworkMbps(Math.min(mbps, 1000));
        })
        .catch(() => {});
    }
  }, [setNetworkMbps]);

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files); }}
      style={{
        border: `1.5px dashed ${dragging ? "#ffffff" : "#27272a"}`,
        borderRadius: 12,
        padding: dragging ? "52px 24px" : "44px 24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        cursor: "pointer",
        background: dragging ? "#121215" : "#09090b",
        transition: "all 0.15s ease",
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 10,
          background: "#18181b",
          border: "1px solid #27272a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#ffffff",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>

      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 4 }}>
        <p style={{ fontWeight: 700, fontSize: 15, color: dragging ? "#ffffff" : "#f4f4f5" }}>
          {dragging ? "Release file to ingest" : "Drop video, audio, or image files here"}
        </p>
        <p style={{ color: "#a1a1aa", fontSize: 13 }}>
          {dragging ? "VPX instant Rust pipeline active" : "or click to browse local files"}
        </p>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginTop: 4 }}>
        {["MP4", "MOV", "MKV", "WebM", "MP3", "WAV", "FLAC", "JPG", "PNG", "WebP", "GIF"].map((fmt) => (
          <span
            key={fmt}
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#71717a",
              background: "#121215",
              border: "1px solid #18181b",
              borderRadius: 4,
              padding: "2px 6px",
            }}
          >
            {fmt}
          </span>
        ))}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/*,audio/*,image/*,.gif,.webp"
        style={{ display: "none" }}
        onChange={(e) => handle(e.target.files)}
      />
    </div>
  );
}
