// E2E verification for M3 "wire the loop" (issue #10) — the FULL product
// loop, end to end, through the real browser code path: paste a JD -> real
// /api/questions call -> generated questions render -> start a live voice
// session fed those real questions/JD (not the old hardcoded
// PLACEHOLDER_JD/PLACEHOLDER_QUESTIONS) -> end the session -> /api/score is
// called on the captured transcript -> feedback renders.
//
// Also retains the original M2 deadlock-fix coverage (session.start /
// session.ready handshake) as part of the same flow, since reaching
// "in-session" is a prerequisite step here too.
//
// Requires, started externally before `npx playwright test` runs (see
// run-stub.sh / run-gemini.sh in this directory):
//   - relay/server.ts running on RELAY_PORT (default 8787), with
//     VOICE_PROVIDER=stub or VOICE_PROVIDER=gemini
//   - `npm run dev` (Next.js) running on port 3000, with GEMINI_API_KEY set
//     (the questions step always hits the real Gemini text API — only the
//     VOICE step is swapped between stub/real via VOICE_PROVIDER)
import { test, expect } from "@playwright/test";

/** Collapse all whitespace runs to a single space, for comparing text
 * rendered by the browser (which normalizes whitespace) against the raw
 * multi-line systemPrompt string built by relay/server.ts. */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const SAMPLE_JD = `
Senior Fullstack Developer — Platform Team

We're looking for a Senior Fullstack Developer to join our platform team.
You'll design and build customer-facing web applications at scale using
TypeScript, React, Next.js, and Node.js, with PostgreSQL as our primary
datastore. You'll own features end to end: API design, database schema,
frontend implementation, and production monitoring. Experience mentoring
other engineers and driving technical decisions across a small team is a
big plus. We value pragmatic engineering, clear written communication, and
a bias toward shipping.
`.trim();

test("full loop: JD -> real questions -> voice session fed those questions -> end -> real scoring -> feedback (stub voice adapter)", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_VOICE_PROVIDER !== "stub",
    "This assertion set relies on the stub adapter's deterministic echo behavior; run via run-stub.sh."
  );

  await page.goto("/voice");

  // --- Step 1: JD -> real /api/questions call -------------------------
  await page.getByPlaceholder("Paste the full job description here...").fill(
    SAMPLE_JD
  );
  await page.getByRole("button", { name: "Generate questions" }).click();

  // Real Gemini text call — observed to occasionally take 20-30s+ under
  // load (and even return transient 503s), so give this a generous timeout
  // rather than tune the test to the model's momentary latency.
  await expect(page.getByText("Generating...")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate questions" })
  ).toBeEnabled({ timeout: 60_000 });

  // Questions rendered as an ordered list of at least one <li>, each with
  // its question text in a direct <span> child (see app/voice/page.tsx) —
  // target that span specifically so we don't pick up nested followupHints
  // text (which the system prompt does not include verbatim).
  const questionItems = page.locator("ol.list-decimal > li");
  await expect(questionItems.first()).toBeVisible({ timeout: 60_000 });
  const questionCount = await questionItems.count();
  expect(questionCount).toBeGreaterThan(0);
  const firstQuestionText = (
    await questionItems.first().locator("> span").first().innerText()
  ).trim();
  expect(firstQuestionText.length).toBeGreaterThan(0);

  // --- Step 2: start the voice session fed those REAL questions -------
  await page.getByRole("button", { name: "Start voice session" }).click();

  // Same deadlock-fix assertion as M2: must actually reach "in-session",
  // not hang on "connecting".
  await expect(page.locator("span.font-mono")).toHaveText("in-session", {
    timeout: 15_000,
  });

  // The stub adapter (relay/adapters/stub-voice-adapter.ts) echoes back the
  // systemPrompt it was connected with as a debug "ai" transcript turn
  // before session.ready. Assert that debug turn contains the real
  // first-generated question text (and the JD), proving the relay's
  // buildSystemPrompt() was fed the real generated questions/JD from this
  // session — not the old hardcoded PLACEHOLDER_QUESTIONS/PLACEHOLDER_JD.
  const debugTurn = page.getByText("(stub debug systemPrompt)", {
    exact: false,
  });
  await expect(debugTurn.first()).toBeVisible({ timeout: 10_000 });
  const debugText = normalizeWhitespace(await debugTurn.first().innerText());
  expect(debugText).toContain(normalizeWhitespace(firstQuestionText));
  expect(debugText).toContain("Senior Fullstack Developer");

  // Drive the mic-frame path: startMic() is called once session.ready
  // arrives, so by the time we're "in-session" the AudioWorklet should
  // already be forwarding fake-mic.wav frames to the relay. The stub
  // adapter echoes back turn.start(me) -> transcript.delta(me, "(stub)
  // ...") -> turn.end(me) for every audio.chunk it receives.
  await expect(
    page.getByText("(stub) ...", { exact: false }).first()
  ).toBeVisible({ timeout: 15_000 });

  const meTurns = page.getByText("Me:", { exact: false });
  await expect(meTurns.first()).toBeVisible();
  expect(await meTurns.count()).toBeGreaterThan(0);

  // --- Step 3: end the session -> real /api/score call -> feedback ----
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.locator("span.font-mono")).toHaveText("ended");

  // Scoring is a real Gemini text call too — generous timeout, same
  // reasoning as the questions call above.
  await expect(page.getByText("Scoring…")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/^Score:/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/^Tier:/)).toBeVisible();

  // Exactly 3 feedback bullets per PRD §4/§12 (Feedback.comments). Scoped to
  // the feedback section's own list (data-testid) — the questions section
  // above also renders a list.disc <ul> for followupHints, which a bare
  // "ul.list-disc > li" selector would also match.
  const feedbackBullets = page.getByTestId("feedback-comments").locator("li");
  await expect(feedbackBullets.first()).toBeVisible();
  expect(await feedbackBullets.count()).toBe(3);
});

test("voice session reaches in-session against the real Gemini Live adapter, fed real generated questions", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_VOICE_PROVIDER !== "gemini",
    "Only run against real Gemini Live when explicitly requested (costs money — PRD §10); run via run-gemini.sh."
  );

  await page.goto("/voice");

  await page.getByPlaceholder("Paste the full job description here...").fill(
    SAMPLE_JD
  );
  await page.getByRole("button", { name: "Generate questions" }).click();
  await expect(
    page.locator("ol.list-decimal > li").first()
  ).toBeVisible({ timeout: 30_000 });

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
