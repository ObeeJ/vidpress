"use client";
import { useState, useRef } from "react";

const PLANS = [
  {
    id: "free", name: "Free", price: 0, period: "forever", tag: null,
    color: "#ffffff22", border: "#333",
    features: ["10 compressions / day", "200MB file limit", "All formats & presets", "QR code sharing", "24h file retention", "Whisper base transcription"],
    cta: "Get started",
  },
  {
    id: "premium", name: "Premium", price: 2, period: "mo", tag: "Best value",
    color: "#7c3aed22", border: "#7c3aed",
    features: ["Unlimited compressions", "2GB file limit", "API access (300 req/min)", "Webhooks", "YouTube / IG / TikTok / X download", "Whisper medium transcription", "SRT / VTT subtitle export", "Batch jobs (10 at once)", "Metadata stripping", "Video thumbnail extraction", "7-day file retention", "Priority processing"],
    cta: "Get Premium",
  },
  {
    id: "api_starter", name: "API Starter", price: 5, period: "mo", tag: "For devs",
    color: "#06b6d422", border: "#06b6d4",
    features: ["Everything in Premium", "120 req/min", "5,000 jobs/month", "Webhook HMAC signing", "API usage dashboard", "Email support"],
    cta: "Get Starter",
  },
  {
    id: "api_growth", name: "API Growth", price: 15, period: "mo", tag: "For startups",
    color: "#8b5cf622", border: "#8b5cf6",
    features: ["Everything in Starter", "600 req/min", "50,000 jobs/month", "Custom output filenames", "Dedicated job queue", "Priority support"],
    cta: "Get Growth",
  },
  {
    id: "api_scale", name: "API Scale", price: 49, period: "mo", tag: "Production",
    color: "#f59e0b22", border: "#f59e0b",
    features: ["Everything in Growth", "3,000 req/min", "Unlimited jobs", "99.9% SLA", "Slack support", "Custom retention"],
    cta: "Get Scale",
  },
];

const WL = [
  {
    id: "whitelabel_basic", name: "Basic", price: 19, period: "mo",
    features: ["Remove vidpress branding", "Your logo + colors", "Custom domain (exclusive)", "All API Scale features", "DNS setup guide"],
  },
  {
    id: "whitelabel_pro", name: "Pro", price: 49, period: "mo",
    features: ["Everything in Basic", "Custom email domain", "Your API key namespace", "Custom pricing page", "Resell to your users", "Dedicated support"],
  },
  {
    id: "whitelabel_source", name: "Source", price: 299, period: "one-time",
    features: ["Full source code", "Self-host forever", "No monthly fees", "Modify anything", "1 year of updates", "No revenue share"],
  },
];

function Tick() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: 2 }}><polyline points="20 6 9 17 4 12"/></svg>;
}

