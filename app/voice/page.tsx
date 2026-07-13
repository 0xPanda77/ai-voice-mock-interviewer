"use client";

// /voice — the real wired-up flow (PRD's one-line pitch): paste a JD, get
// role-specific questions generated, run a live voice interview on those
// exact questions, then get score/tier/feedback at the end. This is
// Milestone 3 (issue #10) — it replaces M2's hardcoded-placeholder demo with
// the real /api/questions -> voice session -> /api/score loop, reusing the
// same TextLLM routes the M1 text-only page (app/page.tsx) uses.
//
// app/page.tsx stays as a standalone text-only demo (still valid per PRD) —
// this page is the "real" product experience.

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

  const relayRef = useRef<RelayClient | null>(null);
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

  async function handleStartVoiceSession() {
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
        relay.sendSessionStart(questions, jd);
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

  useEffect(() => {
    return () => {
      micRef.current?.stop();
      playerRef.current?.close();
      relayRef.current?.close();
    };
  }, []);

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

  return (
    <div className="min-h-screen p-6 sm:p-10 max-w-3xl mx-auto flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold">AI Voice Mock Interviewer</h1>
        <p className="text-sm text-black/60 dark:text-white/60 mt-1">
          Paste a job description, run a live voice interview on
          role-specific questions, get feedback at the end.
        </p>
        <p className="text-xs text-black/40 dark:text-white/40 mt-1">
          Relay: {RELAY_URL} {session && <> &middot; Session: {session.id}</>}
        </p>
        <p className="text-xs mt-2">
          <Link href="/" className="underline">
            ← Text-only demo (M1)
          </Link>
        </p>
      </header>

      {/* --- Step 1: JD -> Questions --- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">1. Job description</h2>
        <textarea
          className="w-full min-h-[160px] rounded border border-black/15 dark:border-white/20 bg-transparent p-3 text-sm font-mono disabled:opacity-60"
          placeholder="Paste the full job description here..."
          value={jd}
          onChange={(e) => setJd(e.target.value)}
          disabled={stage === "voice" || stage === "scoring"}
        />
        <div className="flex gap-3">
          <button
            className="self-start rounded-full bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
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
          {(stage === "questions-ready" ||
            stage === "voice" ||
            stage === "scoring" ||
            stage === "scored") && (
            <button
              className="self-start rounded-full border border-black/15 dark:border-white/20 px-4 py-2 text-sm font-medium disabled:opacity-50"
              onClick={handleStartOver}
              disabled={stage === "voice" || stage === "scoring"}
            >
              Start over
            </button>
          )}
        </div>
        {questionsError && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {questionsError}
          </p>
        )}
        {questions.length > 0 && (
          <ol className="list-decimal list-inside flex flex-col gap-3 mt-2">
            {questions.map((q, i) => (
              <li key={i} className="text-sm">
                <span>{q.text}</span>
                {q.followupHints && q.followupHints.length > 0 && (
                  <ul className="list-disc list-inside ml-5 mt-1 text-black/60 dark:text-white/60">
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

      {/* --- Step 2: Live voice interview --- */}
      {stage !== "jd" && stage !== "questions-loading" && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">2. Live voice interview</h2>
          <p className="text-sm">
            Status: <span className="font-mono">{voiceStatus}</span>
            {aiSpeaking && <span className="ml-2 text-blue-600">AI speaking…</span>}
            {meSpeaking && <span className="ml-2 text-green-600">Listening…</span>}
          </p>
          <div className="flex gap-3">
            <button
              className="self-start rounded-full bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
              onClick={handleStartVoiceSession}
              disabled={!canStartVoice}
            >
              Start voice session
            </button>
            <button
              className="self-start rounded-full border border-black/15 dark:border-white/20 px-4 py-2 text-sm font-medium disabled:opacity-50"
              onClick={handleEndSession}
              disabled={voiceStatus !== "in-session" && voiceStatus !== "ready"}
            >
              End session
            </button>
          </div>
          {voiceError && (
            <p className="text-sm text-red-600 dark:text-red-400">{voiceError}</p>
          )}

          <h3 className="text-sm font-medium mt-2">Live transcript</h3>
          {transcript.length === 0 ? (
            <p className="text-sm text-black/40 dark:text-white/40">
              No turns captured yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {transcript.map((t, i) => (
                <li key={i} className="text-sm">
                  <span className="font-semibold">
                    {t.speaker === "ai" ? "Interviewer" : "Me"}:
                  </span>{" "}
                  {t.text}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* --- Step 3: Feedback --- */}
      {(stage === "scoring" || stage === "scored" || scoreError) && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">3. Feedback</h2>
          {stage === "scoring" && <p className="text-sm">Scoring…</p>}
          {scoreError && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-red-600 dark:text-red-400">
                {scoreError}
              </p>
              <p className="text-xs text-black/60 dark:text-white/60">
                Your transcript is safe (above, and saved) — you can retry
                scoring.
              </p>
              <button
                className="self-start rounded-full border border-black/15 dark:border-white/20 px-4 py-2 text-sm font-medium"
                onClick={handleRetryScore}
              >
                Retry scoring
              </button>
            </div>
          )}
          {feedback && (
            <div className="rounded border border-black/15 dark:border-white/20 p-4 mt-2 flex flex-col gap-2">
              <p className="text-sm">
                <span className="font-semibold">Score:</span> {feedback.score}
                /100 &middot; <span className="font-semibold">Tier:</span>{" "}
                {feedback.tier}
              </p>
              <ul
                data-testid="feedback-comments"
                className="list-disc list-inside text-sm flex flex-col gap-1"
              >
                {feedback.comments.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
