import Link from "next/link";
import { Fragment } from "react";
import { GITHUB_URL, SiteFooter, SiteHeader } from "./site-chrome";

// Landing page — the actual product lives at /interview. This page's only
// job: a visitor understands "paste a JD, do a voice interview, get
// feedback" within five seconds and clicks Start. One centered hero, three
// steps, nothing else.

const STEPS = [
  {
    n: "1",
    title: "Paste a job description",
    body: "Any real posting works.",
  },
  {
    n: "2",
    title: "Do the interview",
    body: "Answer out loud, live.",
  },
  {
    n: "3",
    title: "Get your feedback",
    body: "A score and honest notes.",
  },
];

// The logo's four-bar waveform, scaled up and animated — the one decorative
// element on the page. Heights/delays are hand-tuned for an organic pulse.
const HERO_BARS = [
  { h: 16, d: 0.0 },
  { h: 32, d: 0.5 },
  { h: 48, d: 0.2 },
  { h: 24, d: 0.7 },
  { h: 40, d: 0.35 },
  { h: 28, d: 0.9 },
  { h: 18, d: 0.55 },
];

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <SiteHeader
        right={
          <>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="type-body-sm text-muted hover:text-ink transition-colors"
            >
              GitHub
            </a>
            {/* Hidden on small screens — the hero CTA is immediately below,
                and a nowrap button here would force horizontal overflow. */}
            <Link href="/interview" className="btn btn-primary hidden sm:inline-flex">
              Start a mock interview
            </Link>
          </>
        }
      />

      {/* --- Hero --- */}
      <main className="relative flex-1 flex flex-col overflow-hidden">
        {/* Soft coral glow behind the hero — atmosphere, not a section. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-[520px] w-[760px] max-w-none rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, rgba(204, 120, 92, 0.12), transparent 70%)",
          }}
        />

        <section className="relative flex-1 flex flex-col items-center justify-center text-center px-6 pt-24 pb-16">
          <div className="flex flex-col items-center gap-7 max-w-[720px]">
            {/* Animated waveform — the wordmark, alive. */}
            <div
              aria-hidden="true"
              className="rise rise-1 flex items-center gap-[7px] h-12"
            >
              {HERO_BARS.map((bar, i) => (
                <span
                  key={i}
                  className="wave-bar w-[7px] bg-primary"
                  style={{ height: bar.h, animationDelay: `${bar.d}s` }}
                />
              ))}
            </div>

            <h1 className="rise rise-2 type-display-xl text-ink">
              Practice your next interview out loud.
            </h1>

            <p className="rise rise-2 type-body-md text-body max-w-[520px]">
              Paste a job description, do a live voice interview with an AI
              interviewer, and get honest feedback the moment you hang up.
            </p>

            <div className="rise rise-3 flex flex-col items-center gap-3 pt-2">
              <Link href="/interview" className="btn btn-primary btn-lg">
                Start a mock interview
              </Link>
              <span className="type-caption text-muted-soft">
                No account · Runs in your browser
              </span>
            </div>
          </div>
        </section>

        {/* --- Three steps --- */}
        <section className="relative border-t border-hairline-soft">
          <div className="rise rise-4 max-w-[900px] mx-auto px-6 py-14 flex flex-col sm:flex-row items-center justify-center gap-8 sm:gap-5">
            {STEPS.map((step, i) => (
              <Fragment key={step.n}>
                {i > 0 && (
                  <span
                    aria-hidden="true"
                    className="type-body-md text-muted-soft rotate-90 sm:rotate-0"
                  >
                    →
                  </span>
                )}
                <div className="flex flex-col items-center text-center gap-2 sm:w-56">
                  <span className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary type-caption font-semibold">
                    {step.n}
                  </span>
                  <h2 className="type-title-sm text-ink">{step.title}</h2>
                  <p className="type-caption text-muted">{step.body}</p>
                </div>
              </Fragment>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
