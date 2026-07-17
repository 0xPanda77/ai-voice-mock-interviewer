# AI Voice Mock Interviewer

Paste a job description, get role-specific interview questions, then run a
real-time, full-duplex **voice** mock interview for that exact role — answer
out loud, get spoken follow-ups, no backspace, no time to edit. At the end,
get a score, tier, and short feedback comments on the transcript.

Live demo (text-loop): **https://ai-flagship-project.vercel.app**
(voice mode needs the relay running locally — see below)

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
- Browser `localStorage` only — no accounts, no database (single-user
  personal tool, by design)

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

Open `http://localhost:3000/voice`. Voice mode always needs the relay
running locally, even against a deployed URL — the browser connects to
`ws://localhost:8787` on its own machine, so the relay and the browser tab
must be on the same machine. This is a deliberate single-user tradeoff, not
a bug (see `docs/deploy.md`).

The Gemini free tier covers roughly 10 interview-prep sessions/day (2 LLM
calls per session). A `429` after that means the daily quota reset hasn't
happened yet.

## Provider architecture

Both the text LLM and the voice engine sit behind an interface, selected by
an env var (`TEXT_PROVIDER`, `VOICE_PROVIDER`) and a factory — never
imported directly by callers. Today only Gemini is implemented for either
seam. Adding a new provider means writing one adapter file and registering
it in one switch statement; see `docs/providers.md` for the exact seam and
a step-by-step guide.

**Planned:** more voice adapters beyond Gemini Live (e.g. OpenAI Realtime),
so the voice engine can be swapped per cost/latency/quality without
touching the browser client or relay protocol.

## Project docs

- `PRD.md` — full v1 product spec
- `docs/deploy.md` — what's deployed, what isn't (and why), known limits
- `docs/providers.md` — provider-swap guide
- `ISSUES.md` — milestone breakdown
