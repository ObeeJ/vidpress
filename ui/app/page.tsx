"use client";

import { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import DropZone from "@/components/DropZone";
import FileCard from "@/components/FileCard";
import UrlDownloader from "@/components/UrlDownloader";
import PoemFaq from "@/components/PoemFaq";
import { useStore } from "@/lib/store";
import Link from "next/link";

export default function Home() {
  const { files, networkMbps, setNetworkMbps } = useStore();
  const [activeTab, setActiveTab] = useState<"upload" | "url">("upload");

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#000000" }}>
      <Navbar />

      <main style={{ flex: 1, maxWidth: 900, width: "100%", margin: "0 auto", padding: "40px 20px 80px", display: "flex", flexDirection: "column", gap: 32 }}>
        
        {/* Hero Section with P.O.E.M Vision Webcopy */}
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 12px", borderRadius: 9999, background: "#09090b", border: "1px solid #27272a", fontSize: 11, fontWeight: 700, color: "#a1a1aa" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
            VPX High-Velocity Media Pipeline Engine
          </div>

          <h1 style={{ fontSize: 44, fontWeight: 900, letterSpacing: "-1.5px", color: "#ffffff", lineHeight: 1.1, maxWidth: 760 }}>
            Compress, Convert, & Transcribe Media Instantly.
          </h1>

          <p style={{ fontSize: 15, color: "#a1a1aa", maxWidth: 600, lineHeight: 1.6 }}>
            70% to 90% size reduction without quality loss. Engineered with a Rust microservice core for developers, content creators, and digital teams.
          </p>

          {/* Quick Metrics Bar */}
          <div style={{ display: "flex", gap: 20, marginTop: 6, flexWrap: "wrap", justifyContent: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#71717a" }}>
              <span style={{ color: "#ffffff", fontWeight: 700 }}>H.265 / WebP</span> Encoding
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#71717a" }}>
              <span style={{ color: "#ffffff", fontWeight: 700 }}>Whisper AI</span> Transcription
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#71717a" }}>
              <span style={{ color: "#ffffff", fontWeight: 700 }}>YT/IG/TikTok/X</span> Extraction
            </div>
          </div>
        </div>

        {/* Connection Speed Selector */}
        <div style={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 10, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#a1a1aa" }}>
            Estimated Download Egress Speed: <strong style={{ color: "#ffffff" }}>{networkMbps} Mbps</strong>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[
              { label: "5 Mbps (Cellular)", mbps: 5 },
              { label: "50 Mbps (Home WiFi)", mbps: 50 },
              { label: "200 Mbps (Fibre)", mbps: 200 },
            ].map(({ label, mbps }) => (
              <button
                key={mbps}
                onClick={() => setNetworkMbps(mbps)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: `1px solid ${networkMbps === mbps ? "#ffffff" : "#27272a"}`,
                  background: networkMbps === mbps ? "#18181b" : "#000000",
                  color: networkMbps === mbps ? "#ffffff" : "#71717a",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Input Mode Selector (File Upload vs Link Downloader) */}
        <div style={{ display: "flex", background: "#09090b", border: "1px solid #27272a", borderRadius: 10, padding: 4 }}>
          <button
            onClick={() => setActiveTab("upload")}
            style={{
              flex: 1,
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              background: activeTab === "upload" ? "#18181b" : "transparent",
              color: activeTab === "upload" ? "#ffffff" : "#71717a",
              transition: "all 0.15s ease",
            }}
          >
            Direct File Upload & Compression
          </button>
          <button
            onClick={() => setActiveTab("url")}
            style={{
              flex: 1,
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              background: activeTab === "url" ? "#18181b" : "transparent",
              color: activeTab === "url" ? "#ffffff" : "#71717a",
              transition: "all 0.15s ease",
            }}
          >
            Social Link Downloader (YouTube / IG / TikTok / X)
          </button>
        </div>

        {/* Interactive Processing Component */}
        {activeTab === "upload" ? <DropZone /> : <UrlDownloader />}

        {/* Active File Cards Queue */}
        {files.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#ffffff", letterSpacing: "-0.2px" }}>
              Active Processing Queue ({files.length})
            </div>
            {files.map((item) => (
              <FileCard key={item.localUrl} item={item} />
            ))}
          </div>
        )}

        {/* P.O.E.M FAQ & Architecture Section */}
        <div style={{ borderTop: "1px solid #18181b", paddingTop: 40, marginTop: 20 }}>
          <PoemFaq showTitle={true} />
        </div>

      </main>

      <Footer />
    </div>
  );
}
