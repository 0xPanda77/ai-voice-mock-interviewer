# AI Voice Mock Interviewer

Paste a job description, get role-specific interview questions, then run a
real-time, full-duplex **voice** mock interview for that exact role — answer
out loud, get spoken follow-ups, no backspace, no time to edit. At the end,
get a score, tier, and short feedback comments on the transcript.

Live demo: **https://ai-voice-mock-interviewer.vercel.app/interview**
(runs on a shared free-tier Gemini key — if it's out of daily quota, wait
for the reset or [run it locally](#running-locally) with your own key)

## Why voice, not another chat-based mock interviewer

A text chatbox rehearses *content*. It can't rehearse *performance under
pressure* — which is the actually hard part of interviewing. This runs a
native speech-to-speech session (no separate STT/TTS pipeline), so the
model handles turn-taking and interruption the way a real interviewer does.

## How it works

```
Browser (Next.js)  ──WS──►  Relay server (Node)  ──provider WS──►  Voice model
   mic + speaker      normalized     per-provider adapter        (speech↔speech)
   localStorage        protocol
        │
        └── HTTP ──► /api/questions  (text LLM: JD → questions)
        └── HTTP ──► /api/score      (text LLM: transcript → score)
```

The browser never holds a provider API key — all provider traffic goes
through the relay / Next.js API routes. The relay speaks one normalized
protocol to the browser and translates to/from the upstream voice provider
behind an adapter (see [Provider architecture](#provider-architecture)
below).

## Tech stack

- Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS
- A standalone Node WebSocket relay for the realtime voice stream
- Gemini Live (native audio, speech-to-speech) for voice; Gemini for
  question generation + scoring
- Browser `localStorage` only — no accounts, no database

## Running locally

Requires Node 20+.

```bash
git clone https://github.com/0xPanda77/ai-voice-mock-interviewer.git
cd ai-voice-mock-interviewer
npm install
cp .env.example .env
```

Edit `.env` and add your own Gemini API key (free at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey)):

```
GEMINI_API_KEY=your-key-here
```

Then start both processes, in two terminals:

```bash
npm run dev        # Next.js app — http://localhost:3000
npm run relay:dev   # WS relay — required for voice mode, http://localhost:8787
```

Open `http://localhost:3000/interview`. `NEXT_PUBLIC_RELAY_URL` defaults to
`ws://localhost:8787`, so as long as `relay:dev` is running locally, voice
mode works against your own key — independent of whatever relay the
deployed site happens to be using.

The Gemini free tier covers roughly 10 interview-prep sessions/day (2 LLM
calls per session). A `429` after that means the daily quota reset hasn't
happened yet.

## Deploy your own

Everything here is free-tier: Vercel (frontend + API routes) and Render
(the WS relay). Full details, including the known cold-start/quota
tradeoffs, are in `docs/deploy.md` — short version:

1. **Frontend + API routes → Vercel.** Import the repo at
   [vercel.com/new](https://vercel.com/new), set `GEMINI_API_KEY` and
   `TEXT_PROVIDER=gemini` as env vars, deploy.
2. **Relay → Render.** In the Render dashboard: New → Blueprint → connect
   this repo. `render.yaml` at the repo root defines the service
   (`ai-voice-mock-interviewer-relay`, free plan) — Render provisions it
   automatically. Add `GEMINI_API_KEY` in the service's Environment tab
   (it's deliberately left out of `render.yaml` so it's never asked to be
   committed anywhere).
3. **Wire them together.** Copy the Render service's URL, swap `https://`
   for `wss://`, and set it as `NEXT_PUBLIC_RELAY_URL` in Vercel — then
   redeploy the frontend (`NEXT_PUBLIC_*` vars are baked in at build time).

Render's free tier spins the relay down after ~15 min idle, so the first
voice-mode connection after a quiet spell has a cold-start delay before it
connects — that's expected, not broken.

## Provider architecture

Both the text LLM and the voice engine sit behind an interface, selected by
an env var (`TEXT_PROVIDER`, `VOICE_PROVIDER`) and a factory — never
imported directly by callers. Today only Gemini is implemented for either
seam. Adding a new provider means writing one adapter file and registering
it in one switch statement; see `docs/providers.md` for the exact seam and
a step-by-step guide.

## Roadmap

Now that the relay is deployed for anyone to try, the shared free-tier
Gemini quota is the bottleneck. Not built yet, tracked in `ISSUES.md`:

- Bring-your-own Gemini key, so a visitor's usage doesn't eat into
  everyone else's quota.
- A UI display of remaining daily request budget (backed by our own
  tracked counter — Gemini doesn't expose live quota via its API).
- More voice adapters beyond Gemini Live (e.g. OpenAI Realtime), so the
  voice engine can be swapped per cost/latency/quality — and so a visitor
  isn't stuck on Gemini's quota specifically. The seam for this already
  exists (`VoiceAdapter`, see `docs/providers.md`); it's one new adapter
  file away, not an architecture change.

## Project docs

- `PRD.md` — full v1 product spec
- `docs/deploy.md` — what's deployed, what isn't (and why), known limits
- `docs/providers.md` — provider-swap guide
- `ISSUES.md` — milestone breakdown
