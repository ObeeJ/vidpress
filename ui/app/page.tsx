"use client";

import { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import DropZone from "@/components/DropZone";
import FileCard from "@/components/FileCard";
import ScreenRecorder from "@/components/ScreenRecorder";
import LiveStream from "@/components/LiveStream";
import { useStore } from "@/lib/store";

const TABS = [
  { id: "upload", label: "Upload" },
  { id: "screen", label: "Screen" },
  { id: "live",   label: "Live" },
] as const;

export default function Home() {
  const { files } = useStore();
  const [activeTab, setActiveTab] = useState<"upload" | "screen" | "live">("upload");

  return (
    <div className="page-shell">
      <Navbar />

      <main className="measure page-main">

        {/* Hero */}
        <div className="hero">
          <h1 className="display hero-title">
            Compress, convert,<br className="hero-br" /> share.
          </h1>

          <p className="lede">
            Drop any video, audio, or image. See the quality and resolution you&apos;ll actually get before anything is compressed. No account needed.
          </p>
        </div>

        {/* Action Input Mode Selector */}
        <div role="tablist" className="tablist">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              aria-selected={activeTab === id}
              className="tab"
              onClick={() => setActiveTab(id)}
              onKeyDown={(e) => {
                const tabs = TABS.map((t) => t.id);
                const i = tabs.indexOf(id);
                if (e.key === "ArrowRight") setActiveTab(tabs[(i + 1) % tabs.length]);
                if (e.key === "ArrowLeft")  setActiveTab(tabs[(i - 1 + tabs.length) % tabs.length]);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Processing Component */}
        {activeTab === "upload" && <DropZone />}
        {activeTab === "screen" && <ScreenRecorder />}
        {activeTab === "live"   && <LiveStream />}

        {/* Active File Cards Queue */}
        {files.length > 0 && (
          <div className="queue">
            <div className="queue-heading">
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
