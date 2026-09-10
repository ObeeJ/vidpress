import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/lib/toast";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "theflate | Compress, convert, transcribe",
  description:
    "Compress video, audio and images by up to 90% with no visible quality loss. Convert between formats, pull media from a link, and transcribe to text.",
  icons: { icon: "/icon.svg", shortcut: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)",  color: "#0C0C0E" },
    { media: "(prefers-color-scheme: light)", color: "#f5f5f5" },
  ],
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen flex flex-col">
        {/* Blocking script: reads localStorage before first paint so there's
            no flash of the wrong theme. Must be inline and before any content. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('theflate-theme');document.documentElement.setAttribute('data-theme',t||'dark');})();`,
          }}
        />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
