// POST /api/score — transcript + JD -> score/tier/comments.
// PRD §4.4 — one-call feedback.
//
// Rubric: see the comment above tierForScore in lib/llm/text-llm.ts for the
// three scoring dimensions (communication / technical depth / problem-solving
// structure) and tier thresholds.

import { NextResponse } from "next/server";
import { getTextLLM } from "@/lib/llm/text-llm";
import { isQuotaError, QUOTA_ERROR_MESSAGE } from "@/lib/quota-error";
import type { Turn } from "@/lib/types";

const MIN_JD_LENGTH = 40;
const MAX_JD_LENGTH = 20000;
const MAX_TRANSCRIPT_TURNS = 500;

function isValidTurn(t: unknown): t is Turn {
  if (typeof t !== "object" || t === null) return false;
  const turn = t as Record<string, unknown>;
  return (
    (turn.speaker === "ai" || turn.speaker === "me") &&
    typeof turn.text === "string" &&
    turn.text.trim().length > 0 &&
    typeof turn.ts === "number"
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { error: "Request body must be a JSON object." },
      { status: 400 }
    );
  }

  const { jd, transcript } = body as { jd?: unknown; transcript?: unknown };

  if (typeof jd !== "string") {
    return NextResponse.json(
      { error: "'jd' must be a string." },
      { status: 400 }
    );
  }
  const trimmedJd = jd.trim();
  if (trimmedJd.length < MIN_JD_LENGTH) {
    return NextResponse.json(
      {
        error: `'jd' is too short to be a real job description (min ${MIN_JD_LENGTH} characters).`,
      },
      { status: 400 }
    );
  }
  if (trimmedJd.length > MAX_JD_LENGTH) {
    return NextResponse.json(
      { error: `'jd' is too long (max ${MAX_JD_LENGTH} characters).` },
      { status: 400 }
    );
  }

  if (!Array.isArray(transcript) || transcript.length === 0) {
    return NextResponse.json(
      { error: "'transcript' must be a non-empty array of turns." },
      { status: 400 }
    );
  }
  if (transcript.length > MAX_TRANSCRIPT_TURNS) {
    return NextResponse.json(
      { error: `'transcript' is too long (max ${MAX_TRANSCRIPT_TURNS} turns).` },
      { status: 400 }
    );
  }
  if (!transcript.every(isValidTurn)) {
    return NextResponse.json(
      {
        error:
          "Every transcript turn must be { speaker: 'ai' | 'me', text: string, ts: number }.",
      },
      { status: 400 }
    );
  }

  try {
    const llm = await getTextLLM();
    const feedback = await llm.scoreTranscript(transcript as Turn[], trimmedJd);

    if (
      typeof feedback.score !== "number" ||
      typeof feedback.tier !== "string" ||
      !Array.isArray(feedback.comments)
    ) {
      return NextResponse.json(
        { error: "The model returned malformed feedback. Try again." },
        { status: 502 }
      );
    }

    return NextResponse.json({ feedback });
  } catch (err) {
    console.error("[/api/score] failed:", err);
    if (isQuotaError(err)) {
      return NextResponse.json({ error: QUOTA_ERROR_MESSAGE }, { status: 429 });
    }
    const message =
      err instanceof Error ? err.message : "Unknown error scoring transcript.";
    return NextResponse.json(
      { error: `Failed to score transcript: ${message}` },
      { status: 500 }
    );
  }
}
