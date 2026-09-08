"use client";

import { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import DropZone from "@/components/DropZone";
import FileCard from "@/components/FileCard";
import UrlDownloader from "@/components/UrlDownloader";
import ScreenRecorder from "@/components/ScreenRecorder";
import LiveStream from "@/components/LiveStream";
import DeflationPipelineAnimation from "@/components/DeflationPipelineAnimation";
import { useStore } from "@/lib/store";

export default function Home() {
  const { files } = useStore();
  const [activeTab, setActiveTab] = useState<"upload" | "url" | "screen" | "live">("upload");

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#000000" }}>
      <Navbar />

      <main style={{ flex: 1, maxWidth: 900, width: "100%", margin: "0 auto", padding: "48px 20px 80px", display: "flex", flexDirection: "column", gap: 32 }}>
        
        {/* Simple & Clean Hero Section */}
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <h1 style={{ fontSize: 46, fontWeight: 900, letterSpacing: "-1.5px", color: "#ffffff", lineHeight: 1.1, maxWidth: 760 }}>
            Deflate any file. Instantly.
          </h1>

          <p style={{ fontSize: 16, color: "#a1a1aa", maxWidth: 580, lineHeight: 1.6 }}>
            Compress video, audio, and images by up to 90% with zero visible quality loss. High-speed media processing for developers and creators.
          </p>
        </div>

        {/* Vector Motion Pipeline Animation */}
        <DeflationPipelineAnimation />

        {/* Action Input Mode Selector */}
        <div style={{ display: "flex", background: "#09090b", border: "1px solid #27272a", borderRadius: 10, padding: 4, gap: 2 }}>
          {([
            { id: "upload", label: "Upload & Deflate" },
            { id: "url",    label: "Social Link" },
            { id: "screen", label: "Screen Record" },
            { id: "live",   label: "Live Stream" },
          ] as const).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
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
                transition: "all 0.15s ease",
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
            {files.map((item) => (
              <FileCard key={item.localUrl} item={item} />
            ))}
          </div>
        )}

      </main>

      <Footer />
    </div>
  );
}
