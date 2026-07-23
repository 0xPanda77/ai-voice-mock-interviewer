// Shared free-tier quota handling. We can't query Gemini for remaining
// quota (no such API), so instead we detect the moment a call fails with a
// quota error (HTTP 429 / RESOURCE_EXHAUSTED — the Gemini SDK embeds the
// status JSON in the Error message, same pattern as the 503 retry in
// gemini-text-llm.ts) and surface a friendly, actionable message instead of
// a raw provider error.

export function isQuotaError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /"code":429|RESOURCE_EXHAUSTED|exceeded your current quota/i.test(
      err.message
    )
  );
}

// The word "quota" doubles as the client-side detection hook: the interview
// page appends a "run it locally" GitHub link to any error containing it
// (see ErrorNote in app/interview/page.tsx).
export const QUOTA_ERROR_MESSAGE =
  "The shared demo has used up its free daily quota. It resets once a day — " +
  "or run it locally with your own free Gemini key.";
