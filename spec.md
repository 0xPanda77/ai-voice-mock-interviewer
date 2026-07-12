# AI Voice Mock Interviewer — Build Spec (v1)

> Working codename: **Grill** (placeholder — naming is a v2 concern, do not rabbit-hole).
> Decisions locked in `idea.md`. This doc turns them into a build. Read `llm-collaboration-rules.md`
> alongside: the goal is *shipped and used by one person (me)*, not *good*.

---

## 1. What it is (one screen)

Paste a job description → the browser conducts a spoken, turn-based mock interview for that
exact role → at the end it gives a score, a tier, and 3 comments. User #1 is me, prepping for
my own dev interviews this week.

**Why it beats a Claude chat window:** real-time *voice under pressure* (answer out loud, get
probed, no backspace) + role-specific questions generated from the JD. The chatbox rehearses
content; this rehearses performance.

---

## 2. Core user flow

1. **Landing:** one textarea ("Paste the job description"), one "Start interview" button.
2. **Setup (1 LLM call):** JD → 6 role-specific interview questions.
3. **Interview loop (turn-based):**
   - App **speaks** the current question (Web Speech `SpeechSynthesis`).
   - User taps **"Answer"**, speaks; browser transcribes (`SpeechRecognition`).
   - User taps **"Done"**. Transcript appended to the conversation.
   - App decides next turn (1 LLM call): either a **follow-up probe** on a weak/short answer,
     or move to the next question. Hard cap ~8 turns total so it always ends.
4. **Feedback (1 LLM call):** full transcript → `{ score: 0–100, tier, comments: [3] }`,
   rendered on screen. Tiers: `Strong Hire | Hire | Lean No Hire | No Hire`.
