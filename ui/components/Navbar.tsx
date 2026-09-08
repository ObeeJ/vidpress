"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function TheflateLogo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width="26" height="26" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="6" fill="#000000" stroke="#27272a" strokeWidth="1.5" />
        <path d="M7 10H25M7 16H20M7 22H14" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
        <polygon points="21,19 25,22 21,25" fill="#ffffff" />
      </svg>
      <span style={{ fontSize: 18, fontWeight: 900, letterSpacing: "-0.5px", color: "#ffffff" }}>theflate</span>
    </div>
  );
}

export default function Navbar() {
  const pathname = usePathname();

  const links = [
    { href: "/", label: "Engine" },
    { href: "/pricing", label: "Pricing" },
    { href: "/docs", label: "API Docs" },
  ];

  return (
    <header style={{ borderBottom: "1px solid var(--border)", background: "rgba(0, 0, 0, 0.95)", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link href="/" style={{ textDecoration: "none" }}>
          <TheflateLogo />
        </Link>

        <nav style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                style={{
                  padding: "6px 16px",
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

        <Link href="/pricing" className="vpx-button-primary" style={{ fontSize: 13, padding: "7px 18px" }}>
          Get API Key
        </Link>
      </div>
    </header>
  );
}
