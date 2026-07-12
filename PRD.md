# AI Voice Mock Interviewer — PRD (v1)

> Builds on `idea.md` (decision locked 2026-07-10). This PRD makes the build
> concrete. Two decisions from `idea.md` are **revised** here — see
> [Changes from idea.md](#changes-from-ideamd).

## 1. One line

Paste a job description → run a **real-time, full-duplex voice** mock interview
tailored to that role → get a score, tier, and short comments at the end.

## 2. Success = done-or-not-done

Deployed, and I (Lap Yin) personally use it to prep for a real dev interview.
Not "good", not "better than X". Shipped and used once for real.

## 3. User

User #1 is me, prepping for my own dev interviews. Single-user. No accounts.

## 4. v1 scope — ONE loop

1. **Paste JD** into a textarea.
2. **Generate questions** — one text-LLM call turns the JD into role-specific
   questions + follow-up hints. (The core "it's a product, not a wrapper" bit.)
3. **Live voice interview** — realtime, **full-duplex** (interruptible): it asks
   aloud → I answer aloud → it probes follow-ups. The AI handles turn-taking and
   barge-in natively.
4. **Feedback** — at the end, one text-LLM call on the transcript returns
   **score + tier + 3-bullet comments**. Not a dashboard, not history.

## 5. Explicitly OUT of scope (v2+, do not build)

- Persistent cross-session weakness memory
- Accounts / dashboard / analytics / history
- CV parsing
- Long written feedback report
- Multi-user / sharing
- Any database (localStorage only in v1)

## 6. Changes from `idea.md`

Two locked decisions are revised, both to serve "smooth + cheap + low effort":

| Decision | idea.md | PRD (this doc) | Why |
|---|---|---|---|
| Voice stack | Browser Web Speech API | **Realtime native-audio speech-to-speech** (default: Gemini Live) | Web Speech is free but not smooth (robotic, Safari-flaky). Native audio is the "continuous connection" feel, at ~$0.50–$1.50/interview. |
| Interaction | Turn-based / push-to-talk | **Full-duplex (interruptible)** | The native-audio model does turn-taking + barge-in itself; more realistic and *less* code than building push-to-talk. |

Unchanged: single loop, one-call feedback (score/tier/3 bullets), no history, User #1 = me.

## 7. Architecture

```
Browser (Next.js)  ──WS──►  Relay server (Node)  ──provider WS──►  Voice model
   mic + speaker      normalized     per-provider adapter        (speech↔speech)
   localStorage        protocol
        │
        └── HTTP ──► /api/questions  (text LLM: JD → questions)
        └── HTTP ──► /api/score      (text LLM: transcript → score)
```

- The browser **never** holds a provider API key. All provider traffic goes
  through our relay / API routes.
- The relay speaks **one normalized protocol** to the browser and swaps the
  upstream provider behind an adapter — this is the swappable seam (§8).

## 8. Provider abstraction — SWAPPABLE BY DESIGN

**Requirement:** the AI provider can be changed at any time if we find something
cheaper. App code depends on interfaces, never on a vendor SDK directly.

Two seams:

### 8a. Text LLM (question generation + scoring)

```ts
interface TextLLM {
  generateQuestions(jd: string): Promise<Question[]>;
  scoreTranscript(transcript: Turn[], jd: string): Promise<Feedback>;
}
```

- Adapters: `GeminiTextLLM` (default), later `ClaudeTextLLM`, `OpenAITextLLM`, …
- Selected by `TEXT_PROVIDER` env var. Swapping = write one adapter + flip env.

### 8b. Voice engine (realtime speech-to-speech)

The browser talks to **our relay's normalized WS protocol**, so the browser code
is provider-agnostic. Each provider gets a relay-side adapter that translates.

**Normalized relay protocol**
- Client → relay: `session.start { questions, jdContext }`, `audio.chunk` (mic),
  `session.end`
- Relay → client: `session.ready`, `audio.chunk` (AI voice), `transcript.delta
  { speaker, text }`, `turn.start` / `turn.end`, `error`

```ts
interface VoiceAdapter {
  connect(config: { systemPrompt: string; voice: string }): Promise<void>;
  sendAudio(frame: ArrayBuffer): void;
  onEvent(cb: (e: RelayEvent) => void): void;   // audio out, transcript, turns
  close(): void;
}
```

- Adapters: `GeminiVoiceAdapter` (default, WebSocket), later
  `OpenAIRealtimeAdapter` (WebRTC/WS), … Selected by `VOICE_PROVIDER` env var.
- **Design rule:** if adding a cheaper provider forces a change outside its
  adapter file, the abstraction leaked — fix the seam, not the callers.

## 9. Default provider (today's cheapest smooth option)

Pinned in config, changeable anytime per §8. Chosen because it's proven (someone
shipped this exact stack) and cheapest for smooth realtime now.

