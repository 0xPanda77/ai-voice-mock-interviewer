"use client";

import { useEffect, useState } from "react";
import type { Feedback, Question, Turn } from "@/lib/types";
import {
  loadOrCreateCurrentSession,
  saveSession,
  type Session,
} from "@/lib/session-store";
import { fetchQuestions, fetchScore } from "@/lib/api-client";

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);

  const [jd, setJd] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionsError, setQuestionsError] = useState<string | null>(null);

  const [transcriptText, setTranscriptText] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);

  // Load (or create) the session on mount, hydrate local state from it.
  useEffect(() => {
    const s = loadOrCreateCurrentSession();
    setSession(s);
    setJd(s.jd);
    setQuestions(s.questions);
    setFeedback(s.feedback);
    if (s.transcript.length > 0) {
      setTranscriptText(turnsToText(s.transcript));
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

  async function handleGenerateQuestions() {
    setQuestionsError(null);
    setQuestionsLoading(true);
    setQuestions([]);
    try {
      const questions = await fetchQuestions(jd);
      setQuestions(questions);
      persist({ jd, questions });
    } catch (err) {
      setQuestionsError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setQuestionsLoading(false);
    }
  }

  async function handleScoreTranscript() {
    setScoreError(null);
    setScoreLoading(true);
    setFeedback(null);
    try {
      const transcript = parseTranscript(transcriptText);
      if (transcript.length === 0) {
        throw new Error(
          "Could not parse any turns. Use lines like 'AI: ...' and 'Me: ...'."
        );
      }
      const feedback = await fetchScore(jd, transcript);
      setFeedback(feedback);
      persist({ transcript, feedback });
    } catch (err) {
      setScoreError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setScoreLoading(false);
    }
  }

  return (
    <div className="min-h-screen p-6 sm:p-10 max-w-3xl mx-auto flex flex-col gap-10">
      <header>
        <h1 className="text-2xl font-semibold">AI Voice Mock Interviewer</h1>
        <p className="text-sm text-black/60 dark:text-white/60 mt-1">
          Text loop demo (M1) — paste a job description to generate
          questions, then paste a transcript to get scored feedback.
        </p>
        {session && (
          <p className="text-xs text-black/40 dark:text-white/40 mt-1">
            Session: {session.id}
          </p>
        )}
        <p className="text-xs mt-2">
          <a href="/voice" className="underline">
            Live voice interview (real flow) →
          </a>
        </p>
      </header>

      {/* --- Step 1: JD -> Questions --- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">1. Job description</h2>
        <textarea
          className="w-full min-h-[160px] rounded border border-black/15 dark:border-white/20 bg-transparent p-3 text-sm font-mono"
          placeholder="Paste the full job description here..."
          value={jd}
          onChange={(e) => setJd(e.target.value)}
        />
        <button
          className="self-start rounded-full bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
          onClick={handleGenerateQuestions}
          disabled={questionsLoading || jd.trim().length === 0}
        >
          {questionsLoading ? "Generating..." : "Generate questions"}
        </button>
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

      {/* --- Step 2: Transcript -> Feedback --- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">2. Interview transcript</h2>
        <p className="text-xs text-black/60 dark:text-white/60">
          Voice isn&apos;t wired up yet — paste a transcript to test scoring.
          One turn per line: <code>AI: ...</code> or <code>Me: ...</code>.
        </p>
        <textarea
          className="w-full min-h-[160px] rounded border border-black/15 dark:border-white/20 bg-transparent p-3 text-sm font-mono"
          placeholder={"AI: Tell me about a challenging project.\nMe: Sure, I led..."}
          value={transcriptText}
          onChange={(e) => setTranscriptText(e.target.value)}
        />
        <button
          className="self-start rounded-full bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
          onClick={handleScoreTranscript}
          disabled={
            scoreLoading ||
            transcriptText.trim().length === 0 ||
            jd.trim().length === 0
          }
        >
          {scoreLoading ? "Scoring..." : "Score transcript"}
        </button>
        {jd.trim().length === 0 && (
          <p className="text-xs text-black/40 dark:text-white/40">
            Add a job description above first — scoring needs it for context.
          </p>
        )}
        {scoreError && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {scoreError}
          </p>
        )}
        {feedback && (
          <div className="rounded border border-black/15 dark:border-white/20 p-4 mt-2 flex flex-col gap-2">
            <p className="text-sm">
              <span className="font-semibold">Score:</span> {feedback.score}
              /100 &middot; <span className="font-semibold">Tier:</span>{" "}
              {feedback.tier}
            </p>
            <ul className="list-disc list-inside text-sm flex flex-col gap-1">
              {feedback.comments.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

// Turn <-> text helpers for the transcript textarea. Keep parsing forgiving
// (this is a demo input box, not a strict format).
function parseTranscript(text: string): Turn[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const turns: Turn[] = [];
  let ts = Date.now();
  for (const line of lines) {
    const match = line.match(/^(ai|me|interviewer|candidate)\s*:\s*(.+)$/i);
    if (!match) continue;
    const speakerRaw = match[1].toLowerCase();
    const speaker: Turn["speaker"] =
      speakerRaw === "ai" || speakerRaw === "interviewer" ? "ai" : "me";
    turns.push({ speaker, text: match[2].trim(), ts });
    ts += 1000;
  }
  return turns;
}

function turnsToText(turns: Turn[]): string {
  return turns
    .map((t) => `${t.speaker === "ai" ? "AI" : "Me"}: ${t.text}`)
    .join("\n");
}
