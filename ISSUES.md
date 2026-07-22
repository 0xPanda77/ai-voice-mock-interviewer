# v1 Issues — AI Voice Mock Interviewer

Mirror of the GitHub issues, grouped by milestone. Source of truth for status is
GitHub; this file is the in-repo snapshot.

Repo: https://github.com/0xPanda77/ai-voice-mock-interviewer

**Tracking:** [#13 — v1](https://github.com/0xPanda77/ai-voice-mock-interviewer/issues/13)

## M0 — Scaffold
- [#1](https://github.com/0xPanda77/ai-voice-mock-interviewer/issues/1) Scaffold Next.js 15 app (React 19, TS, Tailwind)

## M1 — Text loop (ships as a standalone demo)
- [#2](https://github.com/0xPanda77/ai-voice-mock-interviewer/issues/2) TextLLM interface + GeminiTextLLM adapter
- [#3](https://github.com/0xPanda77/ai-voice-mock-interviewer/issues/3) `/api/questions` — JD → role-specific questions
- [#4](https://github.com/0xPanda77/ai-voice-mock-interviewer/issues/4) `/api/score` — transcript → score/tier/comments
- [#5](https://github.com/0xPanda77/ai-voice-mock-interviewer/issues/5) Minimal UI — text-only demo

## M2 — Voice relay
- [#6](https://github.com/0xPanda77/ai-voice-mock-interviewer/issues/6) Node WebSocket relay + normalized protocol
- [#7](https://github.com/0xPanda77/ai-voice-mock-interviewer/issues/7) GeminiVoiceAdapter (Gemini Live native audio)
- [#8](https://github.com/0xPanda77/ai-voice-mock-interviewer/issues/8) Decide + provision relay host
- [#9](https://github.com/0xPanda77/ai-voice-mock-interviewer/issues/9) Browser mic capture + AI audio playback + live transcript

## M3 — Wire the loop
- [#10](https://github.com/0xPanda77/ai-voice-mock-interviewer/issues/10) Feed questions into voice session; transcript → scoring

## M4 — Ship
- [#11](https://github.com/0xPanda77/ai-voice-mock-interviewer/issues/11) Single-screen polish + deploy
- [#12](https://github.com/0xPanda77/ai-voice-mock-interviewer/issues/12) Provider-swap docs + env flags (harden abstraction)

## M5 — Multi-user demo hardening (not yet filed as GitHub issues)
Follow-ups from deploying the relay to Render for public use (see
`docs/deploy.md` "Roadmap") — no GitHub issue numbers yet, file them when
picked up:
- Bring-your-own Gemini key: let a visitor supply their own `GEMINI_API_KEY`
  instead of sharing the deployed one.
- Quota display in the UI: show remaining daily request budget, backed by
  our own tracked counter (Gemini has no live quota-query endpoint).
