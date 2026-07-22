# Deploy guide

The Next.js app (frontend + `/api/questions` + `/api/score`) deploys to
Vercel; the WS relay (`relay/server.ts`) deploys to Render — see below for
why it needed a separate host, and issue #8 for the fuller history (it was
originally deferred as local-only for a single-user tool; multi-user demo
access is the reason it's now deployed for real).

## What's deployed

The Next.js app is deployed to Vercel:
**https://ai-voice-mock-interviewer.vercel.app**. This is the part that's
genuinely serverless-friendly — no long-lived socket needed.

Vercel environment variables set for Production (names only — see Vercel
dashboard for values, never commit real values to this repo):

- `GEMINI_API_KEY`
- `TEXT_PROVIDER`
- `NEXT_PUBLIC_RELAY_URL` — the deployed relay's `wss://` URL (see below)

(Preview-environment env vars are not set as of this deploy — the Vercel
CLI's non-interactive `env add ... preview` path kept requiring a
`--value` flag even for `TEXT_PROVIDER`, and passing a real secret via
`--value` on the command line is avoided deliberately for `GEMINI_API_KEY`
(shows up in shell history/process list). Production is what the repo
owner actually uses; add Preview vars via the dashboard if preview deploys
ever need to hit `/api/questions`/`/api/score` for real.)

## The relay: deployed to Render (free tier)

The relay (`relay/server.ts`) needs a long-lived process (Vercel functions
can't hold a WebSocket open — PRD §11/§14), so it lives on Render as its
own Web Service instead. Render's free Web Service tier was picked over
Fly.io specifically because it needs no card on file; the tradeoff is the
free instance spins down after ~15 min idle, so a visitor's first
connection after a quiet period eats a cold-start delay (usually well
under a minute) before `session.ready` comes back.

**One-time setup** (render.com dashboard):

1. New → Blueprint → connect this GitHub repo. Render reads `render.yaml`
   at the repo root and provisions the service (`ai-voice-mock-interviewer-relay`,
   free plan, `npm run relay:start`) automatically.
2. Add `GEMINI_API_KEY` in the service's Environment tab — it's marked
   `sync: false` in `render.yaml` on purpose, so Render always prompts for
   it rather than expecting it committed anywhere.
3. Once live, copy the assigned URL (`https://<service>.onrender.com`),
   swap the scheme to `wss://`, and set that as `NEXT_PUBLIC_RELAY_URL` in
   Vercel (Production **and** Preview, if you want previews to have working
   voice mode) — then redeploy the Next.js app so the new env var takes
   effect (env vars are baked in at build time for `NEXT_PUBLIC_*`).

`relay:start` (`tsx relay/server.ts`, no `--watch`/`--env-file` — Render
injects env vars directly) is the production counterpart to
`relay:dev` (which is still what you run locally). The server binds
whatever port Render assigns via its `PORT` env var (see `relay/server.ts`).

**Local dev is unaffected:** `NEXT_PUBLIC_RELAY_URL` still defaults to
`ws://localhost:8787` when unset, so `npm run relay:dev` + `npm run dev`
continues to work exactly as before — you only need the Render deployment
if you want *other people* to reach voice mode without running the relay
themselves.

If the relay isn't reachable (wrong URL, service still cold-starting, or
not deployed at all), voice session connection will fail/hang at
"connecting" in the UI.

## Known limitation: Gemini free-tier quota

The free tier is capped at a low daily request count and occasionally
returns transient `503 UNAVAILABLE` ("high demand") errors independent of
quota. `GeminiTextLLM` (`lib/llm/gemini-text-llm.ts`) retries a 503 up to 3
times with a short backoff, but a `429 RESOURCE_EXHAUSTED` (quota fully
used for the day) is not retryable — you'll see an error banner on
`/interview` and need to wait for the daily reset or move to a paid tier.
Each real interview prep session uses 2 calls (`/api/questions` +
`/api/score`), so the free tier covers roughly 10 sessions/day — and now
that the relay is deployed for anyone to try, that quota is shared across
every visitor, not just one person. See "Roadmap" below.

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

Next.js app:

```bash
vercel deploy --prod
```

(or push to a branch for a preview deployment, per the linked Vercel
project). `/api/questions` and `/api/score` need `GEMINI_API_KEY` and
`TEXT_PROVIDER` set as Vercel env vars for Production (and Preview, if you
want previews to work too) — see `vercel env ls` / `vercel env add`.

Relay: Render redeploys automatically on every push to `main` (default
Blueprint behavior) — no separate command needed. Trigger one manually from
the service's dashboard (Manual Deploy → Deploy latest commit) if you need
to force a restart without a new commit.

## Roadmap (not yet built)

Follow-ups from opening the relay up to more than one user, tracked in
`ISSUES.md`:

- **Bring-your-own Gemini key**: let a visitor paste their own
  `GEMINI_API_KEY` (kept client-side, sent per-request) instead of sharing
  the deployed one — so one person's usage doesn't burn through everyone's
  shared free-tier quota. Touches `getApiKey()` in both
  `lib/llm/gemini-text-llm.ts` and `relay/adapters/gemini-voice-adapter.ts`,
  plus `/api/questions`, `/api/score`, and the relay's `session.start`
  message.
- **Quota display in the UI**: Gemini's API has no live "remaining quota"
  endpoint to query, so this means tracking our own request count (reset
  daily) somewhere that survives Vercel's stateless functions — e.g. a
  free Upstash Redis or Vercel KV instance — and rendering it, not
  reflecting Google's actual account state.
- **Additional voice adapters** (e.g. OpenAI Realtime) alongside
  `GeminiVoiceAdapter`, so a visitor isn't limited to Gemini's free-tier
  quota specifically — a different `VOICE_PROVIDER` means a different
  quota pool entirely. The `VoiceAdapter` seam (`relay/voice-adapter.ts`)
  already exists for exactly this; see `docs/providers.md`'s step-by-step
  guide for what a new adapter file needs to implement.
