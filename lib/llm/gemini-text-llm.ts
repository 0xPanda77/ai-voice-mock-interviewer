// GeminiTextLLM — the default TextLLM adapter (PRD §8a, §9).
//
// This is the ONLY file in the app that may import the Gemini SDK
// (@google/genai). Everything else (API routes, UI) depends on the TextLLM
// interface in ./text-llm.ts. If you need to swap providers, write a new
// adapter file implementing TextLLM and flip TEXT_PROVIDER — no other file
// should need to change.

import { GoogleGenAI, Type } from "@google/genai";
import type { Feedback, Question, Turn } from "@/lib/types";
import { tierForScore, type TextLLM } from "@/lib/llm/text-llm";

// NOTE: gemini-2.5-flash was retired for new API keys as of this writing
// (generateContent returns 404 "no longer available to new users" even
// though it still appears in the ListModels response). Using the
// "-latest" alias instead of a pinned dated model avoids repeating this
// failure mode — Google points the alias at the current recommended flash
// model, so it survives future retirements without a code change.
//
// Using the "-lite" variant specifically: gemini-flash-latest was observed
// returning persistent 503 UNAVAILABLE ("high demand") on this key's free
// tier (2026-07-13), while gemini-flash-lite-latest responded 200 at the
// same time. Also sidesteps the free-tier "limit: 0" quota now seen on the
// older pinned 2.0-flash family for this key.
const MODEL = "gemini-flash-lite-latest";

// Screening-call mode (branch experiment, see docs/deploy.md branch note):
// LLM generates only the 2 non-technical fit questions; the fixed
// "introduce yourself" opener is prepended in code, not generated.
const SCREENING_INTRO_QUESTION: Question = {
  text: "To start, could you introduce yourself and walk me through your background?",
};

const questionsSchema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      minItems: 2,
      maxItems: 2,
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          followupHints: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ["text"],
      },
    },
  },
  required: ["questions"],
};

const scoreSchema = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.NUMBER },
    comments: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ["score", "comments"],
};

// The Gemini API occasionally returns a transient 503 "high demand" error
// (observed repeatedly during M4 testing, unrelated to request content) —
// retry a couple of times with a short backoff before surfacing it as a
// real failure. Keeps the single-user "ship it" experience from being
// derailed by a momentary upstream blip.
async function withTransient503Retry<T>(fn: () => Promise<T>): Promise<T> {
  const maxAttempts = 3;
  const delaysMs = [500, 1500];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is503 =
        err instanceof Error && /"code":503|UNAVAILABLE/.test(err.message);
      if (!is503 || attempt === maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt - 1]));
    }
  }
  // Unreachable — loop above always returns or throws.
  throw new Error("Unreachable retry loop exit.");
}

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to your environment (see .env.example)."
    );
  }
  return new GoogleGenAI({ apiKey });
}

function transcriptToText(transcript: Turn[]): string {
  return transcript
    .map((t) => `${t.speaker === "ai" ? "Interviewer" : "Candidate"}: ${t.text}`)
    .join("\n");
}

export class GeminiTextLLM implements TextLLM {
  async generateQuestions(jd: string): Promise<Question[]> {
    const ai = getClient();

    const response = await withTransient503Retry(() =>
      ai.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  "You are conducting a first-round recruiter screening call, " +
                  "not a technical interview. Given the job description below, " +
                  "write exactly 2 screening questions that check the " +
                  "candidate's overall fit and compatibility with the role — " +
                  "motivation for the role, relevant past experience at a high " +
                  "level, alignment with the responsibilities and seniority " +
                  "described. Do NOT ask technical, system-design, or coding " +
                  "questions. Keep each question conversational, the way a " +
                  "recruiter (not an engineer) would ask it.\n\n" +
                  `Job description:\n"""\n${jd}\n"""`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: questionsSchema,
        },
      })
    );

    const parsed = parseJsonResponse<{ questions: Question[] }>(response.text);
    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      throw new Error("Gemini response did not contain a questions array.");
    }
    return [SCREENING_INTRO_QUESTION, ...parsed.questions];
  }

  async scoreTranscript(transcript: Turn[], jd: string): Promise<Feedback> {
    const ai = getClient();

    const response = await withTransient503Retry(() =>
      ai.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  "You are a recruiter scoring a finished first-round " +
                  "screening call transcript against the job description " +
                  "below. This was a non-technical call — score holistically " +
                  "0-100 considering three dimensions: (1) communication — " +
                  "clarity, structure, concision; (2) role & culture fit — " +
                  "motivation for the role, alignment with the " +
                  "responsibilities and team/mission as expressed in their " +
                  "answers; (3) experience relevance — how well their " +
                  "described background maps to what this role needs, at a " +
                  "high level. Do NOT evaluate technical depth, coding " +
                  "ability, or system-design skill — none of that was " +
                  "assessed in this call. Return exactly 3 comment bullets, " +
                  "one per dimension, each a single concise sentence.\n\n" +
                  `Job description:\n"""\n${jd}\n"""\n\n` +
                  `Transcript:\n"""\n${transcriptToText(transcript)}\n"""`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: scoreSchema,
        },
      })
    );

    const parsed = parseJsonResponse<{ score: number; comments: string[] }>(
      response.text
    );
    if (typeof parsed.score !== "number" || !Array.isArray(parsed.comments)) {
      throw new Error("Gemini response did not match the expected shape.");
    }

    const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
    return {
      score,
      tier: tierForScore(score),
      comments: parsed.comments.slice(0, 3),
    };
  }
}

function parseJsonResponse<T>(text: string | undefined): T {
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Gemini returned malformed JSON.");
  }
}
