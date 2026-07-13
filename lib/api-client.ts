// Shared browser-side fetch helpers for the two text-LLM HTTP routes
// (/api/questions, /api/score). Extracted so app/page.tsx (M1 text loop) and
// app/voice/page.tsx (M3 wired voice flow) both call the same request/parse
// logic instead of duplicating it — both pages hit the exact same routes,
// only what happens with the result differs (render vs. feed into a voice
// session).

import type { Feedback, Question, Turn } from "@/lib/types";

export async function fetchQuestions(jd: string): Promise<Question[]> {
  const res = await fetch("/api/questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jd }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data.questions as Question[];
}

export async function fetchScore(
  jd: string,
  transcript: Turn[]
): Promise<Feedback> {
  const res = await fetch("/api/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jd, transcript }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data.feedback as Feedback;
}
