import type { Metadata } from "next";
import { Luckiest_Guy, Nunito, Permanent_Marker, Special_Elite } from "next/font/google";
import type { ReactNode } from "react";
import { COVER_PRE_PAINT } from "@/components/shell/case-cover-script";
import "./globals.css";

// Self-hosted at build time and preloaded, so there is no layout shift and no
// request to Google from the browser. globals.css maps these variables to
// Tailwind's `font-sans` and `font-mono`.
// The game look (issue 166): Nunito, a rounded sans, for body copy, labels and
// data; Luckiest Guy, a hand-lettered cartoon face, for titles and buttons.
const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700", "800"], variable: "--font-nunito", display: "swap" });
const typed = Special_Elite({ subsets: ["latin"], weight: "400", variable: "--font-typed", display: "swap" });
const marker = Permanent_Marker({ subsets: ["latin"], weight: "400", variable: "--font-marker", display: "swap" });
const display = Luckiest_Guy({ subsets: ["latin"], weight: "400", variable: "--font-display-face", display: "swap" });

export const metadata: Metadata = {
  title: "Hobbs",
  description: "Stealth levels built from real buildings.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The cover's script below sets data-cover-done on <html> before React hydrates, on purpose:
    // suppressHydrationWarning covers that one element's own attributes, nothing under it.
    <html lang="en" suppressHydrationWarning className={`${nunito.variable} ${display.variable} ${typed.variable} ${marker.variable}`}>
      <head>
        {/* Before the first paint: a file already opened this visit never shows its cover (case-cover-script.ts). */}
        <script dangerouslySetInnerHTML={{ __html: COVER_PRE_PAINT }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
