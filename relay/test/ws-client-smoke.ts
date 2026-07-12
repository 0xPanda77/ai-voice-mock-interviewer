// Issue #6 machine-verifiable check: "Browser (or a test WS client script)
// can open a session and exchange the normalized events with a stub
// upstream."
//
// Starts the relay in-process with VOICE_PROVIDER=stub (see
// relay/adapters/stub-voice-adapter.ts — a fake upstream with no real
// provider involved), connects a plain `ws` client, and drives the full
// client->relay->client protocol: session.start -> session.ready,
// audio.chunk -> transcript.delta/turn.start/turn.end, then session.end.
//
// Run with: VOICE_PROVIDER=stub npx tsx relay/test/ws-client-smoke.ts
// (the npm script `relay:test:smoke` sets this for you)
// Exits 0 and prints "PASS" on success, exits 1 and prints "FAIL" + reason
// otherwise.

import WebSocket from "ws";
import { startRelayServer } from "../server";
import type { RelayEvent } from "../protocol";

if (process.env.VOICE_PROVIDER !== "stub") {
  console.error(
    'FAIL: this script must be run with VOICE_PROVIDER=stub (env vars must be set before the process starts, not after import) — e.g. `npm run relay:test:smoke`.'
  );
  process.exit(1);
}

const PORT = 8799;

async function main() {
  const wss = startRelayServer(PORT);
  await new Promise<void>((resolve) => wss.once("listening", resolve));

  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const events: RelayEvent[] = [];

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for WS open.")),
      5000
    );
    ws.on("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.on("error", reject);
  });
  console.log("[test] WS connection opened.");

  ws.on("message", (raw) => {
    const event = JSON.parse(raw.toString()) as RelayEvent;
    events.push(event);
    console.log("[test] received:", JSON.stringify(event));
  });

  function waitFor(predicate: (e: RelayEvent) => boolean, label: string, ms = 5000) {
    return new Promise<RelayEvent>((resolve, reject) => {
      const existing = events.find(predicate);
      if (existing) return resolve(existing);
      const timeout = setTimeout(
        () => reject(new Error(`Timed out waiting for ${label}`)),
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

  // 1. session.start -> expect session.ready
  ws.send(
    JSON.stringify({
      type: "session.start",
      questions: [{ text: "Tell me about a challenging project." }],
      jdContext: "Senior Fullstack Developer, TypeScript/React/Node.",
    })
  );
  await waitFor((e) => e.type === "session.ready", "session.ready");
  console.log("[test] got session.ready");

  // 2. audio.chunk -> expect turn.start/transcript.delta/turn.end back
  const fakePcm = Buffer.alloc(320, 0); // 10ms of silence @16kHz/16-bit mono
  ws.send(
    JSON.stringify({
      type: "audio.chunk",
      data: fakePcm.toString("base64"),
      sampleRate: 16000,
    })
  );
  await waitFor(
    (e) => e.type === "transcript.delta",
    "transcript.delta"
  );
  console.log("[test] got transcript.delta in response to audio.chunk");
  await waitFor(
    (e) => e.type === "turn.end" && e.speaker === "me",
    "turn.end(me)"
  );
  console.log("[test] got turn.end(me)");

  // 3. session.end -> should close cleanly, no error events, socket stays
  // healthy (server doesn't crash / drop the connection uncleanly).
  ws.send(JSON.stringify({ type: "session.end" }));
  await new Promise((r) => setTimeout(r, 300));

  const errorEvents = events.filter((e) => e.type === "error");
  if (errorEvents.length > 0) {
    throw new Error(
      `Relay emitted error event(s): ${JSON.stringify(errorEvents)}`
    );
  }
  if (ws.readyState !== WebSocket.OPEN) {
    throw new Error(
      `Expected socket still OPEN after session.end (relay shouldn't force-close), got readyState=${ws.readyState}`
    );
  }
  console.log("[test] sent session.end cleanly, socket still healthy, no error events");

  ws.close();
  wss.close();

  console.log(`\n[test] total events received: ${events.length}`);
  console.log("PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
