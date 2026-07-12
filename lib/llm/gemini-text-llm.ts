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
const MODEL = "gemini-flash-latest";

const questionsSchema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
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

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "You are an experienced technical interviewer. Given the job " +
                "description below, generate 5-7 role-specific interview " +
                "questions that probe the skills and experience this role " +
                "actually needs. For each question, optionally include 1-3 " +
                "short follow-up hints (things a strong interviewer would " +
                "probe deeper on if the candidate's answer is shallow).\n\n" +
                `Job description:\n"""\n${jd}\n"""`,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: questionsSchema,
      },
    });

    const parsed = parseJsonResponse<{ questions: Question[] }>(response.text);
    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      throw new Error("Gemini response did not contain a questions array.");
    }
    return parsed.questions;
  }

  async scoreTranscript(transcript: Turn[], jd: string): Promise<Feedback> {
    const ai = getClient();

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "You are an experienced technical interviewer scoring a " +
                "finished mock interview transcript against the job " +
                "description below. Score holistically 0-100 considering " +
                "three dimensions: (1) communication — clarity, structure, " +
                "concision; (2) technical depth — correctness, specificity, " +
                "evidence of real experience; (3) problem-solving structure " +
                "— clarifying assumptions, breaking the problem down, " +
                "discussing trade-offs. Return exactly 3 comment bullets, " +
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
    });

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
