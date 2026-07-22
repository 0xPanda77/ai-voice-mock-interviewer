// Browser-side relay WS client — issue #9. Thin wrapper that speaks the
// normalized protocol (relay/protocol.ts) over a plain WebSocket. This is
// the ONLY provider-agnostic contract the browser depends on — it never
// touches any vendor voice SDK, per PRD §8b/§7.

import type { ClientEvent, RelayEvent } from "@/relay/protocol";
import type { Question } from "@/lib/types";

export type RelayClient = {
  sendSessionStart: (questions: Question[], jdContext: string) => void;
  sendAudioChunk: (frame: ArrayBuffer) => void;
  sendSessionEnd: () => void;
  close: () => void;
};

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export { base64ToArrayBuffer };

export function connectRelay(
  url: string,
  onOpen: () => void,
  onEvent: (event: RelayEvent) => void,
  onClose: () => void
): RelayClient {
  const ws = new WebSocket(url);

  function send(event: ClientEvent) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  // The relay only emits session.ready in response to a session.start it
  // receives — so the client must speak first, once the socket is actually
  // open (sending synchronously right after `new WebSocket()` would be
  // silently dropped, since readyState is still CONNECTING at that point).
  ws.addEventListener("open", () => onOpen());

  ws.addEventListener("message", (msg) => {
    try {
      const event = JSON.parse(msg.data) as RelayEvent;
      onEvent(event);
    } catch {
      onEvent({ type: "error", message: "Received malformed relay message." });
    }
  });

  ws.addEventListener("close", () => onClose());
  ws.addEventListener("error", () => {
    onEvent({ type: "error", message: "WebSocket connection error." });
  });

  return {
    sendSessionStart(questions, jdContext) {
      send({ type: "session.start", questions, jdContext });
    },
    sendAudioChunk(frame) {
      send({
        type: "audio.chunk",
        data: arrayBufferToBase64(frame),
        sampleRate: 16000,
      });
    },
    sendSessionEnd() {
      send({ type: "session.end" });
    },
    close() {
      ws.close();
    },
  };
}