- **Voice:** `gemini-2.5-flash-native-audio-preview` (Gemini Live, WebSocket).
- **Text:** `gemini-2.5-flash` (question-gen + scoring; free tier during dev).
- Voice config: a single prebuilt voice (e.g. `Puck`).

> ⚠️ Preview model — restrictive rate limits, may change. Fine for a personal
> tool; revisit before any real reliance.

## 10. Cost model

- Voice (native audio, paid): audio in **$3/1M tok**, out **$12/1M tok**;
  ~32 tok/sec. A 15-min interview ≈ **$0.50–$1.50** once Live API per-turn
  context re-billing is counted. **Keep sessions short** — the 15-min cap bounds
  this; don't run hour-long interviews.
- Text (Flash): free tier covers dev; pennies paid.
- **Per interview ≈ $0.50–$1.50. A dozen practice runs < ~$15, likely < $10.**

## 11. Tech stack

- Frontend: **Next.js 15 (App Router), React 19, TypeScript, Tailwind**.
- Backend: Next.js API routes for text calls + a thin **Node WebSocket relay**
  for the voice stream.
- Storage: **browser localStorage** (transcript + last feedback). No DB.
- Deploy: Vercel for the app; the WS relay needs a long-lived socket host
  (Cloud Run / Fly / Railway) — Vercel functions don't hold raw WS well.
  Confirm relay hosting in Milestone 2.

## 12. Data shapes

```ts
type Question = { text: string; followupHints?: string[] };
type Turn     = { speaker: "ai" | "me"; text: string; ts: number };
type Feedback = { score: number; tier: string; comments: string[] };  // 3 bullets
```

Session state (JD, questions, transcript, feedback) lives in localStorage keyed
by a session id. No server persistence in v1.

## 13. Build plan (milestones)

1. **Text loop, no voice** — paste JD → `/api/questions` → render questions;
   paste a fake transcript → `/api/score` → render feedback. Proves the
   `TextLLM` seam end to end. *(Ship-able as a text-only demo.)*
2. **Voice relay** — Node WS relay + `GeminiVoiceAdapter`; browser mic in / AI
   audio out with the normalized protocol; live transcript captured. Decide relay
   host here.
3. **Wire the loop** — feed generated questions into the voice session's system
   prompt; on `session.end`, pass the captured transcript to `/api/score`.
4. **Polish + deploy** — one screen, start/stop, show feedback, deploy. Use it
   for a real interview → success.

## 14. Risks

- **Preview model volatility** — rate limits / API changes. Mitigated by the
  swappable provider seam (§8).
- **WS relay + serverless** — long-lived sockets don't fit Vercel functions;
  needs a socket-friendly host. Decided in Milestone 2.
- **Latency on cold start** — scale-to-zero hosts give a slow first connect.
  Acceptable for personal use.
- **Cost surprise from context re-billing** — capped by short sessions (§10).

## 15. Open questions

- Relay host: Cloud Run vs Fly vs Railway (decide in M2).
- Voice interview length cap — 15 min hard stop? (bounds cost + fits prep).
- Scoring rubric — fixed dimensions (communication, depth, structure) or freeform
  in the score call? (decide when building M1 `/api/score`).
