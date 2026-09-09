"use client";

import { useCallback, useRef, useState } from "react";
import { useStore } from "@/lib/store";

const FORMATS = ["MP4", "MOV", "MKV", "WebM", "MP3", "WAV", "FLAC", "JPG", "PNG", "WebP", "GIF"];

export default function DropZone() {
  const addFiles = useStore((s) => s.addFiles);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // Track depth so drag-leave on a child doesn't clear the state. (Task 3.3 Step 3)
  const depthRef = useRef(0);

  const handle = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    addFiles(Array.from(files));
  }, [addFiles]);

  return (
    // Wrap in a label so clicking anywhere activates the input and screen
    // readers announce it. The input is visually hidden but focusable. (WCAG 2.1.1)
    <label
      htmlFor="dropzone-input"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragEnter={() => { depthRef.current++; setDragging(true); }}
      onDragLeave={() => { if (--depthRef.current <= 0) { depthRef.current = 0; setDragging(false); } }}
      onDrop={(e) => { e.preventDefault(); depthRef.current = 0; setDragging(false); handle(e.dataTransfer.files); }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        cursor: "pointer",
        // Constant padding — no layout shift on drag-over. Signal via colour only.
        padding: "44px 24px",
        border: `1.5px dashed ${dragging ? "#ffffff" : "#27272a"}`,
        borderRadius: 12,
        background: dragging ? "#121215" : "#09090b",
        transition:
          "background-color 0.15s ease, border-color 0.15s ease",
      }}
    >
      <div style={{ width: 48, height: 48, borderRadius: 10, background: "#18181b", border: "1px solid #27272a", display: "flex", alignItems: "center", justifyContent: "center", color: "#ffffff" }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>

      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 4 }}>
        <p style={{ fontWeight: 700, fontSize: 15, color: dragging ? "#ffffff" : "#f4f4f5" }}>
          {dragging ? "Release to upload" : "Drop video, audio, or image files here"}
        </p>
        <p style={{ color: "#a1a1aa", fontSize: 13 }}>
          {dragging ? "Release to upload" : "or click to browse local files"}
        </p>
      </div>

      <div
        id="dropzone-formats"
        style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginTop: 4 }}
      >
        {FORMATS.map((fmt) => (
          <span key={fmt} style={{ fontSize: 10, fontWeight: 600, color: "#71717a", background: "#121215", border: "1px solid #18181b", borderRadius: 4, padding: "2px 6px" }}>
            {fmt}
          </span>
        ))}
      </div>

      {/* Visually hidden but focusable — never display:none. (WCAG 2.1.1) */}
      <input
        ref={inputRef}
        id="dropzone-input"
        type="file"
        multiple
        accept="video/*,audio/*,image/*,.gif,.webp"
        aria-label="Upload video, audio, or image files"
        aria-describedby="dropzone-formats"
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        onChange={(e) => handle(e.target.files)}
      />
    </label>
  );
}
