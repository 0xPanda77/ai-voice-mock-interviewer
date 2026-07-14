# Deploy guide

Milestone 4 (issue #11) scope, as actually shippable — see the PR for the
full scope-cut rationale. Short version: the Next.js app deploys to Vercel;
the WS relay does **not** get its own cloud host (see below).

## What's deployed

The Next.js app (frontend + `/api/questions` + `/api/score`) is deployed to
Vercel: **https://ai-flagship-project.vercel.app**. This is the part that's
genuinely serverless-friendly — no long-lived socket needed.

Vercel environment variables set for Production (names only — see Vercel
dashboard for values, never commit real values to this repo):

- `GEMINI_API_KEY`
- `TEXT_PROVIDER`

(Preview-environment env vars are not set as of this deploy — the Vercel
CLI's non-interactive `env add ... preview` path kept requiring a
`--value` flag even for `TEXT_PROVIDER`, and passing a real secret via
`--value` on the command line is avoided deliberately for `GEMINI_API_KEY`
(shows up in shell history/process list). Production is what the repo
owner actually uses; add Preview vars via the dashboard if preview deploys
ever need to hit `/api/questions`/`/api/score` for real.)

## What's deliberately NOT deployed: the relay

The relay (`relay/server.ts`) stays **local-only, by design**, for now.
Issue #8 ("decide + provision relay host") was explicitly deferred by the
repo owner — a long-lived-WebSocket host (Cloud Run / Fly / Railway) means
real cost and account setup, and for a single-user personal tool it isn't
worth it yet.

`app/voice/page.tsx`'s `NEXT_PUBLIC_RELAY_URL` therefore still defaults to
`ws://localhost:8787`, even in the deployed build. **This still works
correctly** for this app's actual usage pattern: there is exactly one user
(the repo owner), and he will always be the one running both the browser
tab *and* the relay process, on the same machine. His browser's
`localhost:8787` WebSocket connects to his own machine's relay process
regardless of whether the page's HTML/JS was served from Vercel or from
`localhost:3000` — the frontend's origin doesn't change what `localhost`
resolves to in the browser making the request.

**In short: voice mode requires running the relay locally, even when using
the deployed URL.** This is a deliberate personal-tool tradeoff, not a bug —
see issue #8 for the "why we didn't just deploy it" reasoning.

To use the deployed site's voice mode:

```bash
npm run relay:dev
```

(`relay:dev` now loads `.env` automatically — see the root `package.json` —
so `GEMINI_API_KEY` is picked up without manually exporting it.) Leave that
running locally, then open the deployed URL and use `/voice` as normal; the
browser's WS connection to `ws://localhost:8787` reaches that local process.

If the relay isn't running, voice session connection will fail/hang at
"connecting" — start the relay first.

## Known limitation: Gemini free-tier quota

The free tier is capped at a low daily request count and occasionally
returns transient `503 UNAVAILABLE` ("high demand") errors independent of
quota. `GeminiTextLLM` (`lib/llm/gemini-text-llm.ts`) retries a 503 up to 3
times with a short backoff, but a `429 RESOURCE_EXHAUSTED` (quota fully
used for the day) is not retryable — you'll see an error banner on
`/voice` and need to wait for the daily reset or move to a paid tier. Each
real interview prep session uses 2 calls (`/api/questions` +
`/api/score`), so the free tier covers roughly 10 sessions/day.

**2026-07-13:** switched `MODEL` from `gemini-flash-latest` to
`gemini-flash-lite-latest` after `gemini-flash-latest` returned persistent
(not transient — outlasted the 3-attempt retry) `503 UNAVAILABLE` on this
key, confirmed via direct `curl` against the API. At the same time,
`gemini-flash-lite-latest` responded `200`, and the older pinned
`gemini-2.0-flash`/`gemini-2.0-flash-lite` reported free-tier `limit: 0`
for this key — so `-lite-latest` was the only working option. If this
model later becomes unavailable too, re-run the same `curl` probe against
`models?key=...` to find a live alternative before assuming it's a code
bug.

## Redeploying

```bash
vercel deploy --prod
```

(or push to a branch for a preview deployment, per the linked Vercel
project). `/api/questions` and `/api/score` need `GEMINI_API_KEY` and
`TEXT_PROVIDER` set as Vercel env vars for Production (and Preview, if you
want previews to work too) — see `vercel env ls` / `vercel env add`.
