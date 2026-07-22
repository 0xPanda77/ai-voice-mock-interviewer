// DEBUG-a4f2 — Phase 1/2 feedback loop for "app stuck in listening mode,
// no AI response after the user finishes speaking" (screening-call-mode
// branch). Replays the FULL multi-turn sequence from the user's actual
// bug report (AI opens unprompted -> "Hello. Can you hear me?" -> AI asks
// intro question -> the long intro answer -> [reported: stuck forever]), through
// the real relay -> real GeminiVoiceAdapter -> real Gemini Live, using
// REAL automatic VAD (does NOT set GEMINI_VOICE_TEST_DISABLE_VAD) and
// whatever automaticActivityDetection config is CURRENTLY live in
// gemini-voice-adapter.ts (imported for real, not duplicated).
//
// Audio is a single continuous stream the whole session (never a hard
// start/stop) — mimicking mic-capture.ts, which forwards every worklet
// frame unconditionally with no client-side silence gating. Speech
// utterances (synthesized via macOS `say`, matching the 16-bit/16kHz/mono
// PCM format) are spliced into the stream at the right moments; the rest
// of the time low-amplitude noise plays, matching a real mic's ambient
// noise floor.
//
// Run: npx tsx --env-file=.env relay/test/debug-vad-stuck-listening.ts
import { readFileSync } from "node:fs";
import WebSocket from "ws";
import { startRelayServer } from "../server";
import type { RelayEvent } from "../protocol";

const PORT = 8799;
const SAMPLE_RATE = 16000;
// Matches the REAL mic-capture.ts chunk size exactly: AudioWorkletProcessor
// fires once per 128-sample render quantum (Web Audio spec constant), which
// at 16kHz is 8ms/256 bytes per frame — ~125 messages/sec, not the 10/sec
// an earlier version of this script used. Testing hypothesis: does the
// relay/adapter/Gemini Live path behave differently at the real message
// rate vs. a coarser simulated one?
const CHUNK_MS = 8;
const STUCK_TIMEOUT_MS = 40000;

// User clarification (2026-07-19): the stuck point is specifically after
// answering the intro question AT LENGTH (~30-45s), not after a short
// utterance — the earlier the long intro answer (<1s) repro attempts all passed.
// This run replaces that short utterance with a real ~44s spoken answer to
// test the "does a long continuous user turn behave differently" hypothesis.

if (!process.env.GEMINI_API_KEY) {
  console.error("FAIL: GEMINI_API_KEY not set.");
  process.exit(1);
}
if (process.env.GEMINI_VOICE_TEST_DISABLE_VAD === "1") {
  console.error("FAIL: this script needs REAL automatic VAD — unset GEMINI_VOICE_TEST_DISABLE_VAD.");
  process.exit(1);
}

function readPcmFromWav(path: string): Buffer {
  return readFileSync(path).subarray(44);
}

// VERIFICATION MODE (2026-07-19): simulating the fix now in
// public/worklets/pcm-recorder-worklet.js — near-silent frames get zeroed
// client-side before ever reaching the relay/Gemini. Buffer.alloc()
// zero-fills by default, so this IS what the gate produces post-hangover.
// (Set to false to reproduce the original raw-noise hallucination bug.)
const SIMULATE_NOISE_GATE_FIX = true;

function generateNoiseChunk(durationMs: number): Buffer {
  const numSamples = Math.floor((SAMPLE_RATE * durationMs) / 1000);
  const buf = Buffer.alloc(numSamples * 2);
  if (!SIMULATE_NOISE_GATE_FIX) {
    for (let i = 0; i < numSamples; i++) {
      buf.writeInt16LE(Math.round((Math.random() * 2 - 1) * 300), i * 2);
    }
  }
  return buf;
}

