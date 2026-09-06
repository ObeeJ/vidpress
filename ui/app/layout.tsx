import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/lib/toast";

export const metadata: Metadata = {
  title: "vidpress",
  description: "Compress anything. Fast.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
