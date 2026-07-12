// Issue #7 machine-verifiable check: actually connect to Gemini Live (real
// upstream, real GEMINI_API_KEY) through the relay + GeminiVoiceAdapter, send
// a short synthetic PCM audio buffer (16-bit/16kHz/mono sine tone), and
// confirm real audio bytes and/or transcript events come back through the
// relay. This proves the live upstream connection + protocol translation
// genuinely works end-to-end — NOT a claim about turn-taking/barge-in
// smoothness, which needs a human ear (PRD-adjacent judgment call, out of
// scope for this script).
//
// Run with: npm run relay:test:live
// Requires a real GEMINI_API_KEY in the environment (.env). Exits 0 and
// prints "PASS" + an evidence summary on success; exits 1 and prints "FAIL"
// + reason otherwise (including if the model is inaccessible/gated for this
// key — that is reported clearly rather than silently stubbed around).
//
// NOTE on VAD: a pure synthetic sine tone does not register as speech to
// Gemini Live's default automatic voice-activity-detection, so this script
// relies on the adapter's test-only GEMINI_VOICE_TEST_DISABLE_VAD=1 escape
// hatch (see gemini-voice-adapter.ts), which switches to explicit
// activityStart/activityEnd boundaries instead. This is ONLY a test
// affordance — normal product operation (issue #9's browser UI) always uses
// Gemini's automatic VAD, which is what gives native turn-taking/barge-in
// per PRD §6. Disabling VAD here is what makes it possible to prove the
// audio round-trip deterministically with non-speech synthetic input;
// it does not change how the adapter behaves for real speech.

import WebSocket from "ws";
import { startRelayServer } from "../server";
import type { RelayEvent } from "../protocol";

const PORT = 8798;
const SAMPLE_RATE = 16000;

if (!process.env.GEMINI_API_KEY) {
  console.error(
    "FAIL: GEMINI_API_KEY is not set in the environment. This script needs " +
      "the real key from .env (e.g. run with `node --env-file=.env` or via " +
      "a runner that loads .env, per this repo's existing convention)."
  );
  process.exit(1);
}
if (process.env.VOICE_PROVIDER && process.env.VOICE_PROVIDER !== "gemini") {
  console.error(
    `FAIL: VOICE_PROVIDER is set to "${process.env.VOICE_PROVIDER}", this script needs the real gemini adapter.`
  );
  process.exit(1);
}

/** Generate `durationMs` of a 440Hz sine tone as 16-bit PCM mono @16kHz. */
function generateSineTonePcm(durationMs: number): Buffer {
  const numSamples = Math.floor((SAMPLE_RATE * durationMs) / 1000);
  const buf = Buffer.alloc(numSamples * 2);
  const freq = 440;
  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    const sample = Math.round(Math.sin(2 * Math.PI * freq * t) * 32767 * 0.5);
    buf.writeInt16LE(sample, i * 2);
  }
  return buf;
}