async function main() {
  const hiPcm = readPcmFromWav("/tmp/hi.wav");
  const helloPcm = readPcmFromWav("/tmp/hello-hear-me.wav");
  const startPcm = readPcmFromWav("/tmp/intro-answer.wav");

  const wss = startRelayServer(PORT);
  await new Promise<void>((resolve) => wss.once("listening", resolve));

  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const events: Array<{ t: number; event: RelayEvent }> = [];
  const startTime = Date.now();

  const isAiEvent = (e: RelayEvent) =>
    e.type === "audio.chunk" ||
    ((e.type === "turn.start" || e.type === "turn.end" || e.type === "transcript.delta") &&
      (e as { speaker?: string }).speaker === "ai");

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WS open timeout")), 5000);
    ws.on("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.on("error", reject);
  });

  ws.on("message", (raw) => {
    const event = JSON.parse(raw.toString()) as RelayEvent;
    events.push({ t: Date.now(), event });
    const tag = isAiEvent(event) ? "AI " : event.type === "session.ready" ? "   " : "me ";
    const summary =
      event.type === "audio.chunk"
        ? `audio.chunk (${Buffer.from(event.data, "base64").length}b)`
        : JSON.stringify(event);
    console.log(`[debug-a4f2] ${tag}+${Date.now() - startTime}ms`, summary);
  });

  function waitFor(predicate: (e: RelayEvent) => boolean, label: string, ms: number) {
    return new Promise<void>((resolve, reject) => {
      if (events.some((e) => predicate(e.event))) return resolve();
      const timeout = setTimeout(() => reject(new Error(`Timed out after ${ms}ms waiting for ${label}`)), ms);
      const check = (raw: Buffer | string) => {
        const event = JSON.parse(raw.toString()) as RelayEvent;
        if (predicate(event)) {
          clearTimeout(timeout);
          ws.off("message", check);
          resolve();
        }
      };
      ws.on("message", check);
    });
  }

  // Continuous audio-send loop — mimics mic-capture.ts's unconditional
  // streaming. A queue of real-speech chunks gets spliced in on top of the
  // default noise floor when we want to "speak." Only starts AFTER
  // session.ready, matching production (app/interview/page.tsx only calls
  // startMic() on session.ready) — starting it earlier caused a spurious
  // "audio.chunk before session.start" relay error in an earlier version
  // of this script.
  const speechQueue: Buffer[] = [];
  let streaming = false;
  const bytesPerChunk = Math.floor((SAMPLE_RATE * CHUNK_MS) / 1000) * 2;
  function enqueueSpeech(pcm: Buffer) {
    for (let offset = 0; offset < pcm.length; offset += bytesPerChunk) {
      speechQueue.push(Buffer.from(pcm.subarray(offset, offset + bytesPerChunk)));
    }
  }
  function startStreamingLoop() {
    streaming = true;
    (async () => {
      while (streaming) {
        const chunk = speechQueue.shift() ?? generateNoiseChunk(CHUNK_MS);
        ws.send(JSON.stringify({ type: "audio.chunk", data: chunk.toString("base64"), sampleRate: SAMPLE_RATE }));
        await new Promise((r) => setTimeout(r, CHUNK_MS));
      }
    })();
  }

  ws.send(
    JSON.stringify({
      type: "session.start",
      questions: [
        { text: "To start, could you introduce yourself and walk me through your background?" },
        { text: "What drew you to Example.ai's mission, and how does this role align with your long-term career goals as an engineer?" },
        { text: "Could you walk me through a specific AI-powered feature you have built and deployed to production, highlighting the challenges you faced and how you handled them?" },
      ],
      jdContext: "Full-Stack Developer (AI Engineering) at Example.ai.",
    })
  );
  await waitFor((e) => e.type === "session.ready", "session.ready", 20000);
  console.log("[debug-a4f2] session.ready — starting continuous audio streaming (noise floor).");
  startStreamingLoop();

  // 1. A pure noise-floor stream never triggers a spontaneous AI greeting
  // (confirmed in an earlier run of this script: 20s timeout, no opening
  // turn at all) — so the real transcript's opening line was almost
  // certainly triggered by *some* detected user activity. Send a short
  // "Hi." first, matching a realistic opener, then wait for the AI's
  // opening turn to finish.
  enqueueSpeech(hiPcm);
  await new Promise((r) => setTimeout(r, (hiPcm.length / 2 / SAMPLE_RATE) * 1000 + 300));
  await waitFor((e) => e.type === "turn.end" && (e as { speaker?: string }).speaker === "ai", "AI opening turn.end", 20000);
  console.log("[debug-a4f2] AI opening turn done. Speaking: 'Hello. Can you hear me?'");

  // 2. Splice in "Hello. Can you hear me?"
  enqueueSpeech(helloPcm);
  await new Promise((r) => setTimeout(r, (helloPcm.length / 2 / SAMPLE_RATE) * 1000 + 500));

  // 3. Wait for the AI's reply (the intro question) to finish — i.e. a
  // SECOND ai turn.end event.
  await waitFor(
    () =>
      events.filter((ev) => ev.event.type === "turn.end" && (ev.event as { speaker?: string }).speaker === "ai")
        .length >= 2,
    "AI second turn.end",
    20000
  );
  console.log("[debug-a4f2] AI second turn done. Speaking: 'Let's start.' — then watching for a THIRD AI response.");

  // 4. Splice in the long intro answer — this is the exact point the user reported getting stuck.
  const preLetsStartEventCount = events.length;
  enqueueSpeech(startPcm);
  const speechSendMs = (startPcm.length / 2 / SAMPLE_RATE) * 1000;
  await new Promise((r) => setTimeout(r, speechSendMs + 300));
  const letsStartSentAt = Date.now();

  let respondedWithin: number | undefined;
  const deadline = Date.now() + STUCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const gotResponse = events.slice(preLetsStartEventCount).some((e) => isAiEvent(e.event) && e.t >= letsStartSentAt);
    if (gotResponse) {
      respondedWithin = Date.now() - letsStartSentAt;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  streaming = false;
  ws.send(JSON.stringify({ type: "session.end" }));
  await new Promise((r) => setTimeout(r, 300));
  ws.close();
  wss.close();

  console.log("\n[debug-a4f2] --- result ---");
  if (respondedWithin !== undefined) {
    console.log(`PASS: AI responded ${respondedWithin}ms after the long intro answer finished sending (within ${STUCK_TIMEOUT_MS}ms budget).`);
    process.exit(0);
  } else {
    console.log(
      `FAIL: no AI response within ${STUCK_TIMEOUT_MS}ms of the long intro answer finishing, despite continuous mic-noise streaming throughout. Reproduces the user's "stuck listening" bug.`
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n[debug-a4f2] FAIL (exception):", err instanceof Error ? err.message : err);
  process.exit(1);
});
