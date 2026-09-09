"use client";

import { useCallback, useRef, useState, useId } from "react";
import { useStore } from "@/lib/store";

export default function DropZone() {
  const addFiles = useStore((s) => s.addFiles);
  const setNetworkMbps = useStore((s) => s.setNetworkMbps);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const descId = useId();

  // Use navigator.connection where available; static default otherwise.
  // The previous implementation fetched google.com/favicon.ico on every mount,
  // leaking user visits to Google, and the timing math was wrong. (Task 3.3)
  const initNetwork = useCallback(() => {
    const nav = navigator as Navigator & { connection?: { downlink?: number } };
    const detected = nav.connection?.downlink;
    if (detected && detected > 0) setNetworkMbps(detected);
  }, [setNetworkMbps]);

  const handle = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    addFiles(Array.from(files));
  }, [addFiles]);

  const formats = ["MP4", "MOV", "MKV", "WebM", "MP3", "WAV", "FLAC", "JPG", "PNG", "WebP", "GIF"];

  return (
    <label
      htmlFor={inputRef.current?.id}
      aria-describedby={descId}
      onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; setDragging(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => { dragDepth.current--; if (dragDepth.current === 0) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); handle(e.dataTransfer.files); }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        cursor: "pointer",
        borderRadius: "var(--radius-lg)",
        padding: "44px 24px",
        border: `1.5px dashed ${dragging ? "var(--color-signal)" : "var(--color-line)"}`,
        background: dragging ? "var(--color-surface)" : "var(--color-ink)",
        transition: "border-color var(--dur-1) var(--ease-out), background-color var(--dur-1) var(--ease-out)",
      }}
    >
      <div style={{
        width: 48, height: 48, borderRadius: "var(--radius-md)",
        background: "var(--color-surface-2)", border: "1px solid var(--color-line)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--color-fg)",
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>

      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 4 }}>
        <p style={{ fontWeight: 700, fontSize: "var(--text-sm)", color: dragging ? "var(--color-signal)" : "var(--color-fg)" }}>
          {dragging ? "Release to upload" : "Drop video, audio, or image files here"}
        </p>
        <p style={{ color: "var(--color-fg-2)", fontSize: "var(--text-xs)" }}>
          or click to browse local files
        </p>
      </div>

      <div id={descId} style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginTop: 4 }}>
        {formats.map((fmt) => (
          <span key={fmt} className="label" style={{
            background: "var(--color-surface-2)",
            border: "1px solid var(--color-line)",
            borderRadius: "var(--radius-sm)",
            padding: "2px 6px",
          }}>
            {fmt}
          </span>
        ))}
      </div>

      {/* Visually hidden but focusable — never display:none which removes from a11y tree */}
      <input
        ref={inputRef}
        id="dropzone-input"
        type="file"
        multiple
        accept="video/*,audio/*,image/*,.gif,.webp"
        aria-label="Upload video, audio, or image files"
        aria-describedby={descId}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        onChange={(e) => { handle(e.target.files); initNetwork(); }}
      />
    </label>
  );
}
