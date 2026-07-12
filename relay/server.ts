// Node WebSocket relay — PRD §7 / §11 / Milestone 2 (issue #6).
//
// A thin, provider-agnostic relay: the browser speaks the normalized
// protocol (./protocol.ts) to this server over WS; this server drives a
// VoiceAdapter (./voice-adapter.ts) that translates to/from whichever
// upstream voice provider is selected. The browser never holds a provider
// API key — only this server process reads GEMINI_API_KEY (via the adapter).
//
// Deliberately a separate long-lived Node process from the Next.js app
// (Vercel functions can't hold long-lived WebSockets — PRD §11/§14). Run
// with `npm run relay:dev` (tsx). Cloud hosting for this process is issue
// #8, explicitly deferred — see README note in the PR description.

import { WebSocketServer, type WebSocket } from "ws";
import { parseClientEvent, type RelayEvent } from "./protocol";
import { createVoiceAdapter, type VoiceAdapter } from "./voice-adapter";

const PORT = Number(process.env.RELAY_PORT) || 8787;
const DEFAULT_VOICE = "Puck";

function send(ws: WebSocket, event: RelayEvent): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function buildSystemPrompt(jdContext: string, questions: unknown): string {
  const questionsList = Array.isArray(questions)
    ? questions
        .map((q, i) =>
          typeof q === "object" && q !== null && "text" in q
            ? `${i + 1}. ${(q as { text: string }).text}`
            : null
        )
        .filter(Boolean)
        .join("\n")
    : "";

  return (
    "You are an experienced technical interviewer conducting a spoken mock " +
    "interview for the role described below. Ask the prepared questions " +
    "one at a time, listen to the candidate's spoken answer, and ask brief " +
    "spoken follow-ups when an answer is shallow. Keep your own turns " +
    "concise — this is a conversation, not a monologue.\n\n" +
    `Job description:\n"""\n${jdContext}\n"""\n\n` +
    (questionsList ? `Prepared questions:\n${questionsList}\n` : "")
  );
}

async function handleConnection(ws: WebSocket): Promise<void> {
  let adapter: VoiceAdapter | undefined;
  let started = false;

  // ws fires one "message" event per frame without waiting for a previous
  // async handler to finish — so without serializing, an audio.chunk sent
  // right after session.start can be handled concurrently with (i.e.
  // before) session.start's own await adapter.connect() finishes assigning
  // the adapter. Chain each message's processing onto a per-connection
  // queue so events are handled strictly in arrival order.
  let queue: Promise<void> = Promise.resolve();

  ws.on("message", (raw: Buffer) => {
    queue = queue.then(() => processMessage(raw)).catch((err) => {
      send(ws, {
        type: "error",
        message: err instanceof Error ? err.message : "Unknown relay error.",
      });
    });
  });

  async function processMessage(raw: Buffer): Promise<void> {
    let event;
    try {
      event = parseClientEvent(raw.toString());
    } catch (err) {
      send(ws, {
        type: "error",
        message: err instanceof Error ? err.message : "Invalid message.",
      });
      return;
    }

    switch (event.type) {
      case "session.start": {
        if (started) {
          send(ws, { type: "error", message: "Session already started." });
          return;
        }
        started = true;
        adapter = await createVoiceAdapter();
        adapter.onEvent((relayEvent) => send(ws, relayEvent));
        await adapter.connect({
          systemPrompt: buildSystemPrompt(event.jdContext, event.questions),
          voice: DEFAULT_VOICE,
        });
        break;
      }
      case "audio.chunk": {
        if (!adapter) {
          send(ws, {
            type: "error",
            message: "Received audio.chunk before session.start.",
          });
          return;
        }
        const buf = Buffer.from(event.data, "base64");
        adapter.sendAudio(
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        );
        break;
      }
      case "session.end": {
        adapter?.close();
        adapter = undefined;
        started = false;
        break;
      }
    }
  }

  ws.on("close", () => {
    adapter?.close();
    adapter = undefined;
  });
}

export function startRelayServer(port: number = PORT): WebSocketServer {
  const wss = new WebSocketServer({ port });
  wss.on("connection", (ws) => {
    handleConnection(ws).catch((err) => {
      send(ws, {
        type: "error",
        message: err instanceof Error ? err.message : "Connection setup failed.",
      });
    });
  });
  wss.on("listening", () => {
    console.log(`[relay] listening on ws://localhost:${port}`);
  });
  return wss;
}

// Run directly (tsx relay/server.ts / npm run relay:dev), not when imported
// by a test script.
if (require.main === module) {
  startRelayServer();
}
