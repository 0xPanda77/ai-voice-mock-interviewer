// The swappable voice-engine seam (PRD §8b). The relay server (./server.ts)
// depends only on this interface — never on a vendor SDK directly. Swapping
// provider = write a new adapter that implements VoiceAdapter + flip the
// VOICE_PROVIDER env var in lib/config.ts. No caller (relay server) changes.
//
// Mirrors the lib/llm/text-llm.ts pattern used for the TextLLM seam in M1.

import { config } from "@/lib/config";
import type { RelayEvent } from "./protocol";

export interface VoiceAdapterConfig {
  /** System prompt built from the JD + generated questions. */
  systemPrompt: string;
  /** Prebuilt voice name, e.g. "Puck". */
  voice: string;
}

export interface VoiceAdapter {
  connect(config: VoiceAdapterConfig): Promise<void>;
  /** Send one mic audio frame (raw PCM bytes, 16-bit/16kHz/mono). */
  sendAudio(frame: ArrayBuffer): void;
  /** Subscribe to normalized events (audio out, transcript, turns, errors). */
  onEvent(cb: (e: RelayEvent) => void): void;
  close(): void;
}

// --- Provider selection (PRD §8b) ------------------------------------------
//
// The relay server should use createVoiceAdapter() instead of importing a
// concrete adapter. This is the seam: adding a new provider means adding a
// case here (and a new adapter file), never touching server.ts.
export async function createVoiceAdapter(): Promise<VoiceAdapter> {
  switch (config.voiceProvider) {
    case "gemini": {
      // Dynamic import keeps the Gemini Live SDK specifics out of any module
      // graph that doesn't actually select the gemini provider.
      const { GeminiVoiceAdapter } = await import(
        "./adapters/gemini-voice-adapter"
      );
      return new GeminiVoiceAdapter();
    }
    // Test-only fake upstream — see relay/adapters/stub-voice-adapter.ts and
    // relay/test/ws-client-smoke.ts (issue #6's machine-verifiable check).
    // Not documented as a real product option; only reachable by explicitly
    // setting VOICE_PROVIDER=stub, which nothing in normal operation does.
    case "stub": {
      const { StubVoiceAdapter } = await import("./adapters/stub-voice-adapter");
      return new StubVoiceAdapter();
    }
    default:
      throw new Error(`Unknown VOICE_PROVIDER: "${config.voiceProvider}"`);
  }
}
