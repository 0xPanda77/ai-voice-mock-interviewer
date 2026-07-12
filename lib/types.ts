// Shared data shapes — PRD §12. Keep these exact; the whole app (API routes,
// adapters, UI, localStorage persistence) depends on this single source of
// truth for shape.

export type Question = {
  text: string;
  followupHints?: string[];
};

export type Turn = {
  speaker: "ai" | "me";
  text: string;
  ts: number;
};

export type Feedback = {
  score: number; // 0-100
  tier: string; // e.g. "Strong hire", "Hire", "Borderline", "No hire"
  comments: string[]; // exactly 3 bullets — see lib/llm/text-llm.ts for rubric
};
