"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function VpxLogo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="6" fill="#000000" stroke="#27272a" strokeWidth="1.5" />
        <path d="M7 8L16 17L25 8M25 24L16 15L7 24" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter" />
        <polygon points="17,14 21,17 17,20" fill="#ffffff" />
      </svg>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 900, letterSpacing: "-0.5px", color: "#ffffff" }}>VPX</span>
          <span style={{ fontSize: 9, fontWeight: 700, background: "#18181b", color: "#a1a1aa", border: "1px solid #27272a", borderRadius: 4, padding: "1px 5px", letterSpacing: "0.5px" }}>2.4</span>
        </div>
        <span style={{ fontSize: 10, color: "#71717a", fontWeight: 500, letterSpacing: "-0.2px" }}>High-Velocity Media Pipeline</span>
      </div>
    </div>
  );
}

export default function Navbar() {
  const pathname = usePathname();

  const links = [
    { href: "/", label: "Engine" },
    { href: "/poem", label: "P.O.E.M & Vision" },
    { href: "/pricing", label: "Membership & API Tiers" },
    { href: "/docs", label: "API Reference" },
  ];

  return (
    <header style={{ borderBottom: "1px solid var(--border)", background: "rgba(0, 0, 0, 0.95)", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link href="/" style={{ textDecoration: "none" }}>
          <VpxLogo />
        </Link>

        <nav style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                style={{
                  padding: "6px 14px",
                  borderRadius: 9999,
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  color: active ? "#ffffff" : "#a1a1aa",
                  background: active ? "#18181b" : "transparent",
                  border: `1px solid ${active ? "#27272a" : "transparent"}`,
                  textDecoration: "none",
                  transition: "all 0.15s ease",
                }}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 9999, background: "#09090b", border: "1px solid #27272a" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "#a1a1aa" }}>Rust Core Operational</span>
          </div>
          <Link href="/pricing" className="vpx-button-primary" style={{ fontSize: 12, padding: "6px 14px" }}>
            Get API Key
          </Link>
        </div>
      </div>
    </header>
  );
}
