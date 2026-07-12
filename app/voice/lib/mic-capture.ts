// Browser mic capture — issue #9. getUserMedia + AudioWorklet, chosen over
// MediaRecorder because MediaRecorder only emits compressed containers
// (webm/opus) with no easy access to raw PCM frames at a fixed rate;
// AudioWorklet gives us raw Float32 samples we can convert straight to the
// 16-bit PCM / 16kHz / mono format the relay protocol expects (see
// relay/protocol.ts), with no server-side transcoding needed.

const MIC_SAMPLE_RATE = 16000;
const WORKLET_URL = "/worklets/pcm-recorder-worklet.js";
const WORKLET_NAME = "pcm-recorder-processor";

export type MicCapture = {
  stop: () => void;
};

/** Convert Float32 samples in [-1, 1] to 16-bit PCM little-endian bytes. */
function floatTo16BitPcm(float32: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(i * 2, int16, true);
  }
  return buf;
}

/**
 * Start capturing mic audio and invoke onFrame with 16-bit/16kHz/mono PCM
 * chunks as they become available. Returns a handle to stop capture and
 * release the mic.
 */
export async function startMicCapture(
  onFrame: (frame: ArrayBuffer) => void
): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: MIC_SAMPLE_RATE,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  // Some browsers ignore the requested sampleRate constraint, so we force
  // the AudioContext itself to 16kHz — the browser resamples the track to
  // match the context's rate, guaranteeing our worklet sees 16kHz frames
  // regardless of the mic's native rate.
  const audioContext = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
  await audioContext.audioWorklet.addModule(WORKLET_URL);

  const source = audioContext.createMediaStreamSource(stream);
  const workletNode = new AudioWorkletNode(audioContext, WORKLET_NAME);

  workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
    onFrame(floatTo16BitPcm(event.data));
  };

  source.connect(workletNode);
  // Not connecting workletNode to audioContext.destination — we don't want
  // to hear our own mic locally, we only forward frames to the relay.

  return {
    stop: () => {
      workletNode.port.onmessage = null;
      source.disconnect();
      workletNode.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      audioContext.close().catch(() => {});
    },
  };
}
