import Link from "next/link";
import { VpxLogo } from "./Navbar";

export default function Footer() {
  return (
    <footer style={{ borderTop: "1px solid var(--border)", background: "#000000", padding: "48px 20px 32px", marginTop: "auto" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 32 }}>
          <div style={{ maxWidth: 360, display: "flex", flexDirection: "column", gap: 12 }}>
            <VpxLogo />
            <p style={{ fontSize: 13, color: "#a1a1aa", lineHeight: 1.6 }}>
              High-velocity Rust media pipeline engineered for maximum compression, zero infrastructure overhead, and instant transcription.
            </p>
            <div style={{ fontSize: 11, color: "#71717a" }}>
              Built for high-volume developers, digital operators, and product teams.
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(130px, 1fr))", gap: 24 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#ffffff", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Product</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Link href="/" style={{ fontSize: 13, color: "#a1a1aa", textDecoration: "none" }}>Media Engine</Link>
                <Link href="/pricing" style={{ fontSize: 13, color: "#a1a1aa", textDecoration: "none" }}>SaaS & Memberships</Link>
                <Link href="/docs" style={{ fontSize: 13, color: "#a1a1aa", textDecoration: "none" }}>API Reference</Link>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#ffffff", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>P.O.E.M Framework</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Link href="/poem" style={{ fontSize: 13, color: "#a1a1aa", textDecoration: "none" }}>Vision & Premise</Link>
                <Link href="/poem#problem" style={{ fontSize: 13, color: "#a1a1aa", textDecoration: "none" }}>Problem Breakdown</Link>
                <Link href="/poem#solution" style={{ fontSize: 13, color: "#a1a1aa", textDecoration: "none" }}>VPX Engine Solution</Link>
                <Link href="/poem#strategy" style={{ fontSize: 13, color: "#a1a1aa", textDecoration: "none" }}>Growth Strategy</Link>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#ffffff", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Legal & Trust</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Link href="/terms" style={{ fontSize: 13, color: "#a1a1aa", textDecoration: "none" }}>Terms of Service</Link>
                <Link href="/privacy" style={{ fontSize: 13, color: "#a1a1aa", textDecoration: "none" }}>Privacy Policy</Link>
                <a href="http://localhost:8080/health" target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#a1a1aa", textDecoration: "none" }}>System Health API</a>
              </div>
            </div>
          </div>
        </div>

        <div style={{ borderTop: "1px solid #18181b", paddingTop: 24, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ fontSize: 12, color: "#71717a" }}>
            © {new Date().getFullYear()} VPX Engine. All rights reserved. Self-hostable Rust Core.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 11, color: "#a1a1aa" }}>Zero Dark Patterns</span>
            <span style={{ fontSize: 11, color: "#3f3f46" }}>•</span>
            <span style={{ fontSize: 11, color: "#a1a1aa" }}>Automated 24h File Cleanup</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
