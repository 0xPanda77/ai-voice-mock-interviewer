// AudioWorkletProcessor that captures mic input and posts raw Float32
// frames back to the main thread. Runs on the audio rendering thread —
// keep this file dependency-free and tiny (no imports, no framework code).
//
// The AudioContext this is registered on MUST be created at 16000Hz (see
// app/voice/lib/mic-capture.ts) so frames arrive already at the relay's
// expected mic sample rate — no resampling done here.
//
// Energy gate (screening-call-mode branch, diagnosed 2026-07-19): frames
// used to be forwarded unconditionally, including raw ambient mic noise
// after the user stopped talking. Gemini Live's own input-transcription
// was observed hallucinating fragments of "speech" out of that noise
// during long trailing silence, which kept resetting its end-of-speech
// timer — the app appeared "stuck listening" for 20+ seconds after a real
// ~44s answer in a reproduced Gemini Live session (see
// relay/test/debug-vad-stuck-listening.ts). Near-silent frames are now
// replaced with true digital silence (all-zero) before being posted,
// rather than dropped outright — the stream stays continuous (Gemini's
// automatic VAD needs continuous audio to evaluate true silence against),
// but the ambiguous raw noise content it was hallucinating from is gone.
//
// RMS_THRESHOLD is a starting point tuned against synthetic "quiet room"
// noise (~0.005 RMS) during diagnosis, not a real mic — raise it if real
// testing shows noise still leaking through, or raise HANGOVER_FRAMES
// first if quiet trailing syllables mid-word start getting clipped.
const RMS_THRESHOLD = 0.01;
// Keep forwarding real audio for this many frames after energy drops
// below threshold (~200ms at 8ms/frame), so a quiet consonant at the end
// of a word isn't chopped — only sustained silence gets zeroed.
const HANGOVER_FRAMES = 25;

class PcmRecorderProcessor extends AudioWorkletProcessor {
  hangoverRemaining = 0;

  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];

      let sumSquares = 0;
      for (let i = 0; i < channelData.length; i++) {
        sumSquares += channelData[i] * channelData[i];
      }
      const rms = Math.sqrt(sumSquares / channelData.length);

      // Float32Array is zero-initialized, so the "gated" branch (falling
      // through with no copy.set()) is already true digital silence.
      const copy = new Float32Array(channelData.length);
      if (rms >= RMS_THRESHOLD) {
        this.hangoverRemaining = HANGOVER_FRAMES;
        copy.set(channelData);
      } else if (this.hangoverRemaining > 0) {
        this.hangoverRemaining--;
        copy.set(channelData);
      }

      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm-recorder-processor", PcmRecorderProcessor);