export default function PricingPage() {
  const [name, setName] = useState("");
  const [wlDomain, setWlDomain] = useState("");
  const [wlBrand, setWlBrand] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; plan: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  async function getKey(planId: string) {
    if (!name.trim()) { setError("Enter a name for your key first"); return; }
    if (planId.startsWith("whitelabel") && !wlDomain.trim()) { setError("Enter your custom domain"); return; }
    setLoading(planId); setError(null);
    const r = await fetch("http://localhost:8080/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, plan: planId, white_label_domain: wlDomain || undefined, white_label_brand: wlBrand || undefined }),
    });
    const data = await r.json();
    if (!r.ok) { setError(data.error); setLoading(null); return; }
    setResult(data); setLoading(null);
  }

  function downloadPage() {
    window.print();
  }

  return (
    <main ref={printRef} style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "system-ui, sans-serif" }}>

      {/* Hero */}
      <div style={{ textAlign: "center", padding: "80px 20px 48px", background: "radial-gradient(ellipse at top, #7c3aed18 0%, transparent 60%)" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#7c3aed22", border: "1px solid #7c3aed44", borderRadius: 20, padding: "4px 14px", fontSize: 12, color: "#a78bfa", marginBottom: 20 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", animation: "pulse 2s infinite" }} />
          Ridiculously affordable
        </div>
        <h1 style={{ fontSize: 48, fontWeight: 900, letterSpacing: "-2px", marginBottom: 12, lineHeight: 1.1 }}>
          One tool.<br />Every format.
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 16, maxWidth: 480, margin: "0 auto 32px" }}>
          Compress, convert, download, and transcribe any media. Start free, upgrade when you need more.
        </p>
        <button onClick={downloadPage}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--muted)", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download pricing PDF
        </button>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 20px 80px" }}>

        {/* Key name input */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 24px", marginBottom: 40, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Key name <span style={{ color: "var(--red)" }}>*</span></p>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My App, Production"
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 13, outline: "none" }} />
          </div>
          {error && <p style={{ fontSize: 12, color: "var(--red)", alignSelf: "center" }}>{error}</p>}
        </div>

        {/* Plans grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 16, marginBottom: 64 }}>
          {PLANS.map((p) => (
            <div key={p.id} style={{ background: "var(--surface)", border: `1px solid ${p.border}`, borderRadius: 20, padding: "24px 20px", display: "flex", flexDirection: "column", gap: 20, position: "relative", transition: "transform 0.15s", cursor: "default" }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-2px)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}>
              {p.tag && (
                <div style={{ position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)", background: p.border, color: "#fff", fontSize: 10, fontWeight: 800, padding: "2px 12px", borderRadius: 20, whiteSpace: "nowrap" }}>{p.tag}</div>
              )}
              <div>
                <p style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>{p.name}</p>
                <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
                  <span style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>$</span>
                  <span style={{ fontSize: 36, fontWeight: 900, letterSpacing: "-1px", color: p.border }}>{p.price}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 2 }}>/{p.period}</span>
                </div>
              </div>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 9, flex: 1 }}>
                {p.features.map((f) => (
                  <li key={f} style={{ display: "flex", gap: 8, fontSize: 12, color: "var(--muted)", alignItems: "flex-start" }}>
                    <Tick /><span style={{ color: "var(--text)" }}>{f}</span>
                  </li>
                ))}
              </ul>
              <button onClick={() => getKey(p.id)} disabled={loading === p.id}
                style={{ padding: "11px", borderRadius: 12, border: `1px solid ${p.border}`, fontWeight: 700, fontSize: 12, cursor: "pointer", background: p.id === "premium" ? p.border : "transparent", color: p.id === "premium" ? "#fff" : p.border, transition: "all 0.15s", opacity: loading === p.id ? 0.7 : 1 }}>
                {loading === p.id ? "Creating…" : p.cta}
              </button>
            </div>
          ))}
        </div>

        {/* White-label section */}
        <div style={{ marginBottom: 64 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase", color: "var(--muted)", whiteSpace: "nowrap" }}>White-label</p>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>
          <p style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", marginBottom: 32 }}>
            Your brand. Your domain. <strong style={{ color: "var(--text)" }}>Exclusively yours</strong> — no two companies share the same domain.
          </p>

          {/* WL inputs */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 600, margin: "0 auto 32px" }}>
            <div>
              <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Your domain</p>
              <input value={wlDomain} onChange={(e) => setWlDomain(e.target.value)} placeholder="compress.yourbrand.com"
                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 13, outline: "none" }} />
            </div>
            <div>
              <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Brand name</p>
              <input value={wlBrand} onChange={(e) => setWlBrand(e.target.value)} placeholder="YourBrand Compress"
                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 13, outline: "none" }} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, maxWidth: 800, margin: "0 auto" }}>
            {WL.map((w) => (
              <div key={w.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, padding: "24px 20px", display: "flex", flexDirection: "column", gap: 20 }}>
                <div>
                  <p style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>White-label {w.name}</p>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>$</span>
                    <span style={{ fontSize: 36, fontWeight: 900, letterSpacing: "-1px" }}>{w.price}</span>
                    <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 2 }}>/{w.period}</span>
                  </div>
                </div>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 9, flex: 1 }}>
                  {w.features.map((f) => (
                    <li key={f} style={{ display: "flex", gap: 8, fontSize: 12, alignItems: "flex-start" }}>
                      <Tick /><span style={{ color: "var(--text)" }}>{f}</span>
                    </li>
                  ))}
                </ul>
                <button onClick={() => getKey(w.id)} disabled={loading === w.id}
                  style={{ padding: "11px", borderRadius: 12, border: "1px solid var(--accent)", fontWeight: 700, fontSize: 12, cursor: "pointer", background: "var(--accent)", color: "#fff", opacity: loading === w.id ? 0.7 : 1 }}>
                  {loading === w.id ? "Creating…" : `Get ${w.name}`}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* How WL works */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, padding: "32px", marginBottom: 40 }}>
          <p style={{ fontWeight: 800, fontSize: 16, marginBottom: 24 }}>How white-label works</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24 }}>
            {[
              { n: "01", t: "Pick a plan", d: "Choose Basic, Pro, or Source License" },
              { n: "02", t: "Enter your domain", d: "We lock it exclusively to your account" },
              { n: "03", t: "Point DNS", d: "Add a CNAME record — takes 5 minutes" },
              { n: "04", t: "You're live", d: "Your brand, our infrastructure" },
            ].map((s) => (
              <div key={s.n}>
                <p style={{ fontSize: 28, fontWeight: 900, color: "var(--accent)", opacity: 0.3, marginBottom: 8 }}>{s.n}</p>
                <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{s.t}</p>
                <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>{s.d}</p>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[
            { q: "Can two companies share a white-label domain?", a: "No. Each domain is exclusively locked to one account. Attempting to claim a taken domain returns an error." },
            { q: "Is the Source License really one-time?", a: "Yes. $299 once, self-host forever. No monthly fees, no revenue share, no strings." },
            { q: "Can I cancel anytime?", a: "Yes. Monthly plans cancel immediately. Your API key continues working until the end of the billing period." },
            { q: "Can I resell on white-label?", a: "Yes, on White-label Pro. Charge your own users whatever you want — we don't take a cut." },
          ].map((f) => (
            <div key={f.q} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px" }}>
              <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{f.q}</p>
              <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>{f.a}</p>
            </div>
          ))}
        </div>

        {/* Key result */}
        {result && (
          <div style={{ marginTop: 32, background: "#22c55e11", border: "1px solid #22c55e44", borderRadius: 14, padding: "20px 24px" }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--green)", marginBottom: 10 }}>Your API key — save this now, it won't be shown again</p>
            <div style={{ display: "flex", gap: 10 }}>
              <code style={{ flex: 1, background: "var(--surface2)", padding: "10px 14px", borderRadius: 10, fontSize: 13, wordBreak: "break-all" }}>{result.key}</code>
              <button onClick={() => navigator.clipboard.writeText(result.key)}
                style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "none", color: "var(--text)", cursor: "pointer", fontSize: 12, fontWeight: 600, flexShrink: 0 }}>Copy</button>
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
              Plan: <strong style={{ color: "var(--text)" }}>{result.plan}</strong> · Header: <code style={{ background: "var(--surface2)", padding: "2px 6px", borderRadius: 4 }}>x-api-key: {result.key}</code>
            </p>
          </div>
        )}
      </div>

      <style>{`
        @media print {
          button { display: none !important; }
          input { border: 1px solid #ccc !important; }
          body { background: white !important; color: black !important; }
        }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
    </main>
  );
}
