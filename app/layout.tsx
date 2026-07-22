import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
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
    <html lang="en">
      <body className={`${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
