// GeminiVoiceAdapter — the default VoiceAdapter (PRD §8b, §9).
//
// This is the ONLY file in the app/relay that may import Gemini's Live API
// surface (`ai.live` from @google/genai). Everything else (relay server,
// browser) depends on the VoiceAdapter interface in ../voice-adapter.ts. If
// you need to swap providers, write a new adapter file implementing
// VoiceAdapter and flip VOICE_PROVIDER — no other file should need to change.
//
// Model + audio format notes (verified against @google/genai's
// node_modules/@google/genai/dist/node/node.d.ts, not assumed):
//   - Model: PRD §9 pins "gemini-2.5-flash-native-audio-preview", but as of
//     this writing that exact name is REJECTED by the live API for this
//     project's real API key/v1beta: "models/gemini-2.5-flash-native-audio-
//     preview is not found for API version v1beta, or is not supported for
//     bidiGenerateContent" (confirmed via a direct ai.live.connect() probe,
//     waiting for the setupComplete message rather than just onopen — see
//     relay/test/gemini-live-smoke.ts). This is the exact same rotation
//     failure mode M1 hit with the text model (see gemini-text-llm.ts) —
//     the "preview model name may rotate" risk PRD §14/§9 called out.
//     The dated variant "gemini-2.5-flash-native-audio-preview-09-2025" WAS
//     verified reachable (setupComplete received) and produces real audio +
//     transcript output — see the smoke test's evidence output. Using that
//     working name here; revisit if it rotates again.
//   - Input audio the Live API expects via sendRealtimeInput: a Blob with
//     mimeType "audio/pcm;rate=16000" (16-bit PCM, 16kHz, mono) and
//     base64-encoded `data`.
//   - Output audio the Live API sends back in serverContent.modelTurn parts:
//     16-bit PCM at 24kHz mono, inlineData.mimeType "audio/pcm;rate=24000".
//     We forward the declared rate from the mimeType when present, falling
//     back to 24000 (documented Live API output rate) otherwise.
//   - Voice: single prebuilt voice "Puck" (PRD §9), set via
//     speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName.
//   - Turn detection: automatic server-side VAD is left ENABLED by default
//     (the whole point of native audio per PRD §6 — "the native-audio model
//     does turn-taking + barge-in itself"). A synthetic sine tone (used by
//     relay/test/gemini-live-smoke.ts) doesn't register as speech to VAD, so
//     that test-only script sets GEMINI_VOICE_TEST_DISABLE_VAD=1 to switch
//     to explicit activityStart/activityEnd signals instead — proven to
//     deterministically elicit a real response (audio + transcript +
//     usageMetadata) in manual verification. This env var is a test-only
//     escape hatch confined to this adapter file; it is never set in normal
//     product operation and does not appear in .env.example.

import {
  EndSensitivity,
  GoogleGenAI,
  Modality,
  type AutomaticActivityDetection,
  type Session as GeminiLiveSession,
} from "@google/genai";
import type { RelayEvent } from "../protocol";
import type { VoiceAdapter, VoiceAdapterConfig } from "../voice-adapter";

// See the file-header note above: the PRD-pinned name is currently rejected
// by the live API for this key; this dated variant is the verified-working
// one.
const MODEL = "gemini-2.5-flash-native-audio-preview-09-2025";
const DEFAULT_OUTPUT_SAMPLE_RATE = 24000;

// Gemini Live's own VAD default is END_SENSITIVITY_HIGH ("ends speech more
// often" — see @google/genai's EndSensitivity doc comment), which reads
// brief pauses/breaths mid-answer as end-of-turn. Observed in manual
// screening-call testing (2026-07-17): the model kept starting to talk
// over the candidate mid-sentence, producing a transcript full of
// truncated "Interviewer: ..." fragments before getting barge-in-cut-off
// by the candidate continuing to speak. LOW sensitivity fixes this — costs
// a bit more perceived latency before the AI responds, which is the right
// trade for a spoken interview where being talked over is worse than a
// beat of extra silence.
//
// silenceDurationMs dialed back from 2000 to 1000 (2026-07-19): after
// fixing a separate "stuck listening" bug (client-side noise gate, see
// public/worklets/pcm-recorder-worklet.js) it was still measured taking
// ~10-13s to commit end-of-turn after a long (~44s) answer, even with true
// silence following it — the delay scales with prior utterance length,
// and silenceDurationMs is the direct lever for it. 1000ms trades back
// some of the interruption-resistance from the fix above in exchange for
// cutting that residual delay; re-tune if premature interruptions reappear.
const PRODUCT_ACTIVITY_DETECTION: AutomaticActivityDetection = {
  endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
  silenceDurationMs: 1000,
};

