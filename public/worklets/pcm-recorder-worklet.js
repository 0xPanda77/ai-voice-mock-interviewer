// AudioWorkletProcessor that captures mic input and posts raw Float32
// frames back to the main thread. Runs on the audio rendering thread —
// keep this file dependency-free and tiny (no imports, no framework code).
//
// The AudioContext this is registered on MUST be created at 16000Hz (see
// app/voice/lib/mic-capture.ts) so frames arrive already at the relay's
// expected mic sample rate — no resampling done here.
class PcmRecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      // Copy out of the reusable input buffer before posting — the
      // underlying buffer gets reused by the audio thread on the next call.
      const copy = new Float32Array(channelData.length);
      copy.set(channelData);
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm-recorder-processor", PcmRecorderProcessor);
