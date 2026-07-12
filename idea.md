# AI Voice Mock Interviewer — v1 Spec

> Decision locked 2026-07-10. Stop re-litigating *what* to build. Remaining work is
> scoping and shipping, not choosing.

**One line:** Paste a job description → it runs a real-time *voice* mock interview
tailored to that exact role.

**User #1:** Me (Lap Yin), prepping for my own dev interviews this week.

**Why it beats raw Claude (the reason it's a product, not a wrapper):**
Real-time *voice* under pressure — answer out loud, get follow-up probes, no backspace,
no time to edit. That's the actual hard part of interviews. A text chatbox rehearses the
*content*; it cannot rehearse the *performance under pressure*.

## v1 scope — ONE loop, ship in ~3–4 weeks
1. Paste JD
2. It generates role-specific questions from that JD (**the core feature — chosen**)
3. Voice interview, **turn-based / push-to-talk** (decided): it asks aloud → I answer
   aloud → tap done → it asks a follow-up. No mid-answer interruption in v1.
4. End: **score + tier rank + short comments** (decided) — ONE LLM call on the
   transcript. Not a dashboard, not history. Score/tier/3-bullet comments, done.

## Explicitly OUT of v1 (these are v2+, do not build now)
- Persistent cross-session weakness memory
- Accounts / dashboard / analytics
- CV parsing
- Scored written feedback report
- Multi-user / sharing

## Success = done-or-not-done (not "good", not "better than X")
Deployed + I personally use it to prep for a real interview.

## Open decisions (being resolved in the grilling session)
- [x] Turn-based voice vs full-duplex — **turn-based** (full-duplex is v2)
- [x] Feedback at end — **yes: score + tier + short comments**, one LLM call
- [x] Voice stack — **browser Web Speech API** (free, no key) for both
      speech-to-text and text-to-speech. Turn-based fits this perfectly.
- [x] LLM — **Claude Haiku 4.5** (`claude-haiku-4-5`, $1/$5 per 1M). ~$0.02–0.05
      per interview. Swap to Sonnet/Opus later via a one-line model-string change.

## Total v1 cost: free voice + a few dollars of Haiku. The money worry is dead.
