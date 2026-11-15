import type { Metadata } from "next";
import { Luckiest_Guy, Nunito } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Self-hosted at build time and preloaded, so there is no layout shift and no
// request to Google from the browser. globals.css maps these variables to
// Tailwind's `font-sans` and `font-mono`.
// The game look (issue 166): Nunito, a rounded sans, for body copy, labels and
// data; Luckiest Guy, a hand-lettered cartoon face, for titles and buttons.
const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700", "800"], variable: "--font-nunito", display: "swap" });
const display = Luckiest_Guy({ subsets: ["latin"], weight: "400", variable: "--font-display-face", display: "swap" });

export const metadata: Metadata = {
  title: "Heist Anywhere",
  description: "Stealth levels built from real buildings.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${nunito.variable} ${display.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
