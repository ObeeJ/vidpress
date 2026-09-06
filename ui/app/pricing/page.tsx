"use client";
import { useState } from "react";

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    tag: null,
    color: "var(--border)",
    accent: "var(--muted)",
    features: [
      "10 compressions / day",
      "Up to 200MB per file",
      "All formats & presets",
      "QR code sharing",
      "Files deleted after 24h",
      "Whisper base transcription",
    ],
    cta: "Start free",
  },
  {
    id: "premium",
    name: "Premium",
    price: "$2",
    period: "/ month",
    tag: "Most popular",
    color: "var(--accent)",
    accent: "var(--accent)",
    features: [
      "Unlimited compressions",
      "Up to 2GB per file",
      "API access (300 req/min)",
      "Webhook notifications",
      "YouTube / IG / TikTok / X download",
      "Whisper medium transcription",
      "SRT / VTT subtitle export",
      "Batch jobs (up to 10 at once)",
      "Metadata stripping",
      "Video thumbnail extraction",
      "Files kept for 7 days",
      "Priority processing",
    ],
    cta: "Get Premium",
  },
  {
    id: "api_starter",
    name: "API Starter",
    price: "$5",
    period: "/ month",
    tag: "For developers",
    color: "#06b6d4",
    accent: "#06b6d4",
    features: [
      "Everything in Premium",
      "120 API req/min",
      "Up to 5,000 jobs/month",
      "Webhook HMAC signing",
      "API usage dashboard",
      "Email support",
    ],
    cta: "Get API Starter",
  },
  {
    id: "api_growth",
    name: "API Growth",
    price: "$15",
    period: "/ month",
    tag: "For startups",
    color: "#8b5cf6",
    accent: "#8b5cf6",
    features: [
      "Everything in API Starter",
      "600 API req/min",
      "Up to 50,000 jobs/month",
      "Custom output filenames",
      "Dedicated job queue",
      "Priority email support",
    ],
    cta: "Get API Growth",
  },
  {
    id: "api_scale",
    name: "API Scale",
    price: "$49",
    period: "/ month",
    tag: "For production",
    color: "#f59e0b",
    accent: "#f59e0b",
    features: [
      "Everything in API Growth",
      "3,000 API req/min",
      "Unlimited jobs",
      "SLA 99.9% uptime",
      "Slack support",
      "Custom retention period",
    ],
    cta: "Get API Scale",
  },
];

const WL_TIERS = [
  {
    id: "whitelabel_basic",
    name: "White-label Basic",
    price: "$19",
    period: "/ month",
    features: [
      "Remove all vidpress branding",
      "Your logo + brand colors",
      "Custom domain (compress.yourbrand.com)",
      "Exclusive — no one else gets your domain",
      "All API Scale features included",
      "Setup guide + DNS instructions",
    ],
  },
  {
    id: "whitelabel_pro",
    name: "White-label Pro",
    price: "$49",
    period: "/ month",
    features: [
      "Everything in Basic",
      "Custom email notifications (from your domain)",
      "Your own API key namespace (yourbrand_xxx)",
      "Custom pricing page with your rates",
      "Resell to your own users",
      "Priority dedicated support",
    ],
  },
  {
    id: "whitelabel_source",
    name: "Source License",
    price: "$299",
    period: "one-time",
    features: [
      "Full source code",
      "Self-host forever, no monthly fee",
      "Deploy on your own servers",
      "Modify anything",
      "1 year of updates included",
      "No revenue share",
    ],
  },
];

function Check({ color }: { color: string }) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" style={{ flexShrink: 0, marginTop: 1 }}><polyline points="20 6 9 17 4 12"/></svg>;
}

