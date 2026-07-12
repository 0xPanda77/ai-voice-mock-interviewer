// E2E verification for the session.start/session.ready deadlock fix
// (commit 15f39d7, issues #7/#9).
//
// Unlike relay/test/ws-client-smoke.ts and relay/test/gemini-live-smoke.ts
// (which drive the relay directly with a raw `ws` client, bypassing
// app/voice/page.tsx and app/voice/lib/relay-client.ts entirely), this test
// drives the REAL browser code path: it loads /voice in a real Chromium
// page (via Playwright, with a fake mic device backed by
// fixtures/fake-mic.wav), clicks "Start voice session", and asserts the UI
// actually reaches "in-session" — proving the exact deadlock the repo owner
// hit (stuck forever on "connecting") is gone, using the real client code.
//
// Requires, started externally before `npx playwright test` runs (see
// run-stub.sh / run-gemini.sh in this directory):
//   - relay/server.ts running on RELAY_PORT (default 8787), with
//     VOICE_PROVIDER=stub or VOICE_PROVIDER=gemini
//   - `npm run dev` (Next.js) running on port 3000
import { test, expect } from "@playwright/test";

test("voice session reaches in-session and gets a transcript turn back (stub adapter)", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_VOICE_PROVIDER !== "stub",
    "This assertion set is specific to the stub adapter's fake echo behavior; run via run-stub.sh."
  );

  await page.goto("/voice");

  await expect(page.getByText(/^Status:/)).toBeVisible();
  await expect(page.locator("span.font-mono")).toHaveText("idle");

  await page.getByRole("button", { name: "Start voice session" }).click();

  // The bug: this used to hang on "connecting" forever because the client
  // waited for session.ready before ever sending session.start, and the
  // relay only sends session.ready in response to session.start. Assert we
  // actually get past "connecting" within a generous but bounded timeout.
  await expect(page.locator("span.font-mono")).toHaveText("in-session", {
    timeout: 15_000,
  });

  // Drive the mic-frame path: startMic() is called once session.ready
  // arrives, so by the time we're "in-session" the AudioWorklet should
  // already be forwarding fake-mic.wav frames to the relay. The stub
  // adapter (relay/adapters/stub-voice-adapter.ts) echoes back
  // turn.start(me) -> transcript.delta(me, "(stub) ...") -> turn.end(me)
  // for every audio.chunk it receives, so a transcript entry should show
  // up without any further action.
  await expect(
    page.getByText("(stub) ...", { exact: false }).first()
  ).toBeVisible({ timeout: 15_000 });

  // The transcript line is rendered under the "Me:" label since the stub
  // echoes speaker: "me". Continuous mic frames mean multiple turns can
  // arrive — assert at least one, not exactly one.
  const transcriptTurns = page.getByText("Me:", { exact: false });
  await expect(transcriptTurns.first()).toBeVisible();
  expect(await transcriptTurns.count()).toBeGreaterThan(0);

  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.locator("span.font-mono")).toHaveText("ended");
});

test("voice session reaches in-session against the real Gemini Live adapter", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_VOICE_PROVIDER !== "gemini",
    "Only run against real Gemini Live when explicitly requested (costs money — PRD §10); run via run-gemini.sh."
  );

  await page.goto("/voice");
  await page.getByRole("button", { name: "Start voice session" }).click();

  // Same core assertion as the stub test: proves the deadlock fix holds
  // against the real upstream, not just the stub. We deliberately do NOT
  // assert on transcript content here (real Gemini Live's response to a
  // synthetic sine tone is not scripted/deterministic like the stub's is),
  // and we keep the session open only briefly before ending it, to
  // minimize real API usage cost per PRD §10.
  await expect(page.locator("span.font-mono")).toHaveText("in-session", {
    timeout: 20_000,
  });

  // Give the real adapter a short window to process the fake audio and
  // potentially emit something back, without holding the session open
  // longer than necessary.
  await page.waitForTimeout(4_000);

  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.locator("span.font-mono")).toHaveText("ended");
});
