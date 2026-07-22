import Link from "next/link";
import type { ReactNode } from "react";

// Shared header/footer chrome — kept in one place so the landing page and
// /interview stay visually identical (same logo, nav container, footer)
// without copy-pasting markup that then drifts.

export const GITHUB_URL = "https://github.com/0xPanda77/ai-voice-mock-interviewer";

export function WaveMark({ className = "" }: { className?: string }) {
  // A small four-bar waveform — this product's own mark (not Anthropic's
  // spike glyph). Ties the "voice" idea directly into the wordmark.
  return (
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      className={className}
      aria-hidden="true"
    >
      <rect x="1" y="7" width="3" height="6" rx="1.5" fill="currentColor" />
      <rect x="6.5" y="3" width="3" height="14" rx="1.5" fill="currentColor" />
      <rect x="12" y="5.5" width="3" height="9" rx="1.5" fill="currentColor" />
      <rect x="17" y="8.5" width="2" height="3" rx="1" fill="currentColor" />
    </svg>
  );
}

export function GitHubIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.73.5.98 5.24.98 11.52c0 4.84 3.13 8.94 7.47 10.38.55.1.75-.24.75-.53 0-.26-.01-.94-.01-1.85-3.04.66-3.68-1.47-3.68-1.47-.5-1.27-1.22-1.6-1.22-1.6-.99-.68.08-.67.08-.67 1.1.08 1.68 1.13 1.68 1.13.98 1.68 2.57 1.2 3.2.91.1-.71.38-1.2.69-1.48-2.43-.28-4.99-1.22-4.99-5.42 0-1.2.43-2.18 1.13-2.95-.11-.28-.49-1.4.11-2.92 0 0 .92-.3 3.02 1.13a10.4 10.4 0 0 1 5.5 0c2.1-1.43 3.02-1.13 3.02-1.13.6 1.52.22 2.64.11 2.92.7.77 1.13 1.75 1.13 2.95 0 4.21-2.57 5.14-5.01 5.41.39.34.74 1.02.74 2.06 0 1.49-.01 2.68-.01 3.05 0 .29.2.64.76.53 4.34-1.45 7.46-5.54 7.46-10.38C23.02 5.24 18.27.5 12 .5z" />
    </svg>
  );
}

export function SiteHeader({
  right,
  fixed = false,
}: {
  right?: ReactNode;
  fixed?: boolean;
}) {
  return (
    <header
      className={
        "border-b border-hairline bg-canvas z-20 " +
        (fixed ? "fixed top-0 left-0 right-0" : "")
      }
    >
      <div className="max-w-[1200px] mx-auto h-16 px-6 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center gap-2 type-title-sm text-ink shrink-0"
        >
          <WaveMark className="text-primary" />
          AI Voice Mock Interviewer
        </Link>
        {right && (
          <div className="flex items-center gap-4 min-w-0">{right}</div>
        )}
      </div>
    </header>
  );
}

export function SiteFooter({ fixed = false }: { fixed?: boolean }) {
  return (
    <footer
      className={
        "bg-surface-dark z-20 " +
        (fixed ? "fixed bottom-0 left-0 right-0" : "")
      }
    >
      <div
        className={
          "max-w-[1200px] mx-auto px-6 flex flex-wrap items-center justify-between gap-4 " +
          (fixed ? "py-4" : "py-12")
        }
      >
        <span className="flex items-center gap-2 type-body-sm text-on-dark">
          <WaveMark className="text-primary" />
          AI Voice Mock Interviewer
        </span>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 type-body-sm text-on-dark-soft hover:text-on-dark transition-colors"
        >
          <GitHubIcon />
          Source on GitHub ↗
        </a>
      </div>
    </footer>
  );
}