async function main() {
  const wss = startRelayServer(PORT);
  await new Promise<void>((resolve) => wss.once("listening", resolve));

  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const events: RelayEvent[] = [];

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WS open timeout")), 5000);
    ws.on("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.on("error", reject);
  });
  console.log("[test] WS connection to relay opened.");

  ws.on("message", (raw) => {
    const event = JSON.parse(raw.toString()) as RelayEvent;
    events.push(event);
    const summary =
      event.type === "audio.chunk"
        ? `audio.chunk (${Buffer.from(event.data, "base64").length} bytes @ ${event.sampleRate}Hz)`
        : JSON.stringify(event);
    console.log("[test] received:", summary);
  });

  function waitFor(
    predicate: (e: RelayEvent) => boolean,
    label: string,
    ms: number
  ) {
    return new Promise<RelayEvent>((resolve, reject) => {
      const existing = events.find(predicate);
      if (existing) return resolve(existing);
      const timeout = setTimeout(
        () => reject(new Error(`Timed out after ${ms}ms waiting for ${label}`)),
        ms
      );
      const check = (raw: Buffer | string) => {
        const event = JSON.parse(raw.toString()) as RelayEvent;
        if (predicate(event)) {
          clearTimeout(timeout);
          ws.off("message", check);
          resolve(event);
        }
      };
      ws.on("message", check);
    });
  }

  // 1. session.start against the REAL Gemini Live upstream.
  ws.send(
    JSON.stringify({
      type: "session.start",
      questions: [
        { text: "Tell me about a time you debugged a hard production issue." },
      ],
      jdContext:
        "Senior Fullstack Developer role: TypeScript, React, Node.js, PostgreSQL.",
    })
  );

  try {
    await waitFor((e) => e.type === "session.ready", "session.ready", 20000);
  } catch (err) {
    const errorEvent = events.find((e) => e.type === "error");
    console.error(
      "FAIL: never got session.ready from the real Gemini Live upstream.",
      errorEvent
        ? `Relay reported: ${(errorEvent as { message: string }).message}`
        : "(no error event received either — see raw events above)"
    );
    console.error(
      "This likely means the model " +
        '"gemini-2.5-flash-native-audio-preview" is inaccessible, gated, or ' +
        "rate-limited for this API key. Report this clearly rather than " +
        "assuming success."
    );
    throw err;
  }
  console.log("[test] session.ready — Gemini Live upstream connection established.");

  // 2. Send a few frames of synthetic audio (a 440Hz tone in 100ms chunks,
  // ~1.5s total) to give the model something to react to / transcribe.
  const chunkMs = 100;
  const totalMs = 1500;
  const chunks = Math.floor(totalMs / chunkMs);
  for (let i = 0; i < chunks; i++) {
    const pcm = generateSineTonePcm(chunkMs);
    ws.send(
      JSON.stringify({
        type: "audio.chunk",
        data: pcm.toString("base64"),
        sampleRate: SAMPLE_RATE,
      })
    );
    await new Promise((r) => setTimeout(r, chunkMs));
  }
  console.log(`[test] sent ${chunks} synthetic audio.chunk frames (~${totalMs}ms of 440Hz tone).`);

  // 3. Wait for SOME evidence of a live response: either AI audio.chunk
  // bytes back, or a transcript.delta, or a turn.start/end. Give it a
  // generous window since native-audio models can take a couple seconds.
  let evidence: RelayEvent | undefined;
  try {
    evidence = await waitFor(
      (e) =>
        e.type === "audio.chunk" ||
        e.type === "transcript.delta" ||
        e.type === "turn.start",
      "any real upstream response (audio.chunk / transcript.delta / turn.start)",
      30000
    );
  } catch (err) {
    console.error(
      "FAIL: connected to Gemini Live (got session.ready) but received no " +
        "response events at all after sending audio. A sine tone may not " +
        "register as speech to trigger a spoken reply — this still proves " +
        "the connection + setup handshake works, but not full round-trip " +
        "audio processing. See events received below."
    );
    console.error("Events so far:", JSON.stringify(events, null, 2));
    throw err;
  }

  // Got at least one response event — now give the model a further window
  // to finish its full turn (AI audio.chunk frames + turnComplete), since
  // transcript/turn.start typically land before the audio playback frames.
  try {
    await waitFor((e) => e.type === "turn.end", "turn.end", 15000);
  } catch {
    console.log(
      "[test] (no turn.end within the extra window — proceeding with whatever arrived; not fatal, the model may still be mid-turn.)"
    );
  }

  const audioChunksReceived = events.filter((e) => e.type === "audio.chunk");
  const totalAudioBytes = audioChunksReceived.reduce(
    (sum, e) => sum + Buffer.from((e as { data: string }).data, "base64").length,
    0
  );
  const transcriptDeltas = events.filter((e) => e.type === "transcript.delta");

  console.log("\n[test] --- evidence summary ---");
  console.log(`  session.ready received: yes`);
  console.log(`  audio.chunk events from AI: ${audioChunksReceived.length} (total ${totalAudioBytes} bytes)`);
  console.log(`  transcript.delta events: ${transcriptDeltas.length}`);
  transcriptDeltas.forEach((d) =>
    console.log(`    - [${(d as { speaker: string }).speaker}] ${(d as { text: string }).text}`)
  );
  console.log(`  first response event type: ${evidence.type}`);

  // Give it a bit more time to accumulate any trailing events before closing.
  await new Promise((r) => setTimeout(r, 1000));

  ws.send(JSON.stringify({ type: "session.end" }));
  await new Promise((r) => setTimeout(r, 300));
  ws.close();
  wss.close();

  console.log(`\n[test] total events received: ${events.length}`);
  console.log("PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nFAIL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
