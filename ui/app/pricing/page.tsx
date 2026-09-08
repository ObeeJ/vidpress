"use client";

import { useState, useRef } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const PLANS = [
  {
    id: "free",
    name: "Sandbox Free",
    monthlyPrice: 0,
    annualPrice: 0,
    tag: "Instant Sandbox",
    description: "For casual users and initial API evaluation.",
    limits: "10 compressions/day • 200MB file limit • Standard queue speed",
    features: [
      "All output formats (MP4, WebM, MP3, WebP)",
      "24-hour temporary vault retention",
      "Whisper base transcription model",
      "QR code mobile downloads",
    ],
    cta: "Start Free",
  },
  {
    id: "premium",
    name: "Pro Membership",
    monthlyPrice: 9,
    annualPrice: 7,
    tag: "Most Popular",
    description: "For content creators, social managers, and heavy individual users.",
    limits: "Unlimited web compressions • 2GB file limit • Priority queue",
    features: [
      "YouTube, Instagram, TikTok, X URL downloader",
      "Whisper medium high-accuracy transcription",
      "Subtitle SRT/VTT export",
      "7-day retention vault",
      "Batch parallel processing (10 files at once)",
      "API access (300 req/min)",
    ],
    cta: "Upgrade to Pro",
  },
  {
    id: "api_starter",
    name: "API Starter",
    monthlyPrice: 19,
    annualPrice: 15,
    tag: "For Developers",
    description: "Programmatic compression API for early-stage apps and SaaS.",
    limits: "120 req/min • 5,000 API jobs/month",
    features: [
      "Everything in Pro Membership",
      "Webhook notifications with HMAC signing",
      "API usage telemetry dashboard",
      "Custom output file naming templates",
    ],
    cta: "Issue Starter Key",
  },
  {
    id: "api_growth",
    name: "API Growth",
    monthlyPrice: 49,
    annualPrice: 39,
    tag: "For Scaleups",
    description: "High-throughput API for growing media platforms and UGC apps.",
    limits: "600 req/min • 50,000 API jobs/month",
    features: [
      "Everything in API Starter",
      "Dedicated Rust worker queue dispatch",
      "99.9% uptime target SLA",
      "Priority developer email support",
    ],
    cta: "Issue Growth Key",
  },
  {
    id: "api_scale",
    name: "API Scale",
    monthlyPrice: 149,
    annualPrice: 119,
    tag: "Production",
    description: "Enterprise volume with dedicated worker isolation and SLAs.",
    limits: "3,000 req/min • 250,000 API jobs/month",
    features: [
      "Everything in API Growth",
      "Isolated ECS worker fleet scaling",
      "Custom vault retention policies",
      "24/7 dedicated support & SLA",
    ],
    cta: "Issue Scale Key",
  },
];

const WHITELABEL_OPTIONS = [
  {
    id: "whitelabel_basic",
    name: "White-Label Brand",
    price: 19,
    period: "mo",
    desc: "Host VPX on your own custom domain with custom logos.",
  },
  {
    id: "whitelabel_source",
    name: "Self-Host Source Code",
    price: 299,
    period: "one-time",
    desc: "Complete Rust backend & Next.js UI source code license.",
  },
];

