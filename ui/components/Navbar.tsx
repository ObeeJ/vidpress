"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function TheflateLogo({ interactive = false }: { interactive?: boolean }) {
  const [pressed, setPressed] = useState(false);

  // The logo: a 3D isometric cube collapsing/deflating into a solid compact 2D neon tile.
  return (
    <div
      className={`logo-mark${interactive ? " logo-mark-interactive" : ""}${pressed ? " logo-mark-pressed" : ""}`}
      onMouseDown={() => interactive && setPressed(true)}
      onMouseUp={() => interactive && setPressed(false)}
      onMouseLeave={() => interactive && setPressed(false)}
    >
      <svg
        width="28"
        height="28"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="logo-svg"
        aria-label="theflate — media compression engine"
      >
        {/* Background tile */}
        <rect width="32" height="32" rx="7" fill="#171717" />

        {/* Ghosted 3D upper box wireframe representing raw uncompressed volume */}
        <polygon points="16,6 23,10 16,14 9,10" stroke="#C9F24E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.3" fill="none" className="logo-ghost-top" />
        <line x1="9" y1="10" x2="9" y2="15" stroke="#C9F24E" strokeWidth="1.5" strokeOpacity="0.2" className="logo-ghost-line" />
        <line x1="23" y1="10" x2="23" y2="15" stroke="#C9F24E" strokeWidth="1.5" strokeOpacity="0.2" className="logo-ghost-line" />
        <line x1="16" y1="14" x2="16" y2="19" stroke="#C9F24E" strokeWidth="1.5" strokeOpacity="0.25" className="logo-ghost-line" />

        {/* Solid compressed bottom diamond representing deflated high-density media */}
        <polygon points="16,19 24,23 16,27 8,23" fill="#C9F24E" fillOpacity="0.25" stroke="#C9F24E" strokeWidth="2" strokeLinejoin="round" className="logo-plane" />
        <circle cx="16" cy="23" r="1.8" fill="#C9F24E" className="logo-core" />
      </svg>
      <span className="logo-wordmark">
        <span className="logo-prefix">the</span>
        <span className="logo-suffix">flate</span>
      </span>
    </div>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theflate-theme") as "dark" | "light" | null;
    const initial = saved ?? "dark";
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, []);

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theflate-theme", next);
  }

  const links = [
    { href: "/", label: "Engine" },
    { href: "/docs", label: "API Docs" },
    { href: "/faq", label: "FAQ" },
  ];

  return (
    <header className="navbar">
      <div className="measure navbar-inner">
        <Link href="/" style={{ textDecoration: "none" }}>
          <TheflateLogo interactive />
        </Link>

        {/* Desktop nav */}
        <nav className="navbar-nav navbar-nav-desktop">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`navbar-link${active ? " navbar-link-active" : ""}`}
              >
                {link.label}
              </Link>
            );
          })}

          <button
            onClick={toggleTheme}
            className="theme-toggle"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark" ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </nav>

        {/* Mobile: theme toggle + hamburger */}
        <div className="navbar-nav navbar-nav-mobile">
          <button
            onClick={toggleTheme}
            className="theme-toggle"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          <button
            className="hamburger"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            <span className={`hamburger-line${menuOpen ? " hamburger-line-1-open" : ""}`} />
            <span className={`hamburger-line${menuOpen ? " hamburger-line-2-open" : ""}`} />
            <span className={`hamburger-line${menuOpen ? " hamburger-line-3-open" : ""}`} />
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="mobile-menu">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`mobile-menu-link${active ? " mobile-menu-link-active" : ""}`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      )}
    </header>
  );
}
