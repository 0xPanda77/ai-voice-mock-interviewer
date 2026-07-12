// StubVoiceAdapter — a fake upstream used ONLY for testing the relay's
// protocol plumbing in isolation from any real provider (issue #6's
// "exchange the normalized events with a stub upstream" requirement).
//
// Not selectable via VOICE_PROVIDER in normal operation — the relay test
// script wires this in directly. Kept in relay/adapters/ alongside the real
// adapter since it implements the same VoiceAdapter interface, but it is
// NOT the Gemini adapter and holds no provider-specific logic at all.

import type { RelayEvent } from "../protocol";
import type { VoiceAdapter, VoiceAdapterConfig } from "../voice-adapter";

export class StubVoiceAdapter implements VoiceAdapter {
  private listeners: Array<(e: RelayEvent) => void> = [];
  public receivedFrames: ArrayBuffer[] = [];
  public connectedWith: VoiceAdapterConfig | undefined;

  private emit(event: RelayEvent): void {
    for (const cb of this.listeners) cb(event);
  }

  onEvent(cb: (e: RelayEvent) => void): void {
    this.listeners.push(cb);
  }

  async connect(config: VoiceAdapterConfig): Promise<void> {
    this.connectedWith = config;
    // Simulate the upstream announcing readiness asynchronously, same as a
    // real provider socket's onopen.
    queueMicrotask(() => this.emit({ type: "session.ready" }));
  }

  sendAudio(frame: ArrayBuffer): void {
    this.receivedFrames.push(frame);
    // Echo a fake transcript + turn events so a test client can observe
    // something coming back in response to audio.
    this.emit({ type: "turn.start", speaker: "me" });
    this.emit({ type: "transcript.delta", speaker: "me", text: "(stub) ..." });
    this.emit({ type: "turn.end", speaker: "me" });
  }

  close(): void {
    // No-op — nothing to tear down for the stub.
  }
}
