import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/lib/toast";

/* Typography is the cheapest way to stop looking generic, and the previous
   build spent nothing on it — the whole app ran on the `-apple-system` stack,
   which renders as SF on Mac, Segoe on Windows and Roboto on Android. Three
   different products depending on who opened it.

   Archivo: an industrial grotesque with a genuine voice — tighter apertures
   and squarer terminals than the Inter/Helvetica default. Variable, so weights
   550 and 620 in globals.css are real instances, not synthesised.

   JetBrains Mono: reserved for numerals. File sizes, percentages, ETAs and job
   ids are this product's actual content, so they get tabular figures and stop
   jittering while they count. */

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
  icons: { icon: "/icon.svg" },
};

/* Split out of `metadata` because Next.js deprecated viewport keys there.
   `themeColor` keeps mobile browser chrome from flashing white against the
   near-black ground on load. */
export const viewport: Viewport = {
  themeColor: "#0C0C0E",
  colorScheme: "dark",
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
      {/* Layout lives in CSS, not in an inline style object. The previous
          version duplicated the background and colour here, which meant two
          places to change and one of them silently winning. */}
      <body className="min-h-screen flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
