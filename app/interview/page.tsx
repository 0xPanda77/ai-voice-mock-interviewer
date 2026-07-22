"use client";

// /interview (formerly /voice) — the real wired-up flow (PRD's one-line
// pitch): paste a JD, get role-specific questions generated, run a live
// voice interview on those exact questions, then get score/tier/feedback at
// the end. This is Milestone 3 (issue #10) — it replaces M2's
// hardcoded-placeholder demo with the real /api/questions -> voice session
// -> /api/score loop.
//
// app/page.tsx is the marketing landing page; this is the product itself.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Feedback, Question, Turn } from "@/lib/types";
import { fetchQuestions, fetchScore } from "@/lib/api-client";
import { connectRelay, base64ToArrayBuffer, type RelayClient } from "./lib/relay-client";
import { startMicCapture, type MicCapture } from "./lib/mic-capture";
import { createAudioPlayer, type AudioPlayer } from "./lib/audio-playback";
import {
  loadOrCreateCurrentSession,
  saveSession,
  type Session,
} from "@/lib/session-store";

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL || "ws://localhost:8787";

// Dev/test shortcut (screening-call-mode branch): skip the real
// /api/questions call (costs an LLM request and ~seconds of latency every
// time) when iterating on the voice loop itself — load this fixed
// screening-call question set instead. Matches what generateQuestions()
// produces for a Example.ai-shaped JD (see lib/llm/gemini-text-llm.ts).
const TEST_JD = `
AI Product Engineer at Example.ai. Junior-Mid, first
engineering hire alongside our CTO. Build AI-powered features across our
recruitment platform: voice AI, intelligent automation, smart search. Work
with LLMs, prompt design, structured outputs, function calling, simple
agentic workflows. Full-stack ownership from idea to production.
`.trim();

const TEST_QUESTIONS: Question[] = [
  { text: "To start, could you introduce yourself and walk me through your background?" },
  {
    text:
      "What drew you to Example.ai's mission, and how does this role align " +
      "with your long-term career goals as an engineer?",
  },
  {
    text:
      "Could you walk me through a specific AI-powered feature you have " +
      "built and deployed to production, highlighting the challenges you " +
      "faced and how you handled them?",
  },
];

// 15-minute hard stop (PRD §10/§15) — bounds real Gemini Live cost per
// session. Warn in the last 2 minutes so an abrupt end doesn't surprise
// mid-sentence.
const SESSION_LIMIT_SECONDS = 15 * 60;
const SESSION_WARNING_SECONDS = 2 * 60;

const WIZARD_STEPS: { step: 1 | 2 | 3; label: string }[] = [
  { step: 1, label: "Job description" },
  { step: 2, label: "Live interview" },
  { step: 3, label: "Feedback" },
];

function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Overall page flow. Distinct from the voice-connection Status below —
// `stage` tracks where we are in JD -> questions -> voice -> feedback.
type Stage =
  | "jd" // entering/editing JD, no questions yet
  | "questions-loading"
  | "questions-ready" // questions generated, voice session not started yet
  | "voice" // in the voice session (see VoiceStatus for finer state)
  | "scoring"
  | "scored";

type VoiceStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "in-session"
  | "error"
  | "ended";

