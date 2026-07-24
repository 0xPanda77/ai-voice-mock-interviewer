import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

// Full-monospace direction (deliberate deviation from the design brief's
// serif/sans split, tried 2026-07-22): Geist Mono everywhere — display,
// body, and code all use one face.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Voice Mock Interviewer",
  description:
    "Paste a job description, get role-specific questions, then run a live voice mock interview and get scored feedback.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The font variable class must live on <html> (the `:root` element), not
    // <body>: Tailwind v4's @theme emits `--font-sans: var(--font-geist-mono)`
    // as a :root custom property, and custom properties resolve their var()
    // references where they're *defined* — with the variable only on <body>,
    // --font-sans computes to invalid at :root and the whole site silently
    // falls back to the system sans stack.
    <html lang="en" className={geistMono.variable}>
      <body className="antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
