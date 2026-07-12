// Generates a small synthetic WAV file used as Chromium's
// --use-file-for-fake-audio-capture input for the Playwright E2E test
// (app/voice/e2e/voice-page.spec.ts). A simple sine tone is enough: the
// point isn't audio content, it's proving that mic frames actually flow
// browser -> relay -> adapter and that we get real events back, using a
// real (if synthetic) getUserMedia audio track rather than pure silence
// (some browsers special-case an all-zero fake capture).
//
// Run with: npx tsx app/voice/e2e/fixtures/generate-fake-mic-wav.ts

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const SAMPLE_RATE = 16000;
const DURATION_SECONDS = 3;
const FREQUENCY_HZ = 440; // A4 tone
const NUM_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

function buildWavFile(): Buffer {
  const numSamples = SAMPLE_RATE * DURATION_SECONDS;
  const dataSize = numSamples * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(NUM_CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  const byteRate = (SAMPLE_RATE * NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
  buffer.writeUInt32LE(byteRate, 28);
  const blockAlign = (NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    // Gentle amplitude (0.3) sine wave — a real oscillating signal so it's
    // not indistinguishable from silence to any downstream VAD/analysis.
    const sample = Math.sin(2 * Math.PI * FREQUENCY_HZ * t) * 0.3;
    const int16 = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    buffer.writeInt16LE(int16, 44 + i * 2);
  }

  return buffer;
}

function main() {
  const outPath = join(__dirname, "fake-mic.wav");
  writeFileSync(outPath, buildWavFile());
  console.log(`Wrote ${outPath}`);
}

main();