export default function PricingPage() {
  const [annual, setAnnual] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [wlDomain, setWlDomain] = useState("");
  const [wlBrand, setWlBrand] = useState("");
  const [loading, setLoading] = useState(false);
  const [issuedKey, setIssuedKey] = useState<{ key: string; plan: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleKeyIssuance(planId: string) {
    if (!name.trim()) {
      setError("Enter a developer/app name first");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("http://localhost:8080/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          plan: planId,
          white_label_domain: wlDomain || undefined,
          white_label_brand: wlBrand || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to create API key");
      setIssuedKey(data);
      setSelectedPlan(null);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#000000" }}>
      <Navbar />

      <main style={{ flex: 1, maxWidth: 1100, width: "100%", margin: "0 auto", padding: "60px 20px 80px" }}>
        
        {/* Header Banner */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 9999, background: "#18181b", border: "1px solid #27272a", fontSize: 11, fontWeight: 700, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 16 }}>
            SaaS & Membership Tiers
          </div>
          <h1 style={{ fontSize: 40, fontWeight: 900, letterSpacing: "-1.5px", color: "#ffffff", marginBottom: 12 }}>
            Simple. Transparent. Zero Overhead.
          </h1>
          <p style={{ fontSize: 15, color: "#a1a1aa", maxWidth: 560, margin: "0 auto 28px" }}>
            Start with our free sandbox or deploy high-throughput API keys for production workflows.
          </p>

          {/* Billing Interval Toggle */}
          <div style={{ display: "inline-flex", alignItems: "center", background: "#09090b", border: "1px solid #27272a", borderRadius: 9999, padding: 4 }}>
            <button
              onClick={() => setAnnual(false)}
              style={{
                padding: "6px 16px",
                borderRadius: 9999,
                border: "none",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                background: !annual ? "#ffffff" : "transparent",
                color: !annual ? "#000000" : "#a1a1aa",
                transition: "all 0.15s ease",
              }}
            >
              Monthly Billing
            </button>
            <button
              onClick={() => setAnnual(true)}
              style={{
                padding: "6px 16px",
                borderRadius: 9999,
                border: "none",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                background: annual ? "#ffffff" : "transparent",
                color: annual ? "#000000" : "#a1a1aa",
                transition: "all 0.15s ease",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span>Annual Billing</span>
              <span style={{ fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 4, background: "#10b98122", color: "#10b981", border: "1px solid #10b98144" }}>
                SAVE 20%
              </span>
            </button>
          </div>
        </div>

        {/* Issued Key Banner Modal */}
        {issuedKey && (
          <div style={{ background: "#121215", border: "1px solid #10b981", borderRadius: 12, padding: "24px", marginBottom: 40 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#ffffff" }}>API Key Generated Successfully</div>
              <button onClick={() => setIssuedKey(null)} style={{ background: "none", border: "none", color: "#a1a1aa", cursor: "pointer", fontSize: 18 }}>×</button>
            </div>
            <p style={{ fontSize: 13, color: "#a1a1aa", marginBottom: 14 }}>
              Copy your key now. Store it securely in your environment variables as <code style={{ background: "#000000", padding: "2px 6px", borderRadius: 4, color: "#ffffff" }}>x-api-key</code>.
            </p>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                readOnly
                value={issuedKey.key}
                style={{ flex: 1, padding: "10px 14px", borderRadius: 8, background: "#000000", border: "1px solid #27272a", color: "#10b981", fontFamily: "monospace", fontSize: 14 }}
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(issuedKey.key);
                  alert("Copied to clipboard!");
                }}
                className="vpx-button-primary"
              >
                Copy Key
              </button>
            </div>
          </div>
        )}

        {/* Developer Name Modal Trigger */}
        {selectedPlan && (
          <div style={{ background: "#09090b", border: "1px solid #3f3f46", borderRadius: 12, padding: "24px", marginBottom: 40 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: "#ffffff" }}>Configure Key for Plan: {selectedPlan.toUpperCase()}</h3>
                <p style={{ fontSize: 12, color: "#a1a1aa" }}>Enter your details to generate your instantaneous access key.</p>
              </div>
              <button onClick={() => setSelectedPlan(null)} style={{ background: "none", border: "none", color: "#a1a1aa", cursor: "pointer", fontSize: 18 }}>×</button>
            </div>

            {error && (
              <div style={{ fontSize: 12, color: "#ef4444", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", padding: "10px", borderRadius: 8, marginBottom: 14 }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#a1a1aa" }}>
                Developer / Organization Name *
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Acme Media Systems"
                  style={{ padding: "10px 14px", borderRadius: 8, background: "#000000", border: "1px solid #27272a", color: "#ffffff", outline: "none" }}
                />
              </label>

              {selectedPlan.startsWith("whitelabel") && (
                <>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#a1a1aa" }}>
                    Custom White-Label Domain
                    <input
                      value={wlDomain}
                      onChange={(e) => setWlDomain(e.target.value)}
                      placeholder="compress.yourdomain.com"
                      style={{ padding: "10px 14px", borderRadius: 8, background: "#000000", border: "1px solid #27272a", color: "#ffffff", outline: "none" }}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#a1a1aa" }}>
                    Brand Name Override
                    <input
                      value={wlBrand}
                      onChange={(e) => setWlBrand(e.target.value)}
                      placeholder="YourBrand Media"
                      style={{ padding: "10px 14px", borderRadius: 8, background: "#000000", border: "1px solid #27272a", color: "#ffffff", outline: "none" }}
                    />
                  </label>
                </>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                <button
                  onClick={() => handleKeyIssuance(selectedPlan)}
                  disabled={loading}
                  className="vpx-button-primary"
                  style={{ flex: 1 }}
                >
                  {loading ? "Generating..." : "Confirm & Issue API Key"}
                </button>
                <button onClick={() => setSelectedPlan(null)} className="vpx-button-secondary">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Pricing Tier Grid (Structured 5-Tier Layout) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, marginBottom: 60 }}>
          {PLANS.map((p) => {
            const price = annual ? p.annualPrice : p.monthlyPrice;
            const isHighlight = p.id === "premium" || p.id === "api_growth";
            return (
              <div
                key={p.id}
                style={{
                  background: isHighlight ? "#09090b" : "#000000",
                  border: `1px solid ${isHighlight ? "#ffffff" : "#27272a"}`,
                  borderRadius: 12,
                  padding: "24px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  position: "relative",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: "#ffffff" }}>{p.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: "#18181b", color: "#a1a1aa", border: "1px solid #27272a" }}>
                      {p.tag}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 8 }}>
                    <span style={{ fontSize: 32, fontWeight: 900, color: "#ffffff" }}>${price}</span>
                    <span style={{ fontSize: 13, color: "#71717a" }}>/ month</span>
                  </div>

                  <p style={{ fontSize: 12, color: "#a1a1aa", marginBottom: 16, lineHeight: 1.5 }}>
                    {p.description}
                  </p>

                  <div style={{ background: "#121215", border: "1px solid #18181b", borderRadius: 6, padding: "8px 12px", fontSize: 11, fontWeight: 600, color: "#ffffff", marginBottom: 16 }}>
                    {p.limits}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
                    {p.features.map((feat, idx) => (
                      <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "#a1a1aa" }}>
                        <span style={{ color: "#ffffff", fontWeight: 700 }}>•</span>
                        <span>{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => setSelectedPlan(p.id)}
                  className={isHighlight ? "vpx-button-primary" : "vpx-button-secondary"}
                  style={{ width: "100%", padding: "10px" }}
                >
                  {p.cta}
                </button>
              </div>
            );
          })}
        </div>

        {/* White-Label Options Section */}
        <div style={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 12, padding: "32px" }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#ffffff", marginBottom: 8 }}>
            White-Label & Source Code Licensing
          </h2>
          <p style={{ fontSize: 13, color: "#a1a1aa", marginBottom: 24 }}>
            For enterprise platforms needing full custom domain branding or self-hosting capability.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
            {WHITELABEL_OPTIONS.map((wl) => (
              <div key={wl.id} style={{ background: "#000000", border: "1px solid #27272a", borderRadius: 10, padding: 20, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: "#ffffff" }}>{wl.name}</span>
                    <span style={{ fontSize: 18, fontWeight: 900, color: "#ffffff" }}>${wl.price} <span style={{ fontSize: 11, color: "#71717a", fontWeight: 400 }}>/{wl.period}</span></span>
                  </div>
                  <p style={{ fontSize: 12, color: "#a1a1aa", marginBottom: 16 }}>{wl.desc}</p>
                </div>
                <button onClick={() => setSelectedPlan(wl.id)} className="vpx-button-secondary" style={{ width: "100%", padding: "8px" }}>
                  Configure License
                </button>
              </div>
            ))}
          </div>
        </div>

      </main>

      <Footer />
    </div>
  );
}
