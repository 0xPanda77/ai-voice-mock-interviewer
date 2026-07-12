// POST /api/questions — JD text -> role-specific interview questions.
// PRD §4.2 / §2 — the core "product, not a wrapper" step.

import { NextResponse } from "next/server";
import { getTextLLM } from "@/lib/llm/text-llm";
import type { Question } from "@/lib/types";

const MIN_JD_LENGTH = 40;
const MAX_JD_LENGTH = 20000;

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

  if (typeof body !== "object" || body === null || !("jd" in body)) {
    return NextResponse.json(
      { error: "Request body must include a 'jd' field." },
      { status: 400 }
    );
  }

  const jd = (body as { jd: unknown }).jd;
  if (typeof jd !== "string") {
    return NextResponse.json(
      { error: "'jd' must be a string." },
      { status: 400 }
    );
  }

  const trimmed = jd.trim();
  if (trimmed.length < MIN_JD_LENGTH) {
    return NextResponse.json(
      {
        error: `'jd' is too short to be a real job description (min ${MIN_JD_LENGTH} characters).`,
      },
      { status: 400 }
    );
  }
  if (trimmed.length > MAX_JD_LENGTH) {
    return NextResponse.json(
      { error: `'jd' is too long (max ${MAX_JD_LENGTH} characters).` },
      { status: 400 }
    );
  }

  try {
    const llm = await getTextLLM();
    const questions: Question[] = await llm.generateQuestions(trimmed);

    if (!Array.isArray(questions) || questions.length === 0) {
      return NextResponse.json(
        { error: "The model did not return any questions. Try again." },
        { status: 502 }
      );
    }

    return NextResponse.json({ questions });
  } catch (err) {
    console.error("[/api/questions] failed:", err);
    const message =
      err instanceof Error ? err.message : "Unknown error generating questions.";
    return NextResponse.json(
      { error: `Failed to generate questions: ${message}` },
      { status: 500 }
    );
  }
}
