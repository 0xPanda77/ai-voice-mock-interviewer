// Normalized relay protocol — PRD §7 / §8b. This is the ONE contract the
// browser depends on. The relay swaps upstream voice providers behind
// VoiceAdapter (see ./voice-adapter.ts) without changing any of these shapes
// or any client code — that's the whole point of the seam.
//
// Audio wire format (kept simple + consistent end to end, per task brief):
//   - Mic (client -> relay -> adapter): 16-bit PCM, 16kHz, mono, little-endian.
//   - AI voice (adapter -> relay -> client): 16-bit PCM, 24kHz, mono,
//     little-endian (Gemini Live's native output rate — see
//     adapters/gemini-voice-adapter.ts for why in/out rates differ).
//   audio.chunk payloads carry base64-encoded raw PCM bytes for that turn's
//   direction; sampleRate is included on every audio.chunk so neither side
//   has to hardcode it.

import type { Question } from "@/lib/types";

// --- Client -> relay -------------------------------------------------------

export type ClientEvent =
  | {
      type: "session.start";
      questions: Question[];
      jdContext: string;
    }
  | {
      type: "audio.chunk";
      /** base64-encoded 16-bit PCM mono audio, 16kHz. */
      data: string;
      sampleRate: 16000;
    }
  | {
      type: "session.end";
    };

// --- Relay -> client ---------------------------------------------------

export type RelayEvent =
  | { type: "session.ready" }
  | {
      type: "audio.chunk";
      /** base64-encoded 16-bit PCM mono audio from the AI voice. */
      data: string;
      sampleRate: number;
    }
  | {
      type: "transcript.delta";
      speaker: "ai" | "me";
      text: string;
    }
  | { type: "turn.start"; speaker: "ai" | "me" }
  | { type: "turn.end"; speaker: "ai" | "me" }
  | { type: "error"; message: string };

export function isClientEvent(value: unknown): value is ClientEvent {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const type = (value as { type: unknown }).type;
  return (
    type === "session.start" || type === "audio.chunk" || type === "session.end"
  );
}

export function parseClientEvent(raw: string): ClientEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Message is not valid JSON.");
  }
  if (!isClientEvent(parsed)) {
    throw new Error("Message does not match a known client event shape.");
  }
  return parsed;
}