function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to your environment (see .env.example).",
    );
  }
  return apiKey;
}

/** Parse "audio/pcm;rate=24000" -> 24000. Falls back to the Live API's
 * documented default output rate if the mimeType is missing/unparsable. */
function sampleRateFromMimeType(mimeType: string | undefined): number {
  if (!mimeType) return DEFAULT_OUTPUT_SAMPLE_RATE;
  const match = mimeType.match(/rate=(\d+)/);
  return match ? Number(match[1]) : DEFAULT_OUTPUT_SAMPLE_RATE;
}

function testVadDisabled(): boolean {
  return process.env.GEMINI_VOICE_TEST_DISABLE_VAD === "1";
}

// Bug fix (2026-07-22): the model never spoke first — automatic VAD only
// responds to detected user audio via sendRealtimeInput, and nothing ever
// prompted it otherwise, so the candidate had to say something before the
// AI made a sound. `sendClientContent` (see @google/genai's
// node_modules/@google/genai/dist/node/node.d.ts Session#sendClientContent
// doc comment) is the documented way to inject synthetic non-audio content
// into the conversation and ask for a response — its own example is
// literally `sendClientContent({turns: "Hello?"})`. This is a TEXT turn,
// not audio: it does NOT go through sendRealtimeInput, so it can never
// trigger inputAudioTranscription (audio-only, see handleServerMessage)
// and therefore can never be misattributed as a "me" (candidate) turn in
// the UI — only a real spoken response to it will, correctly, come back
// as an "ai" turn.
const KICKOFF_TURN =
  "Begin the call now — greet the candidate and ask the first prepared question.";

// Test-only: when VAD is disabled (see testVadDisabled), we still need to
// mark activity boundaries ourselves. Debounce activityEnd this long after
// the last sendAudio() call — long enough to not cut off the burst of
// frames a caller sends in one go, short enough for a smoke test to finish
// in reasonable time.
const TEST_ACTIVITY_END_DEBOUNCE_MS = 800;

export class GeminiVoiceAdapter implements VoiceAdapter {
  private session: GeminiLiveSession | undefined;
  private listeners: Array<(e: RelayEvent) => void> = [];
  private currentAiTurnOpen = false;
  private currentMeTurnOpen = false;
  private testActivityOpen = false;
  private testActivityEndTimer: ReturnType<typeof setTimeout> | undefined;

  private emit(event: RelayEvent): void {
    for (const cb of this.listeners) cb(event);
  }

  onEvent(cb: (e: RelayEvent) => void): void {
    this.listeners.push(cb);
  }

