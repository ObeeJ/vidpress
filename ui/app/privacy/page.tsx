import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Privacy Policy | theflate",
  description: "Privacy policy, data retention, and automated file cleanup policy for theflate.",
};

export default function PrivacyPage() {
  return (
    <div className="page-shell">
      <Navbar />

      <main style={{ flex: 1, maxWidth: 800, width: "100%", margin: "0 auto", padding: "60px 20px 80px" }}>
        <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-1px", color: "var(--color-fg)", marginBottom: 8 }}>
          Privacy Policy
        </h1>
        <p style={{ fontSize: 13, color: "var(--color-fg-3)", marginBottom: 40 }}>
          Last updated: September 8, 2026
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 32, fontSize: 14, color: "var(--color-fg-2)", lineHeight: 1.7 }}>
          <section>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-fg)", marginBottom: 12 }}>1. Automated Media Retention & Disposal</h2>
            <p>
              theflate processes digital media (video, audio, images) exclusively to perform user-requested compression, format conversion, link extraction, or transcription. We do not inspect, retain, sell, or index your raw or processed media assets.
            </p>
            <ul style={{ paddingLeft: 20, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              <li><strong style={{ color: "var(--color-fg)" }}>Anonymous Jobs:</strong> Input and output files are automatically permanently deleted from volatile server storage after 24 hours.</li>
              <li><strong style={{ color: "var(--color-fg)" }}>Authenticated API Jobs:</strong> Files are stored in encrypted temporary vaults for up to 7 days before automated deletion, or deleted immediately upon explicit API deletion calls.</li>
            </ul>
          </section>

          <section>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-fg)", marginBottom: 12 }}>2. Information We Collect</h2>
            <p>
              We collect minimal metadata strictly necessary to operate our service:
            </p>
            <ul style={{ paddingLeft: 20, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              <li>IP addresses for rate limiting and fraud protection (retained for 48 hours).</li>
              <li>Account email addresses and API keys issued during membership subscriptions.</li>
              <li>Usage telemetry: API request counts, bandwidth processed, and job success rates.</li>
            </ul>
          </section>

          <section>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-fg)", marginBottom: 12 }}>3. OpenAI Whisper AI Processing</h2>
            <p>
              When requesting transcription services, audio streams are passed to local or isolated OpenAI Whisper models. No audio data or transcriptions are transmitted to third-party ad networks or used for AI model training.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-fg)", marginBottom: 12 }}>4. Security & Encryption</h2>
            <p>
              All traffic to theflate is encrypted in transit using standard TLS 1.3 encryption. Files are stored in isolated temporary directories with restricted process permissions.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-fg)", marginBottom: 12 }}>5. Contact</h2>
            <p>
              For privacy inquiries or custom enterprise data retention agreements, contact privacy@theflate.com.
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
