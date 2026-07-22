import Link from "next/link";

// Landing page — describes the product and its user journey. The actual
// product lives at /interview (JD -> questions -> live voice interview ->
// scored feedback); this page's only job is to get a visitor to understand
// that flow in one scroll and start it.

function WaveMark({ className = "" }: { className?: string }) {
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

const JOURNEY_STEPS = [
  {
    n: "01",
    title: "Paste the job description",
    body: "Drop in any real job posting you're preparing for. No account, no setup — the page is ready the moment you land on it.",
  },
  {
    n: "02",
    title: "Get role-specific questions",
    body: "An LLM reads the JD and writes questions a recruiter would actually ask for this exact role, not a generic top-10 list.",
  },
  {
    n: "03",
    title: "Answer out loud, live",
    body: "A real-time voice session, not a chatbox. The interviewer speaks first, listens while you answer, and follows up the way a person would.",
  },
  {
    n: "04",
    title: "Get scored feedback",
    body: "The moment you hang up: a score, a tier, and three specific, honest notes on how you actually came across.",
  },
];

const FEATURES = [
  {
    title: "No backspace",
    body: "Speaking under pressure with no time to edit is the actual skill a screening call tests. Typing into a chatbox never rehearses that.",
  },
  {
    title: "Real turn-taking",
    body: "Native speech-to-speech, not a speech-to-text-to-chatbot pipeline. The model handles interruptions and pauses the way a live interviewer does.",
  },
  {
    title: "Private by default",
    body: "No accounts, no server-side storage of your sessions. Everything lives in your browser until you close the tab.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex flex-col">
      {/* --- Top nav --- */}
      <header className="border-b border-hairline">
        <div className="max-w-[1200px] mx-auto h-16 px-6 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 type-title-sm text-ink"
          >
            <WaveMark className="text-primary" />
            AI Voice Mock Interviewer
          </Link>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/0xPanda77/ai-voice-mock-interviewer"
              target="_blank"
              rel="noopener noreferrer"
              className="type-body-sm text-muted hover:text-ink transition-colors"
            >
              GitHub
            </a>
            <Link
              href="/interview"
              className="inline-flex items-center justify-center h-10 px-5 rounded-md bg-primary text-on-primary type-body-sm font-medium hover:bg-primary-active transition-colors"
            >
              Start a mock interview
            </Link>
          </div>
        </div>
      </header>

      {/* --- Hero --- */}
      <section className="bg-canvas">
        <div className="max-w-[1200px] mx-auto px-6 py-24 grid md:grid-cols-2 gap-12 items-center">
          <div className="flex flex-col gap-6">
            <span className="self-start type-caption-upper text-muted bg-surface-card rounded-full px-3 py-1">
              Live voice, not another chatbot
            </span>
            <h1 className="type-display-xl text-ink">
              Practice the call before it counts.
            </h1>
            <p className="type-body-md text-body max-w-md">
              Paste a job description. Answer real, role-specific questions
              out loud to an AI interviewer that talks back — no backspace,
              no rehearsed script. Get honest feedback the moment you hang
              up.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Link
                href="/interview"
                className="inline-flex items-center justify-center h-10 px-5 rounded-md bg-primary text-on-primary type-body-sm font-medium hover:bg-primary-active transition-colors"
              >
                Start a mock interview
              </Link>
              <a
                href="#how-it-works"
                className="type-body-sm text-ink underline underline-offset-4"
              >
                How it works ↓
              </a>
            </div>
          </div>

          {/* A live look at what a session actually sounds/reads like —
              product chrome, not a stock illustration. */}
          <div className="bg-surface-dark rounded-xl p-6 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="type-caption text-on-dark-soft font-mono">
                in-session · 12:41 left
              </span>
            </div>
            <div className="flex flex-col gap-3 type-body-sm text-on-dark">
              <p>
                <span className="font-semibold text-primary">
                  Interviewer:
                </span>{" "}
                What drew you to this role, and how does it line up with
                where you want your career to go?
              </p>
              <p className="text-on-dark-soft">
                <span className="font-semibold text-on-dark">Me:</span> So
                I&apos;ve been building full-stack for about eight years,
                mostly in TypeScript and React...
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --- User journey --- */}
      <section id="how-it-works" className="bg-surface-soft">
        <div className="max-w-[1200px] mx-auto px-6 py-24 flex flex-col gap-12">
          <div className="flex flex-col gap-3 max-w-xl">
            <span className="type-caption-upper text-muted">The flow</span>
            <h2 className="type-display-md text-ink">
              One conversation, four steps.
            </h2>
            <p className="type-body-md text-body">
              From a job posting to spoken feedback, in one sitting — no
              context-switching between tools.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {JOURNEY_STEPS.map((step) => (
              <div
                key={step.n}
                className="bg-surface-card rounded-lg p-8 flex flex-col gap-3"
              >
                <span className="type-display-sm text-primary">
                  {step.n}
                </span>
                <h3 className="type-title-md text-ink">{step.title}</h3>
                <p className="type-body-sm text-body">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --- Why voice --- */}
      <section className="bg-canvas">
        <div className="max-w-[1200px] mx-auto px-6 py-24 flex flex-col gap-12">
          <div className="flex flex-col gap-3 max-w-xl">
            <span className="type-caption-upper text-muted">
              Why voice, not text
            </span>
            <h2 className="type-display-md text-ink">
              A chatbox rehearses content. This rehearses you.
            </h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex flex-col gap-3">
                <h3 className="type-title-md text-ink">{f.title}</h3>
                <p className="type-body-sm text-body">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --- Coral CTA band --- */}
      <section className="max-w-[1200px] mx-auto w-full px-6 py-16">
        <div className="bg-primary rounded-lg px-8 py-16 flex flex-col items-start gap-6">
          <h2 className="type-display-sm text-on-primary max-w-lg">
            Your next screening call is coming. Walk in already having done
            this once.
          </h2>
          <Link
            href="/interview"
            className="inline-flex items-center justify-center h-10 px-5 rounded-md bg-canvas text-ink type-body-sm font-medium hover:bg-surface-soft transition-colors"
          >
            Start a mock interview
          </Link>
        </div>
      </section>

      {/* --- Footer --- */}
      <footer className="bg-surface-dark">
        <div className="max-w-[1200px] mx-auto px-6 py-12 flex flex-wrap items-center justify-between gap-4">
          <span className="flex items-center gap-2 type-body-sm text-on-dark">
            <WaveMark className="text-primary" />
            AI Voice Mock Interviewer
          </span>
          <a
            href="https://github.com/0xPanda77/ai-voice-mock-interviewer"
            className="type-body-sm text-on-dark-soft hover:text-on-dark transition-colors"
          >
            Source on GitHub ↗
          </a>
        </div>
      </footer>
    </div>
  );
}