  async connect(cfg: VoiceAdapterConfig): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });

    this.session = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: cfg.systemPrompt,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: cfg.voice },
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        realtimeInputConfig: {
          automaticActivityDetection: testVadDisabled()
            ? { disabled: true }
            : PRODUCT_ACTIVITY_DETECTION,
        },
      },
      callbacks: {
        onopen: () => {
          // NOTE: onopen only means the raw WebSocket connected — it fires
          // even for a model name the Live API goes on to reject at the
          // bidiGenerateContent/setup level (confirmed: a rejected model can
          // still fire onopen, then onclose with a "not found ... not
          // supported for bidiGenerateContent" reason). session.ready is
          // therefore emitted on setupComplete below, not here.
        },
        onmessage: (message) => {
          if (message.setupComplete) {
            this.emit({ type: "session.ready" });
          }
          this.handleServerMessage(message);
        },
        onerror: (event) => {
          this.emit({
            type: "error",
            message: event?.message || "Gemini Live socket error.",
          });
        },
        onclose: (event) => {
          if (event && !event.wasClean) {
            this.emit({
              type: "error",
              message: `Gemini Live connection closed unexpectedly: ${
                event.reason || event.code
              }`,
            });
          }
        },
      },
    });

    // Speak first (see KICKOFF_TURN above). Safe to send immediately here:
    // @google/genai's ai.live.connect() promise (awaited above) does not
    // resolve until it has itself received setupComplete — it queues
    // messages internally and only returns the Session once that happens
    // (verified against node_modules/@google/genai/dist/node/index.cjs's
    // Live.connect() implementation) — so `this.session` is guaranteed to
    // be a live, setup-complete session by this line, and "session.ready"
    // has already been emitted above via the onmessage callback.
    this.session.sendClientContent({ turns: KICKOFF_TURN, turnComplete: true });
  }

  private handleServerMessage(message: {
    serverContent?: {
      modelTurn?: {
        parts?: Array<{
          inlineData?: { data?: string; mimeType?: string };
        }>;
      };
      turnComplete?: boolean;
      interrupted?: boolean;
      inputTranscription?: { text?: string };
      outputTranscription?: { text?: string };
    };
    usageMetadata?: {
      promptTokenCount?: number;
      responseTokenCount?: number;
      totalTokenCount?: number;
    };
  }): void {
    if (message.usageMetadata) {
      // Diagnostic only (not part of the normalized protocol) — proves the
      // upstream actually consumed/processed tokens for this session, which
      // is useful evidence even on turns where the model doesn't speak back
      // (e.g. a synthetic sine tone that VAD doesn't treat as speech).
      console.log(
        "[gemini-voice-adapter] usageMetadata:",
        JSON.stringify(message.usageMetadata),
      );
    }

    const content = message.serverContent;
    if (!content) return;

    // AI audio output frames.
    const audioParts =
      content.modelTurn?.parts?.filter((p) => p.inlineData?.data) ?? [];
    if (audioParts.length > 0 && !this.currentAiTurnOpen) {
      this.currentAiTurnOpen = true;
      this.emit({ type: "turn.start", speaker: "ai" });
    }
    for (const part of audioParts) {
      this.emit({
        type: "audio.chunk",
        data: part.inlineData!.data!,
        sampleRate: sampleRateFromMimeType(part.inlineData!.mimeType),
      });
    }

    // Transcript deltas — input (me) and output (ai) are transcribed
    // independently by the Live API.
    if (content.inputTranscription?.text) {
      if (!this.currentMeTurnOpen) {
        this.currentMeTurnOpen = true;
        this.emit({ type: "turn.start", speaker: "me" });
      }
      this.emit({
        type: "transcript.delta",
        speaker: "me",
        text: content.inputTranscription.text,
      });
    }
    if (content.outputTranscription?.text) {
      if (!this.currentAiTurnOpen) {
        this.currentAiTurnOpen = true;
        this.emit({ type: "turn.start", speaker: "ai" });
      }
      this.emit({
        type: "transcript.delta",
        speaker: "ai",
        text: content.outputTranscription.text,
      });
    }

    // Barge-in: the model was interrupted by new user input. Close out the
    // AI turn so the client can stop/flush playback.
    if (content.interrupted && this.currentAiTurnOpen) {
      this.currentAiTurnOpen = false;
      this.emit({ type: "turn.end", speaker: "ai" });
    }

    if (content.turnComplete) {
      if (this.currentAiTurnOpen) {
        this.currentAiTurnOpen = false;
        this.emit({ type: "turn.end", speaker: "ai" });
      }
      if (this.currentMeTurnOpen) {
        this.currentMeTurnOpen = false;
        this.emit({ type: "turn.end", speaker: "me" });
      }
    }
  }

  sendAudio(frame: ArrayBuffer): void {
    if (!this.session) {
      throw new Error("GeminiVoiceAdapter.sendAudio called before connect().");
    }

    // Test-only path (see file-header note + testVadDisabled): with
    // automatic VAD off, the caller must send explicit activityStart/
    // activityEnd boundaries. We open on first frame and debounce the close
    // until sendAudio() has been quiet for a bit, so a whole burst of frames
    // counts as one activity span without the relay/browser needing to know
    // about this Gemini-specific concept at all.
    if (testVadDisabled()) {
      if (!this.testActivityOpen) {
        this.testActivityOpen = true;
        this.session.sendRealtimeInput({ activityStart: {} });
      }
      if (this.testActivityEndTimer) clearTimeout(this.testActivityEndTimer);
      this.testActivityEndTimer = setTimeout(() => {
        this.testActivityOpen = false;
        this.session?.sendRealtimeInput({ activityEnd: {} });
      }, TEST_ACTIVITY_END_DEBOUNCE_MS);
    }

    const data = Buffer.from(frame).toString("base64");
    this.session.sendRealtimeInput({
      audio: { data, mimeType: "audio/pcm;rate=16000" },
    });
  }

  close(): void {
    if (this.testActivityEndTimer) clearTimeout(this.testActivityEndTimer);
    this.session?.close();
    this.session = undefined;
  }
}
