"use client";

import { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import DropZone from "@/components/DropZone";
import FileCard from "@/components/FileCard";
import UrlDownloader from "@/components/UrlDownloader";
import ScreenRecorder from "@/components/ScreenRecorder";
import LiveStream from "@/components/LiveStream";
import { useStore } from "@/lib/store";

export default function Home() {
  const { files } = useStore();
  const [activeTab, setActiveTab] = useState<"upload" | "url" | "screen" | "live">("upload");

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#000000" }}>
      <Navbar />

      <main className="measure" style={{ flex: 1, padding: "48px 0 80px", display: "flex", flexDirection: "column", gap: 32 }}>
        
        {/* Hero */}
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <h1 className="display" style={{ color: "#ffffff", maxWidth: 760 }}>
            Deflate any file. Instantly.
          </h1>

          <p className="lede">
            Theflate video, audio, and images by up to 90% with zero visible quality loss. High-speed media processing for developers and creators.
          </p>
        </div>

        {/* Action Input Mode Selector */}
        <div role="tablist" style={{ display: "flex", background: "#09090b", border: "1px solid #27272a", borderRadius: 10, padding: 4, gap: 2 }}>
          {([
            { id: "upload", label: "Upload" },
            { id: "url",    label: "Social Link" },
            { id: "screen", label: "Screen" },
            { id: "live",   label: "Live" },
          ] as const).map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => setActiveTab(id)}
              onKeyDown={(e) => {
                const tabs = ["upload", "url", "screen", "live"] as const;
                const i = tabs.indexOf(id);
                if (e.key === "ArrowRight") setActiveTab(tabs[(i + 1) % tabs.length]);
                if (e.key === "ArrowLeft")  setActiveTab(tabs[(i - 1 + tabs.length) % tabs.length]);
              }}
              style={{
                flex: 1,
                padding: "10px 8px",
                borderRadius: 8,
                border: "none",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                background: activeTab === id ? "#18181b" : "transparent",
                color: activeTab === id ? "#ffffff" : "#71717a",
                transition: "background-color 0.15s ease, color 0.15s ease",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Processing Component */}
        {activeTab === "upload" && <DropZone />}
        {activeTab === "url"    && <UrlDownloader />}
        {activeTab === "screen" && <ScreenRecorder />}
        {activeTab === "live"   && <LiveStream />}

        {/* Active File Cards Queue */}
        {files.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#ffffff" }}>
              Active Queue ({files.length})
            </div>
            {files.map((item, index) => (
              <div key={item.localUrl} className="reveal" style={{ "--i": index } as React.CSSProperties}>
                <FileCard item={item} />
              </div>
            ))}
          </div>
        )}

      </main>

      <Footer />
    </div>
  );
}
