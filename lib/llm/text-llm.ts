// The swappable text-LLM seam (PRD §8a). App code (API routes, UI) depends
// only on this interface — never on a vendor SDK directly. Swapping provider
// = write a new adapter that implements TextLLM + flip the TEXT_PROVIDER env
// var in lib/config.ts. No caller changes.

import type { Feedback, Question, Turn } from "@/lib/types";
import { config } from "@/lib/config";

export interface TextLLM {
  /**
   * Turn a pasted job description into role-specific interview questions.
   */
  generateQuestions(jd: string): Promise<Question[]>;

  /**
   * Score a finished interview transcript against the job description.
   */
  scoreTranscript(transcript: Turn[], jd: string): Promise<Feedback>;
}

// --- Scoring rubric (decided here per PRD §15 open question) ---------------
//
// Three fixed dimensions, scored holistically into a single 0-100 score.
//
// screening-call-mode branch: swapped the technical-interview dimensions
// for first-round-screening-call ones (see gemini-text-llm.ts's scoring
// prompt for the exact wording fed to the model):
//   1. Communication — clarity, structure of delivery, concision.
//   2. Role & culture fit — motivation for the role, alignment with the
//      responsibilities and team/mission as expressed in their answers.
//   3. Experience relevance — how well their described background maps to
//      what this role needs, at a high level (NOT technical depth/coding/
//      system-design — this is a non-technical screening call).
//
// The model returns ONE overall score (0-100) and a tier derived from it:
//   85-100 "Strong hire", 70-84 "Hire", 50-69 "Borderline", 0-49 "No hire".
// Comments are exactly 3 bullets, each tied to one of the three dimensions
// above (not a freeform list) — keeps feedback scannable and consistent.
// This is intentionally simple (fixed dimensions, not freeform) per the
// issue's "pick something concrete, don't over-engineer" guidance.
export const SCORE_TIERS = [
  { min: 85, tier: "Strong hire" },
  { min: 70, tier: "Hire" },
  { min: 50, tier: "Borderline" },
  { min: 0, tier: "No hire" },
] as const;

export function tierForScore(score: number): string {
  const match = SCORE_TIERS.find((t) => score >= t.min);
  return match ? match.tier : "No hire";
}

// --- Provider selection (PRD §8a) -------------------------------------------
//
// Callers (API routes) should use getTextLLM() instead of importing a
// concrete adapter. This is the seam: adding a new provider means adding a
// case here (and a new adapter file), never touching the routes.
let cached: TextLLM | undefined;

export async function getTextLLM(): Promise<TextLLM> {
  if (cached) return cached;

  switch (config.textProvider) {
    case "gemini": {
      // Dynamic import keeps the Gemini SDK out of any module graph that
      // doesn't actually select the gemini provider.
      const { GeminiTextLLM } = await import("@/lib/llm/gemini-text-llm");
      cached = new GeminiTextLLM();
      return cached;
    }
    default:
      throw new Error(`Unknown TEXT_PROVIDER: "${config.textProvider}"`);
  }
}