5. **Done.** "Run again" resets. No save, no account, no history (that's v2).

---

## 3. Stack (all things I already know / already deploy)

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js (App Router)** on **Vercel** | Known stack; free deploy; API route hides the Claude key |
| Language | TypeScript | — |
| Voice | **Browser Web Speech API** (`SpeechRecognition` + `SpeechSynthesis`) | Free, no key, client-side. See §6 |
| LLM | **Claude Haiku 4.5** (`claude-haiku-4-5`) via `@anthropic-ai/sdk` | ~$0.02–0.05/interview; model string is a one-line swap later |
| State | React state / in-memory | v1 has no persistence — nothing to store |
| DB | **None** | No accounts, no memory in v1. Do not add Neon "just in case" |
| Styling | Tailwind + minimal shadcn/ui | Known; keep it plain — polish is v2 |

**No database in v1.** The moment I reach for Neon/pgBoss, I've left the spec. Session state
is React state; it dies on refresh, and that's fine — the success metric is *I used it once*,
not *it remembers*.

---

## 4. Architecture

```
Browser (React client component)                Server (Next.js route handlers)
──────────────────────────────                  ────────────────────────────────
- Web Speech: TTS (speak question)              POST /api/questions   JD → 6 questions
- Web Speech: STT (transcribe answer)           POST /api/turn        transcript → next question | follow-up
- Holds conversation state in React             POST /api/feedback    transcript → {score, tier, comments}
- Renders question / answer / feedback UI
        │                                                 ▲
        └──────────────── fetch (JSON) ───────────────────┘
```

The Claude API key lives **only** in the server route handlers (env var on Vercel).
The browser never sees it. Three thin endpoints, one Anthropic call each.

---

## 5. The three LLM calls (with prompt sketches)

All calls: `model: "claude-haiku-4-5"`, `max_tokens: ~1024`. Use `@anthropic-ai/sdk`.

### 5a. `POST /api/questions` — generate questions
- **In:** `{ jobDescription: string }`
- **Prompt (system):** *"You are a senior technical interviewer. From the job description,
  produce exactly 6 interview questions tailored to this specific role and seniority — a mix
  of technical, system-design, and behavioural. Return them ordered easiest→hardest."*
- **Out:** structured output (`output_config.format`, json_schema) → `{ questions: string[] }`
- Runs once at start.

### 5b. `POST /api/turn` — next question or follow-up
- **In:** `{ questions: string[], transcript: {q, a}[], currentIndex }`
- **Prompt (system):** *"You are conducting a live interview. Given the answer just given,
  either ask ONE short probing follow-up (if the answer was vague, incomplete, or claimed
  something worth testing) or say MOVE_ON. Keep follow-ups to one sentence."*
- **Out:** `{ action: "follow_up" | "move_on", text?: string }`
- Client enforces the ~8-turn hard cap so the interview always terminates.

### 5c. `POST /api/feedback` — final score
- **In:** `{ jobDescription, transcript }`
- **Prompt (system):** *"Score this candidate for THIS role. Return a score 0–100, a tier
  (Strong Hire / Hire / Lean No Hire / No Hire), and exactly 3 specific comments — what was
  strong, what was weak, what to fix. Be concrete; cite what they actually said."*
- **Out:** structured output → `{ score: number, tier: string, comments: string[] }`

> Structured outputs (`output_config.format` with a json_schema) are supported on Haiku 4.5 —
> use it for 5a and 5c so parsing can't fail on stray prose.

---

## 6. Web Speech API — the one real technical risk

- **TTS** (`window.speechSynthesis.speak`) — broadly supported, robotic-ish default voice. Fine.
- **STT** (`window.SpeechRecognition || window.webkitSpeechRecognition`) — **Chrome/Edge only**
  (uses Google's engine, free, no key). **Not in Firefox.** User #1 is me on Chrome → acceptable
  for v1. Show a "use Chrome" note if the API is missing; don't build a fallback.
- Turn-based (push-to-talk) sidesteps the hardest parts (barge-in, echo cancellation, latency).
  Start recognition on "Answer", stop on "Done", read `event.results` transcript.
- **This is the day-1 spike.** If browser STT transcribes my speech well enough to be usable,
  the whole product is viable. If not, everything downstream is wasted — so prove it first (§7, M0).

---

## 7. Build plan (each milestone is done-or-not-done)

- **M0 — Voice spike (TODAY).** Static HTML/React page: browser speaks one hardcoded question,
  I answer aloud, my words print on screen. No JD, no LLM, no styling. *Proves the riskiest unknown.*
- **M1 — Interview loop, hardcoded questions.** 6 hardcoded questions, spoken one by one,
  answers transcribed and stored in state. No LLM yet. Full turn-based loop working end to end.
- **M2 — JD → questions.** Add textarea + `/api/questions`. Real role-specific questions.
- **M3 — Feedback.** Add `/api/feedback`. Score + tier + 3 comments render at the end.
- **M4 — Follow-ups.** Add `/api/turn` probing. (Cut this if M0–M3 already feels useful — it's
  the least essential piece.)
- **M5 — Deploy to Vercel + use it for a real interview prep session.** ← this is "shipped".

**Definition of shipped:** M5 done — deployed, and I used it to prep for an actual interview.

---

## 8. Explicitly OUT of v1 (the v2 parking lot — do not build now)
Persistent weakness memory across sessions · accounts / login · dashboard / history · CV parsing ·
full-duplex interruption · multi-user / sharing · non-Chrome STT fallback · nicer voices (ElevenLabs) ·
model upgrade to Sonnet/Opus · analytics.

---

## 9. Build-in-public hook (anti-abandonment)
Post M0 ("got the browser interviewing me out loud") and M5 ("shipped: an AI that voice-interviews
you for any job — live") on X/LinkedIn. Claim **Founder / Builder — Grill** on LinkedIn covering the gap.

---

## 10. Open technical decisions (small — resolve at build time, not now)
1. Anthropic SDK direct vs Vercel AI SDK — default to `@anthropic-ai/sdk` (simplest for non-streaming).
2. Stream the interviewer's question or not — v1: no, questions are short.
3. Exact turn cap (6 questions + up to 2 follow-ups ≈ 8) — tune while using it.