export default function VoicePage() {
  const [session, setSession] = useState<Session | null>(null);

  const [jd, setJd] = useState("");
  const [stage, setStage] = useState<Stage>("jd");

  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionsError, setQuestionsError] = useState<string | null>(null);

  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [meSpeaking, setMeSpeaking] = useState(false);

  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);

  const [secondsRemaining, setSecondsRemaining] = useState(SESSION_LIMIT_SECONDS);

  const relayRef = useRef<RelayClient | null>(null);
  // handleEndSession is defined after this ref would need it (and is
  // recreated each render), so the timer effect below calls through this
  // ref rather than depending on the function identity directly.
  const handleEndSessionRef = useRef<() => void>(() => {});
  const micRef = useRef<MicCapture | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  // Accumulate transcript.delta text per open turn, flush a Turn on turn.end.
  const pendingTextRef = useRef<{ ai: string; me: string }>({ ai: "", me: "" });
  // Keep a ref mirror of transcript for use inside the session.end handler
  // (closures captured at connect-time would otherwise see a stale empty
  // array — see handleEndSession).
  const transcriptRef = useRef<Turn[]>([]);

  // Load (or create) the session on mount, hydrate local state from it —
  // same session shape/store as the M1 text loop (lib/session-store.ts),
  // so JD/questions/transcript/feedback for this real flow live together as
  // ONE session (PRD §12).
  useEffect(() => {
    const s = loadOrCreateCurrentSession();
    setSession(s);
    setJd(s.jd);
    setQuestions(s.questions);
    setFeedback(s.feedback);
    if (s.transcript.length > 0) {
      setTranscript(s.transcript);
      transcriptRef.current = s.transcript;
    }
    if (s.jd && s.questions.length > 0) {
      setStage(s.feedback ? "scored" : "questions-ready");
    }
  }, []);

  function persist(patch: Partial<Session>) {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      saveSession(next);
      return next;
    });
  }

  function persistTranscript(next: Turn[]) {
    transcriptRef.current = next;
    persist({ transcript: next });
  }

  async function handleGenerateQuestions() {
    setQuestionsError(null);

    // If the JD in the box is still exactly the example JD (loaded via
    // "Use example job description" and left untouched), skip the LLM
    // entirely — reuse its matching canned TEST_QUESTIONS and go straight
    // into the live interview (step 2), the same as clicking "Start voice
    // session" would once questions exist. Pass TEST_QUESTIONS explicitly
    // rather than relying on the `questions` state var, which wouldn't have
    // committed yet within this same handler call.
    if (jd.trim() === TEST_JD) {
      setQuestions(TEST_QUESTIONS);
      setTranscript([]);
      transcriptRef.current = [];
      setFeedback(null);
      persist({ jd, questions: TEST_QUESTIONS, transcript: [], feedback: null });
      await startVoiceSession(TEST_QUESTIONS, jd);
      return;
    }

    setStage("questions-loading");
    setQuestions([]);
    try {
      const generated = await fetchQuestions(jd);
      setQuestions(generated);
      // Fresh questions invalidate any prior transcript/feedback for this
      // session — starting over on a new JD/question set.
      setTranscript([]);
      transcriptRef.current = [];
      setFeedback(null);
      persist({ jd, questions: generated, transcript: [], feedback: null });
      setStage("questions-ready");
    } catch (err) {
      setQuestionsError(err instanceof Error ? err.message : "Unknown error.");
      setStage("jd");
    }
  }

  // "Use example job description" shortcut — see TEST_JD/TEST_QUESTIONS
  // above. Loads the fixed Example.ai JD + its matching question set without
  // calling /api/questions. Unconditionally replaces whatever's in the JD
  // field — the point is "load this specific example", not "fill in if
  // empty".
  function handleUseExampleJd() {
    setQuestionsError(null);
    setJd(TEST_JD);
    setQuestions(TEST_QUESTIONS);
    setTranscript([]);
    transcriptRef.current = [];
    setFeedback(null);
    persist({
      jd: TEST_JD,
      questions: TEST_QUESTIONS,
      transcript: [],
      feedback: null,
    });
    setStage("questions-ready");
  }

  // Shared by handleStartVoiceSession (real flow: whatever's currently in
  // `questions`/`jd` state) and handleGenerateQuestions's example-JD
  // shortcut (which needs to hand off TEST_QUESTIONS/TEST_JD directly,
  // since state set earlier in the same handler call hasn't committed yet).
  async function startVoiceSession(questionsToUse: Question[], jdToUse: string) {
    setVoiceError(null);
    setTranscript([]);
    transcriptRef.current = [];
    pendingTextRef.current = { ai: "", me: "" };
    setVoiceStatus("connecting");
    setStage("voice");

    playerRef.current = createAudioPlayer();

    const relay = connectRelay(
      RELAY_URL,
      () => {
        // Socket is actually open now — speak first. The relay only emits
        // session.ready once it's processed a session.start. Feed the REAL
        // generated questions + JD (not a hardcoded placeholder) — this is
        // the M3 wiring: relay/server.ts's buildSystemPrompt() turns these
        // into the voice session's system prompt.
        relay.sendSessionStart(questionsToUse, jdToUse);
      },
      (event) => {
        switch (event.type) {
          case "session.ready": {
            setVoiceStatus("ready");
            setVoiceStatus("in-session");
            startMic(relay);
            break;
          }
          case "audio.chunk": {
            playerRef.current?.enqueue(
              base64ToArrayBuffer(event.data),
              event.sampleRate
            );
            break;
          }
          case "turn.start": {
            if (event.speaker === "ai") setAiSpeaking(true);
            else setMeSpeaking(true);
            break;
          }
          case "turn.end": {
            const key = event.speaker;
            const text = pendingTextRef.current[key].trim();
            if (text) {
              setTranscript((prev) => {
                const next: Turn[] = [
                  ...prev,
                  { speaker: event.speaker, text, ts: Date.now() },
                ];
                persistTranscript(next);
                return next;
              });
            }
            pendingTextRef.current[key] = "";
            if (event.speaker === "ai") {
              setAiSpeaking(false);
            } else {
              setMeSpeaking(false);
              // Barge-in: if I started talking while the AI was mid-turn,
              // stop whatever's still queued for playback.
              playerRef.current?.flush();
            }
            break;
          }
          case "transcript.delta": {
            // Gemini Live's transcription deltas arrive at sub-word
            // granularity (e.g. "de", "velo", "per" for "developer") and
            // already carry their own leading space at real word
            // boundaries (tokenizer convention) — a "fix" that forced a
            // space between every pair of fragments lacking boundary
            // whitespace (2026-07-22) actually broke words apart ("de
            // velo per mo stly"). Plain concatenation is correct: trust
            // Gemini's own spacing.
            pendingTextRef.current[event.speaker] += event.text;
            break;
          }
          case "error": {
            setVoiceError(event.message);
            setVoiceStatus("error");
            break;
          }
        }
      },
      () => {
        // Relay closed the socket.
        setVoiceStatus((prev) => (prev === "error" ? prev : "ended"));
      }
    );

    relayRef.current = relay;
  }

  async function handleStartVoiceSession() {
    await startVoiceSession(questions, jd);
  }

  async function startMic(relay: RelayClient) {
    try {
      const mic = await startMicCapture((frame) => {
        relay.sendAudioChunk(frame);
      });
      micRef.current = mic;
    } catch (err) {
      setVoiceError(
        err instanceof Error
          ? `Mic access failed: ${err.message}`
          : "Mic access failed."
      );
      setVoiceStatus("error");
    }
  }

  async function handleEndSession() {
    relayRef.current?.sendSessionEnd();
    relayRef.current?.close();
    relayRef.current = null;
    micRef.current?.stop();
    micRef.current = null;
    playerRef.current?.close();
    playerRef.current = null;
    setAiSpeaking(false);
    setMeSpeaking(false);
    setVoiceStatus("ended");

    // Wire the transcript into scoring (M3's second half). The transcript is
    // already persisted turn-by-turn as it came in, so even if scoring
    // fails below, it stays visible/recoverable in localStorage and on this
    // page — we don't clear it.
    const finalTranscript = transcriptRef.current;
    if (finalTranscript.length === 0) {
      // Nothing was said — nothing to score. Stay on the transcript view
      // rather than calling /api/score with an empty transcript (the route
      // rejects that anyway).
      return;
    }

    setScoreError(null);
    setStage("scoring");
    try {
      const result = await fetchScore(jd, finalTranscript);
      setFeedback(result);
      persist({ feedback: result });
      setStage("scored");
    } catch (err) {
      setScoreError(err instanceof Error ? err.message : "Unknown error.");
      // Fall back to showing the transcript (still intact) with a visible
      // error instead of crashing or losing anything.
      setStage("voice");
    }
  }

  // Keep the ref current every render so the timer effect (which only runs
  // when voiceStatus changes) always calls the latest handleEndSession
  // closure — avoids stale jd/transcript captures without re-running the
  // timer's setInterval setup on every keystroke-driven render.
  handleEndSessionRef.current = handleEndSession;

  async function handleRetryScore() {
    if (transcriptRef.current.length === 0) return;
    setScoreError(null);
    setStage("scoring");
    try {
      const result = await fetchScore(jd, transcriptRef.current);
      setFeedback(result);
      persist({ feedback: result });
      setStage("scored");
    } catch (err) {
      setScoreError(err instanceof Error ? err.message : "Unknown error.");
      setStage("voice");
    }
  }

  function handleStartOver() {
    setJd("");
    setQuestions([]);
    setQuestionsError(null);
    setTranscript([]);
    transcriptRef.current = [];
    setFeedback(null);
    setScoreError(null);
    setVoiceError(null);
    setVoiceStatus("idle");
    setStage("jd");
    persist({ jd: "", questions: [], transcript: [], feedback: null });
  }

  // Step 3's "Start over" — unlike handleStartOver above, this keeps the
  // existing jd/questions (no need to pay for another /api/questions call
  // just to run the same interview again): only the transcript/feedback
  // from the attempt just scored get cleared.
  function handleTryAgain() {
    setTranscript([]);
    transcriptRef.current = [];
    setFeedback(null);
    setScoreError(null);
    setVoiceError(null);
    setVoiceStatus("idle");
    setStage(questions.length > 0 ? "questions-ready" : "jd");
    persist({ transcript: [], feedback: null });
  }

  useEffect(() => {
    return () => {
      micRef.current?.stop();
      playerRef.current?.close();
      relayRef.current?.close();
    };
  }, []);

  // 15-minute hard stop: reset the countdown when a session enters
  // "in-session", tick every second, and auto-end (reusing the exact same
  // handleEndSession path as clicking "End session" — no duplicated logic)
  // when it hits zero. Only ticks while actually in-session so pauses on
  // "connecting"/"ready" don't eat into interview time.
  useEffect(() => {
    if (voiceStatus !== "in-session") return;

    setSecondsRemaining(SESSION_LIMIT_SECONDS);
    const interval = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          handleEndSessionRef.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [voiceStatus]);

  // Voice session can be (re)started once questions exist and there's no
  // connection currently active/in-flight. Re-entering "questions-ready"
  // stage doesn't happen today (no explicit back action once voice starts),
  // but guard on voiceStatus too so a stray re-render never double-connects.
  const canStartVoice =
    questions.length > 0 &&
    jd.trim().length > 0 &&
    voiceStatus !== "connecting" &&
    voiceStatus !== "ready" &&
    voiceStatus !== "in-session";

  // Wizard: only one step's content is visible at a time. Derived purely
  // from `stage` (+ scoreError, which can be set while stage has fallen
  // back to "voice" after a failed score/retry — see handleEndSession /
  // handleRetryScore) rather than tracked as its own state, so there's no
  // separate step value that can drift out of sync with `stage`.
  //
  // "questions-ready" counts as step 2, not step 1: the Step 2 section
  // (below) is where the "Start voice session" button lives, and that
  // button needs to be reachable as soon as questions exist — otherwise
  // there's no way to ever start the interview once past step 1.
  const currentStep: 1 | 2 | 3 =
    stage === "scoring" || stage === "scored" || scoreError
      ? 3
      : stage === "jd" || stage === "questions-loading"
      ? 1
      : 2;

  const statusBadgeClass =
    "font-mono rounded-full px-3 py-1 type-caption " +
    (voiceStatus === "in-session"
      ? "bg-success/15 text-success"
      : voiceStatus === "error"
      ? "bg-error/15 text-error"
      : voiceStatus === "ended"
      ? "bg-surface-card text-muted"
      : "bg-accent-amber/15 text-accent-amber");

  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      <header className="border-b border-hairline">
        <div className="max-w-3xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-2">
          <Link href="/" className="type-title-sm text-ink">
            AI Voice Mock Interviewer
          </Link>
          <div className="flex items-center gap-4">
            <span className="type-caption text-muted-soft font-mono">
              Relay: {RELAY_URL}
              {session && <> &middot; Session: {session.id}</>}
            </span>
            <a
              href="https://github.com/0xPanda77/ai-voice-mock-interviewer"
              target="_blank"
              rel="noopener noreferrer"
              className="type-caption text-muted hover:text-ink transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto w-full px-6 py-12 flex flex-col gap-10">
        {/* --- Progress bar: pure visual indicator of the current wizard
            step, not clickable / no back-navigation (see page-level notes
            on why step-click nav is out of scope). --- */}
        <div className="flex items-center" aria-label="Progress">
          {WIZARD_STEPS.map(({ step, label }) => {
            const isCurrent = step === currentStep;
            const isDone = step < currentStep;
            return (
              <div key={step} className="flex items-center flex-1 last:flex-none">
                <div className="flex items-center gap-2">
                  <span
                    className={
                      "flex items-center justify-center w-7 h-7 rounded-full type-caption font-semibold shrink-0 " +
                      (isCurrent
                        ? "bg-primary text-on-primary"
                        : isDone
                        ? "bg-success text-on-primary"
                        : "border border-hairline text-muted-soft bg-canvas")
                    }
                  >
                    {isDone ? "✓" : step}
                  </span>
                  <span
                    className={
                      "type-caption-upper " +
                      (isCurrent
                        ? "text-ink"
                        : isDone
                        ? "text-success"
                        : "text-muted-soft")
                    }
                  >
                    {label}
                  </span>
                </div>
                {step < 3 && (
                  <div
                    className={
                      "flex-1 h-px mx-3 " + (isDone ? "bg-success" : "bg-hairline")
                    }
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* --- Step 1: JD -> Questions --- */}
        {currentStep === 1 && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="type-caption-upper text-muted">Step 1</span>
            <h2 className="type-title-lg text-ink">Job description</h2>
          </div>
          <textarea
            className="w-full min-h-[160px] rounded-md border border-hairline bg-canvas p-4 type-body-sm text-ink placeholder:text-muted-soft focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-60"
            placeholder="Paste the full job description here..."
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            disabled={stage === "voice" || stage === "scoring"}
          />
          <div className="flex flex-wrap gap-3">
            <button
              className="self-start h-10 px-5 rounded-md bg-primary text-on-primary type-body-sm font-medium hover:bg-primary-active disabled:bg-primary-disabled disabled:text-muted transition-colors"
              onClick={handleGenerateQuestions}
              disabled={
                stage === "questions-loading" ||
                stage === "voice" ||
                stage === "scoring" ||
                jd.trim().length === 0
              }
            >
              {stage === "questions-loading" ? "Generating..." : "Generate questions"}
            </button>
            <button
              className="self-start h-10 px-5 rounded-md border border-hairline bg-canvas text-ink type-body-sm font-medium hover:bg-surface-soft disabled:opacity-50 transition-colors"
              onClick={handleUseExampleJd}
              disabled={stage === "questions-loading" || stage === "voice" || stage === "scoring"}
              title="Load an example job description and its matching questions"
            >
              Use example job description
            </button>
            {(stage === "questions-ready" ||
              stage === "voice" ||
              stage === "scoring" ||
              stage === "scored") && (
              <button
                className="self-start h-10 px-5 rounded-md border border-hairline bg-canvas text-ink type-body-sm font-medium hover:bg-surface-soft disabled:opacity-50 transition-colors"
                onClick={handleStartOver}
                disabled={stage === "voice" || stage === "scoring"}
              >
                Start over
              </button>
            )}
          </div>
          {questionsError && (
            <p className="type-body-sm text-error">{questionsError}</p>
          )}
          {questions.length > 0 && (
            <ol className="list-decimal list-inside flex flex-col gap-3 mt-2 bg-surface-card rounded-lg p-6">
              {questions.map((q, i) => (
                <li key={i} className="type-body-sm text-ink">
                  <span>{q.text}</span>
                  {q.followupHints && q.followupHints.length > 0 && (
                    <ul className="list-disc list-inside ml-5 mt-1 text-muted">
                      {q.followupHints.map((h, j) => (
                        <li key={j}>{h}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
        )}

        {/* --- Step 2: Live voice interview --- */}
        {currentStep === 2 && (
          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="type-caption-upper text-muted">Step 2</span>
              <h2 className="type-title-lg text-ink">Live voice interview</h2>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className={statusBadgeClass}>{voiceStatus}</span>
              {aiSpeaking && (
                <span className="type-caption text-primary">
                  Interviewer speaking…
                </span>
              )}
              {meSpeaking && (
                <span className="type-caption text-accent-teal">
                  Listening…
                </span>
              )}
              {voiceStatus === "in-session" && (
                <span
                  data-testid="session-countdown"
                  className={
                    "type-body-sm tabular-nums ml-auto " +
                    (secondsRemaining <= SESSION_WARNING_SECONDS
                      ? "text-error font-semibold"
                      : "text-muted")
                  }
                >
                  {secondsRemaining <= SESSION_WARNING_SECONDS
                    ? `Ending soon — ${formatCountdown(secondsRemaining)} left`
                    : `${formatCountdown(secondsRemaining)} left (15-min cap)`}
                </span>
              )}
            </div>
            <div className="flex gap-3">
              <button
                className="self-start h-10 px-5 rounded-md bg-primary text-on-primary type-body-sm font-medium hover:bg-primary-active disabled:bg-primary-disabled disabled:text-muted transition-colors"
                onClick={handleStartVoiceSession}
                disabled={!canStartVoice}
              >
                Start voice session
              </button>
              <button
                className="self-start h-10 px-5 rounded-md border border-hairline bg-canvas text-ink type-body-sm font-medium hover:bg-surface-soft disabled:opacity-50 transition-colors"
                onClick={handleEndSession}
                disabled={voiceStatus !== "in-session" && voiceStatus !== "ready"}
              >
                End session
              </button>
            </div>
            {voiceError && (
              <p className="type-body-sm text-error">{voiceError}</p>
            )}

            {/* Product chrome, not a marketing illustration — the live
                transcript sits on a dark surface like the rest of the
                system's product-mockup cards. */}
            <div className="bg-surface-dark rounded-lg p-6">
              <h3 className="type-caption-upper text-on-dark-soft mb-3">
                Live transcript
              </h3>
              {transcript.length === 0 ? (
                <p className="type-body-sm text-on-dark-soft">
                  No turns captured yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-3 max-h-80 overflow-y-auto pr-1">
                  {transcript.map((t, i) => (
                    <li key={i} className="type-body-sm text-on-dark">
                      <span
                        className={
                          "font-semibold " +
                          (t.speaker === "ai" ? "text-primary" : "text-on-dark")
                        }
                      >
                        {t.speaker === "ai" ? "Interviewer" : "Me"}:
                      </span>{" "}
                      {t.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* --- Step 3: Feedback --- */}
        {currentStep === 3 && (
          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="type-caption-upper text-muted">Step 3</span>
              <h2 className="type-title-lg text-ink">Feedback</h2>
            </div>
            {stage === "scoring" && (
              <p className="type-body-sm text-muted">Scoring…</p>
            )}
            {scoreError && (
              <div className="flex flex-col gap-2">
                <p className="type-body-sm text-error">{scoreError}</p>
                <p className="type-caption text-muted">
                  Your transcript is safe (above, and saved) — you can retry
                  scoring.
                </p>
                <button
                  className="self-start h-10 px-5 rounded-md border border-hairline bg-canvas text-ink type-body-sm font-medium hover:bg-surface-soft transition-colors"
                  onClick={handleRetryScore}
                >
                  Retry scoring
                </button>
              </div>
            )}
            {feedback && (
              <div className="bg-surface-card rounded-lg p-6 flex flex-col gap-3">
                <p className="type-body-sm text-ink">
                  <span className="font-semibold">Score:</span> {feedback.score}
                  /100 &middot; <span className="font-semibold">Tier:</span>{" "}
                  {feedback.tier}
                </p>
                <ul
                  data-testid="feedback-comments"
                  className="list-disc list-inside type-body-sm text-body flex flex-col gap-1"
                >
                  {feedback.comments.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            <button
              className="self-start h-10 px-5 rounded-md border border-hairline bg-canvas text-ink type-body-sm font-medium hover:bg-surface-soft transition-colors"
              onClick={handleTryAgain}
            >
              Start over
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
