// Playwright config for the M2 verification E2E test (app/voice/e2e/).
//
// This does NOT start webServer entries for the relay/Next.js dev server
// automatically — the test scripts (app/voice/e2e/run-stub.sh,
// run-gemini.sh) start/stop both processes explicitly around
// `playwright test`, since the relay needs a specific VOICE_PROVIDER env
// var set before it boots (see relay/voice-adapter.ts) and we want full
// control over teardown (killing both processes even on failure).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./app/voice/e2e",
  // M3's full-loop test (voice-page.spec.ts) makes two real Gemini text
  // calls (/api/questions, /api/score) in addition to the voice-session
  // steps. Observed real-world latency for each call: usually a few
  // seconds, occasionally 20-30s+ under load. Generous headroom beyond the
  // original M2 test's 30s (which had no real text-LLM calls).
  timeout: 150_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    permissions: ["microphone"],
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${__dirname}/app/voice/e2e/fixtures/fake-mic.wav`,
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
