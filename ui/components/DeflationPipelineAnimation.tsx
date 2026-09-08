"use client";

import { useState } from "react";

export default function DeflationPipelineAnimation() {
  const [activeStep, setActiveStep] = useState<number>(1);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const steps = [
    { id: "raw", label: "Raw Heavy Media", size: "1.24 GB", detail: "4K ProRes / Raw Footage" },
    { id: "engine", label: "theflate Deflation Laser", size: "Processing...", detail: "H.265 / WebP Stream Engine" },
    { id: "deflated", label: "Deflated Micro Payload", size: "142 MB (-88%)", detail: "Zero Loss Visual Fidelity" },
  ];

  return (
    <div style={{ width: "100%", margin: "24px 0 36px", display: "flex", flexDirection: "column", gap: 16 }}>
      
      {/* Motion Canvas Box */}
      <div
        style={{
          width: "100%",
          background: "#09090b",
          border: "1px solid #27272a",
          borderRadius: 16,
          padding: "24px 20px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Animated Vector Pipeline SVG */}
        <div style={{ width: "100%", aspectRatio: "2320 / 280", position: "relative" }}>
          <svg
            viewBox="0 0 2320 280"
            preserveAspectRatio="xMidYMax meet"
            style={{ width: "100%", height: "100%", display: "block" }}
          >
            <defs>
              {/* Laser Beam Gradients */}
              <linearGradient id="laser-line" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#27272a" />
                <stop offset="50%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#27272a" />
              </linearGradient>

              <radialGradient id="gate-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* Background Grid Lines */}
            <g opacity="0.15">
              <line x1="0" y1="200" x2="2320" y2="200" stroke="#3f3f46" strokeWidth="1" strokeDasharray="6 6" />
              <line x1="0" y1="240" x2="2320" y2="240" stroke="#27272a" strokeWidth="1" />
            </g>

            {/* Stage 1: Massive Raw File Block */}
            <g
              transform="translate(180, 110)"
              cursor="pointer"
              onClick={() => setActiveStep(0)}
              onMouseEnter={() => setHoveredNode("raw")}
              onMouseLeave={() => setHoveredNode(null)}
            >
              <rect
                x="-120"
                y="-75"
                width="240"
                height="130"
                rx="14"
                fill="#121215"
                stroke={hoveredNode === "raw" || activeStep === 0 ? "#ffffff" : "#27272a"}
                strokeWidth="2"
              />
              <text x="0" y="-35" textAnchor="middle" fill="#71717a" fontSize="22" fontWeight="700">RAW MEDIA</text>
              <text x="0" y="5" textAnchor="middle" fill="#ffffff" fontSize="36" fontWeight="900">1.24 GB</text>
              <text x="0" y="38" textAnchor="middle" fill="#a1a1aa" fontSize="18">Uncompressed File</text>
            </g>

            {/* Connecting Flow Stream 1 */}
            <g>
              <path d="M 320 175 H 960" stroke="url(#laser-line)" strokeWidth="3" strokeDasharray="12 12">
                <animate attributeName="stroke-dashoffset" from="48" to="0" dur="1.2s" repeatCount="indefinite" />
              </path>
            </g>

            {/* Stage 2: Central Deflation Laser Gate */}
            <g
              transform="translate(1160, 110)"
              cursor="pointer"
              onClick={() => setActiveStep(1)}
              onMouseEnter={() => setHoveredNode("laser")}
              onMouseLeave={() => setHoveredNode(null)}
            >
              <circle cx="0" cy="0" r="110" fill="url(#gate-glow)" />
              <rect
                x="-150"
                y="-85"
                width="300"
                height="150"
                rx="16"
                fill="#000000"
                stroke="#ffffff"
                strokeWidth="2.5"
              />
              <path d="M -150 0 H 150" stroke="#ffffff" strokeWidth="1" strokeDasharray="4 4" />
              <circle cx="0" cy="-25" r="28" fill="#18181b" stroke="#ffffff" strokeWidth="2">
                <animate attributeName="r" values="24;30;24" dur="2s" repeatCount="indefinite" />
              </circle>
              <polygon points="-8,-25 8,-25 0,-12" fill="#ffffff" />
              <text x="0" y="32" textAnchor="middle" fill="#ffffff" fontSize="24" fontWeight="900">DEFLATION CORE</text>
              <text x="0" y="55" textAnchor="middle" fill="#10b981" fontSize="18" fontWeight="700">H.265 Stream Active</text>
            </g>

            {/* Connecting Flow Stream 2 */}
            <g>
              <path d="M 1310 175 H 1950" stroke="url(#laser-line)" strokeWidth="3" strokeDasharray="12 12">
                <animate attributeName="stroke-dashoffset" from="48" to="0" dur="1.2s" repeatCount="indefinite" />
              </path>
            </g>

            {/* Stage 3: Deflated Micro File Output */}
            <g
              transform="translate(2080, 110)"
              cursor="pointer"
              onClick={() => setActiveStep(2)}
              onMouseEnter={() => setHoveredNode("deflated")}
              onMouseLeave={() => setHoveredNode(null)}
            >
              <rect
                x="-110"
                y="-65"
                width="220"
                height="115"
                rx="14"
                fill="#121215"
                stroke={hoveredNode === "deflated" || activeStep === 2 ? "#10b981" : "#27272a"}
                strokeWidth="2"
              />
              <text x="0" y="-30" textAnchor="middle" fill="#10b981" fontSize="20" fontWeight="800">DEFLATED PAYLOAD</text>
              <text x="0" y="10" textAnchor="middle" fill="#ffffff" fontSize="34" fontWeight="900">142 MB</text>
              <text x="0" y="38" textAnchor="middle" fill="#10b981" fontSize="18" fontWeight="700">−88% Reduction</text>
            </g>

            {/* Base Track Line */}
            <path d="M 0 240 H 2320" stroke="#27272a" strokeWidth="3" />
            <circle cx="1160" cy="240" r="6" fill="#ffffff" />
          </svg>
        </div>

        {/* Status Reader Bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #18181b", paddingTop: 16, marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 4, background: "#18181b", color: "#ffffff", border: "1px solid #27272a" }}>
              STEP 0{activeStep + 1}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#ffffff" }}>
              {steps[activeStep].label}
            </span>
            <span style={{ fontSize: 12, color: "#a1a1aa" }}>
              ({steps[activeStep].size})
            </span>
          </div>

          <div style={{ fontSize: 12, color: "#71717a" }}>
            Click nodes to inspect vector pipeline stages
          </div>
        </div>
      </div>
    </div>
  );
}
