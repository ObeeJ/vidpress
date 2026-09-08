import Link from "next/link";
import { TheflateLogo } from "./Navbar";

export default function Footer() {
  return (
    <footer style={{ borderTop: "1px solid var(--border)", background: "#000000", padding: "48px 20px 32px", marginTop: "auto" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 32 }}>
          <div style={{ maxWidth: 360, display: "flex", flexDirection: "column", gap: 12 }}>
            <TheflateLogo />
            <p style={{ fontSize: 13, color: "#a1a1aa", lineHeight: 1.6 }}>
              Deflate media sizes instantly. Built for developers, product teams, and digital creators.
            </p>
            <div style={{ fontSize: 11, color: "#71717a", lineHeight: 1.5 }}>
              Free jobs purged after 24h • Paid subscriber outputs stored in vault for 7 days.
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(130px, 1fr))", gap: 32 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#ffffff", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Product</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Link href="/" style={{ fontSize: 13, color: "#a1a1aa", textDecoration: "none" }}>Engine</Link>
                <Link href="/pricing" style={{ fontSize: 13, color: "#a1a1aa", textDecoration: "none" }}>Pricing</Link>
                <Link href="/docs" style={{ fontSize: 13, color: "#a1a1aa", textDecoration: "none" }}>API Docs</Link>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#ffffff", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Legal & Trust</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Link href="/terms" style={{ fontSize: 13, color: "#a1a1aa", textDecoration: "none" }}>Terms of Service</Link>
                <Link href="/privacy" style={{ fontSize: 13, color: "#a1a1aa", textDecoration: "none" }}>Privacy Policy</Link>
              </div>
            </div>
          </div>
        </div>

        <div style={{ borderTop: "1px solid #18181b", paddingTop: 24, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ fontSize: 12, color: "#71717a" }}>
            © {new Date().getFullYear()} theflate Engine. All rights reserved.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 11, color: "#a1a1aa" }}>Zero Third-Party Tracking</span>
            <span style={{ fontSize: 11, color: "#3f3f46" }}>•</span>
            <span style={{ fontSize: 11, color: "#a1a1aa" }}>Automated File Disposal</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