export default function PricingPage() {
  const [name, setName] = useState("");
  const [wlDomain, setWlDomain] = useState("");
  const [wlBrand, setWlBrand] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [key, setKey] = useState<{ key: string; plan: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function getKey(planId: string) {
    if (!name.trim()) { setError("Enter a name for your key first"); return; }
    if (planId.startsWith("whitelabel") && !wlDomain.trim()) { setError("Enter your custom domain for white-label"); return; }
    setLoading(planId); setError(null);
    const r = await fetch("http://localhost:8080/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name, plan: planId,
        white_label_domain: wlDomain || undefined,
        white_label_brand: wlBrand || undefined,
      }),
    });
    const data = await r.json();
    if (!r.ok) { setError(data.error); setLoading(null); return; }
    setKey(data);
    setLoading(null);
  }

  return (
    <main style={{ minHeight: "100vh", padding: "60px 20px", background: "var(--bg)" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 48 }}>

        {/* Header */}
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.5px", marginBottom: 8 }}>Ridiculously affordable</h1>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>No hidden fees. No per-job charges. Cancel anytime.</p>
        </div>

        {/* Key name input — shared */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 13, fontWeight: 600 }}>Name your API key <span style={{ color: "var(--red)", fontSize: 11 }}>required</span></p>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. My App, Production, Personal"
            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 13, outline: "none" }} />
          {error && <p style={{ fontSize: 12, color: "var(--red)" }}>{error}</p>}
        </div>

        {/* Individual + API plans */}
        <div>
          <p style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", marginBottom: 16 }}>Individual & API Plans</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            {PLANS.map((plan) => (
              <div key={plan.id} style={{
                background: "var(--surface)", border: `2px solid ${plan.tag === "Most popular" ? plan.color : "var(--border)"}`,
                borderRadius: 16, padding: "20px 16px", display: "flex", flexDirection: "column", gap: 16, position: "relative",
              }}>
                {plan.tag && (
                  <div style={{ position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)", background: plan.color, color: "#fff", fontSize: 10, fontWeight: 800, padding: "2px 12px", borderRadius: 20, whiteSpace: "nowrap" }}>
                    {plan.tag}
                  </div>
                )}
                <div>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{plan.name}</p>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                    <span style={{ fontSize: 28, fontWeight: 800, color: plan.accent }}>{plan.price}</span>
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>{plan.period}</span>
                  </div>
                </div>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                  {plan.features.map((f) => (
                    <li key={f} style={{ display: "flex", gap: 7, fontSize: 12, alignItems: "flex-start" }}>
                      <Check color={plan.accent} />{f}
                    </li>
                  ))}
                </ul>
                <button onClick={() => getKey(plan.id)} disabled={loading === plan.id}
                  style={{ padding: "10px", borderRadius: 10, border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer", background: plan.tag === "Most popular" ? plan.color : "var(--surface2)", color: plan.tag === "Most popular" ? "#fff" : "var(--text)", opacity: loading === plan.id ? 0.7 : 1 }}>
                  {loading === plan.id ? "Creating…" : plan.cta}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* White-label section */}
        <div>
          <p style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", marginBottom: 8 }}>White-label</p>
          <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
            Your brand. Your domain. Your product. Each white-label domain is <strong style={{ color: "var(--text)" }}>exclusively yours</strong> — no other company can use the same domain or branding.
          </p>

          {/* WL domain inputs */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            <div>
              <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Your custom domain</p>
              <input value={wlDomain} onChange={(e) => setWlDomain(e.target.value)}
                placeholder="compress.yourbrand.com"
                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 13, outline: "none" }} />
            </div>
            <div>
              <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Your brand name</p>
              <input value={wlBrand} onChange={(e) => setWlBrand(e.target.value)}
                placeholder="YourBrand Compress"
                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 13, outline: "none" }} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {WL_TIERS.map((tier) => (
              <div key={tier.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "20px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{tier.name}</p>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                    <span style={{ fontSize: 28, fontWeight: 800 }}>{tier.price}</span>
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>{tier.period}</span>
                  </div>
                </div>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                  {tier.features.map((f) => (
                    <li key={f} style={{ display: "flex", gap: 7, fontSize: 12, alignItems: "flex-start" }}>
                      <Check color="var(--green)" />{f}
                    </li>
                  ))}
                </ul>
                <button onClick={() => getKey(tier.id)} disabled={loading === tier.id}
                  style={{ padding: "10px", borderRadius: 10, border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer", background: "var(--accent)", color: "#fff", opacity: loading === tier.id ? 0.7 : 1 }}>
                  {loading === tier.id ? "Creating…" : "Get " + tier.name.split(" ")[1]}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* How white-label works */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "24px" }}>
          <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>How white-label works</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            {[
              { step: "1", title: "Pick a plan", desc: "Choose Basic, Pro, or Source License above" },
              { step: "2", title: "Enter your domain", desc: "e.g. compress.yourbrand.com — we lock it to you exclusively" },
              { step: "3", title: "Point DNS", desc: "Add a CNAME record pointing to our servers. Takes 5 minutes." },
              { step: "4", title: "You're live", desc: "Your users see your brand. We handle all the infrastructure." },
            ].map((s) => (
              <div key={s.step} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--accent)22", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13 }}>{s.step}</div>
                <p style={{ fontWeight: 700, fontSize: 13 }}>{s.title}</p>
                <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Key display */}
        {key && (
          <div style={{ background: "#22c55e11", border: "1px solid #22c55e44", borderRadius: 14, padding: "20px" }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--green)", marginBottom: 8 }}>Your API key — save this now</p>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <code style={{ flex: 1, background: "var(--surface2)", padding: "10px 14px", borderRadius: 10, fontSize: 13, wordBreak: "break-all" }}>{key.key}</code>
              <button onClick={() => navigator.clipboard.writeText(key.key)}
                style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "none", color: "var(--text)", cursor: "pointer", fontSize: 12, fontWeight: 600, flexShrink: 0 }}>Copy</button>
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
              Plan: <strong style={{ color: "var(--text)" }}>{key.plan}</strong> · Use as: <code style={{ background: "var(--surface2)", padding: "2px 6px", borderRadius: 4 }}>x-api-key: {key.key}</code>
            </p>
          </div>
        )}

        {/* FAQ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontWeight: 700, fontSize: 15 }}>Common questions</p>
          {[
            { q: "Can two companies have the same white-label domain?", a: "No. Each domain is exclusively locked to one account. If compress.acme.com is taken, no one else can use it." },
            { q: "What happens if I cancel white-label?", a: "Your domain stops resolving to our servers. Your API key continues working on the API Scale plan." },
            { q: "Is the Source License really one-time?", a: "Yes. $299 once, you own the code, self-host forever. No monthly fees, no revenue share." },
            { q: "Can I resell access to my white-label?", a: "Yes, on White-label Pro. You can charge your own users whatever you want." },
          ].map((faq) => (
            <div key={faq.q} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px" }}>
              <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{faq.q}</p>
              <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>{faq.a}</p>
            </div>
          ))}
        </div>

      </div>
    </main>
  );
}
