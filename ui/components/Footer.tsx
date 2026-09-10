import Link from "next/link";
import { TheflateLogo } from "./Navbar";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="measure footer-inner">
        <div className="footer-top">
          <div className="footer-brand">
            <Link href="/" style={{ textDecoration: "none" }}>
              <TheflateLogo interactive />
            </Link>
            <p className="footer-tagline">
              Compress, convert, and share media instantly. No account required.
            </p>
            <div className="footer-note">
              Files are automatically deleted after 24h.
            </div>
          </div>

          <div className="footer-links">
            <div>
              <div className="footer-col-heading">Product</div>
              <div className="footer-col-links">
                <Link href="/" className="footer-link">Engine</Link>
                <Link href="/docs" className="footer-link">API Docs</Link>
                <Link href="/faq" className="footer-link">FAQ</Link>
              </div>
            </div>
            <div>
              <div className="footer-col-heading">Legal &amp; Trust</div>
              <div className="footer-col-links">
                <Link href="/terms" className="footer-link">Terms of Service</Link>
                <Link href="/privacy" className="footer-link">Privacy Policy</Link>
              </div>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <div className="footer-copy">
            &copy; {new Date().getFullYear()} theflate Engine. All rights reserved.
          </div>
          <div className="footer-badges">
            <span className="footer-badge">Zero Third-Party Tracking</span>
            <span className="footer-sep">•</span>
            <span className="footer-badge">Automated File Disposal</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
