import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Terms of Service | theflate",
  description: "Terms of service, API usage policies, and billing terms for theflate.",
};

export default function TermsPage() {
  return (
    <div className="page-shell">
      <Navbar />

      <main style={{ flex: 1, maxWidth: 800, width: "100%", margin: "0 auto", padding: "60px 20px 80px" }}>
        <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-1px", color: "var(--color-fg)", marginBottom: 8 }}>
          Terms of Service
        </h1>
        <p style={{ fontSize: 13, color: "var(--color-fg-3)", marginBottom: 40 }}>
          Last updated: September 8, 2026
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 32, fontSize: 14, color: "var(--color-fg-2)", lineHeight: 1.7 }}>
          <section>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-fg)", marginBottom: 12 }}>1. Acceptable Use</h2>
            <p>
              By accessing theflate or using the theflate API, you agree not to submit media files that contain illegal content, malware, or material that infringes upon third-party intellectual property rights. You are solely responsible for all content uploaded under your session or API key.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-fg)", marginBottom: 12 }}>2. API Fair Usage & Rate Limits</h2>
            <p>
              API access is subject to rate limits based on your subscription tier (Anonymous: 10 req/min; Pro: 300 req/min; API Scale: 3,000 req/min). System abuse, automated DOS attacks, or attempting to bypass rate limit checks will result in immediate API key revocation.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-fg)", marginBottom: 12 }}>3. Subscriptions & Billing</h2>
            <p>
              Paid plans are billed in advance on a recurring monthly or annual basis. You may cancel your subscription at any time via your account dashboard. Refunds are governed by our 14-day performance guarantee for API tiers.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-fg)", marginBottom: 12 }}>4. SLA & Uptime Disclaimer</h2>
            <p>
              While API Growth and Scale tiers include a 99.9% target uptime SLA, free and sandbox tiers are provided on an "as-is" basis without warranties of uninterrupted availability.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-fg)", marginBottom: 12 }}>5. Limitation of Liability</h2>
            <p>
              In no event shall theflate or its operators be liable for indirect, incidental, or consequential damages resulting from lost files, encoding delays, or service interruptions beyond the amount paid by you in the preceding billing period.
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
