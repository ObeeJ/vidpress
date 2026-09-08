import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/lib/toast";

export const metadata: Metadata = {
  title: "VPX | High-Velocity Media Pipeline",
  description: "Compress, convert, download, and transcribe any media instantly with sub-second Rust execution.",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#000000", color: "#f4f4f5" }}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
