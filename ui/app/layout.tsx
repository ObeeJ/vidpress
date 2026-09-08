import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/lib/toast";

export const metadata: Metadata = {
  title: "theflate | Deflate Media. Maximum Velocity.",
  description: "Theflate any media instantly — compress, convert, download, and transcribe.",
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
