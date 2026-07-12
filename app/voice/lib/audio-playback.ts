// Browser AI-audio playback — issue #9. Plays back 16-bit PCM audio.chunk
// frames from the relay (see relay/protocol.ts) using the Web Audio API.
// Frames are queued and scheduled back-to-back on an AudioContext running
// at the frame's declared sample rate (Gemini Live sends 24kHz — see
// relay/adapters/gemini-voice-adapter.ts) so no client-side resampling is
// needed; a different provider adapter could send a different rate and
// this stays correct since sampleRate always travels with the frame.

export type AudioPlayer = {
  /** Enqueue a PCM frame for playback, scheduled after any already queued. */
  enqueue: (data: ArrayBuffer, sampleRate: number) => void;
  /** Stop playback and drop anything queued — used on barge-in (turn.end
   * for "ai" while new user audio starts) or when the session ends. */
  flush: () => void;
  close: () => void;
};

function pcm16ToFloat32(buf: ArrayBuffer): Float32Array<ArrayBuffer> {
  const view = new DataView(buf);
  const out = new Float32Array(buf.byteLength / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return out;
}

export function createAudioPlayer(): AudioPlayer {
  let audioContext: AudioContext | null = null;
  let nextStartTime = 0;
  let activeSources: AudioBufferSourceNode[] = [];

  function ensureContext(sampleRate: number): AudioContext {
    if (!audioContext || audioContext.sampleRate !== sampleRate) {
      audioContext?.close().catch(() => {});
      audioContext = new AudioContext({ sampleRate });
      nextStartTime = audioContext.currentTime;
    }
    return audioContext;
  }

  return {
    enqueue(data: ArrayBuffer, sampleRate: number) {
      const ctx = ensureContext(sampleRate);
      const float32 = pcm16ToFloat32(data);
      const audioBuffer = ctx.createBuffer(1, float32.length, sampleRate);
      audioBuffer.copyToChannel(float32, 0);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const startAt = Math.max(nextStartTime, ctx.currentTime);
      source.start(startAt);
      nextStartTime = startAt + audioBuffer.duration;

      activeSources.push(source);
      source.onended = () => {
        activeSources = activeSources.filter((s) => s !== source);
      };
    },
    flush() {
      activeSources.forEach((s) => {
        try {
          s.stop();
        } catch {
          // already stopped/ended — fine to ignore.
        }
      });
      activeSources = [];
      if (audioContext) nextStartTime = audioContext.currentTime;
    },
    close() {
      activeSources.forEach((s) => {
        try {
          s.stop();
        } catch {}
      });
      activeSources = [];
      audioContext?.close().catch(() => {});
      audioContext = null;
    },
  };
}
