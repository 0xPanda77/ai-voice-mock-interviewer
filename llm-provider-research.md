# Text-LLM provider research — free tier, structured output, recommendation

> Research note for PRD.md §8a/§9 (`TextLLM` seam). Triggered by: no API key
> configured yet for `/api/questions` / `/api/score`, blocking end-to-end
> testing. Researched 2026-07-12 against primary sources only (official
> pricing/docs pages). Where a live dashboard number couldn't be pulled
> without auth, that's flagged explicitly — not blended silently with
> secondary sources.

## Comparison table

| Provider | Genuine free tier? | Free-tier limits (best available) | Structured JSON output (native) | SDK / notes |
|---|---|---|---|---|
| **Google Gemini** (`gemini-2.5-flash`) | **Yes** — ongoing, no expiry. Pricing page marks Free Tier input/output as "Free of charge" as a distinct row next to Paid Tier, not a trial credit.[[1]](https://ai.google.dev/gemini-api/docs/pricing) | Free tier is a real "usage tier" (vs. Tier 1/2/3), qualification = "Active project or free trial", spend cap N/A.[[2]](https://ai.google.dev/gemini-api/docs/rate-limits) Google no longer publishes a static free-tier RPM/TPM/RPD table on the docs page — it now says "view your active rate limits in AI Studio" (requires login, view-source didn't yield a table).[[2]](https://ai.google.dev/gemini-api/docs/rate-limits) Best corroborated current ballpark (secondary sources, Dec 2025 quota cut noted): **~10–15 RPM, ~250K TPM, ~250–1,500 RPD** for 2.5 Flash — order-of-magnitude figure, not primary-source-confirmed exactly. | **Yes, GA.** `responseMimeType: "application/json"` + `responseSchema` (JSON-Schema subset: object/array/string/number/enum/required/etc.), documented as generally available.[[3]](https://ai.google.dev/gemini-api/docs/structured-output) This is exactly what `lib/llm/gemini-text-llm.ts` already uses. | `@google/genai` v2.11.0 installed in repo; reached GA May 2025, actively maintained (published within days at research time).[[4]](https://www.npmjs.com/package/@google/genai) Caveat: free-tier content **is used to improve Google's products** ("Used to improve our products: Yes"); paid tier is not.[[1]](https://ai.google.dev/gemini-api/docs/pricing) |
| **OpenAI API** | **No.** Pay-as-you-go from the first token. Pricing docs show only Standard/Batch/Flex/Priority paid tiers, no free-usage line.[[5]](https://developers.openai.com/api/docs/pricing) The "Free" row in the rate-limits/usage-tier table is a **rate-limit bucket label**, not free tokens — it shares the identical "$100/month" ceiling with Tier 1 (which requires a $5 payment), i.e. "Free" just means "haven't paid yet," not "free usage."[[6]](https://developers.openai.com/api/docs/guides/rate-limits) Signup credits for new accounts were discontinued mid-2025. | N/A (no free token allowance) | Yes — OpenAI's Structured Outputs (`response_format: json_schema`, strict mode) is GA and well documented, but irrelevant here since there's no free tier to use it on. | Mature SDK, but moot given no free tier. |
| **Anthropic Claude API** | **No — paid-only, one-time signup credit.** Anthropic's own pricing FAQ states directly: *"Are there free tiers or trials? New users receive a small amount of free credits to test the API."*[[7]](https://platform.claude.com/docs/en/about-claude/pricing) Usage tiers are Start/Build/Scale/Custom, each with a **monthly spend cap** (Start = $500), not a free-token allowance — you're billed per token from the first request once the initial small credit runs out.[[8]](https://platform.claude.com/docs/en/api/rate-limits) | N/A (small one-time trial credit, then pay-as-you-go; Start tier still gives generous RPM/ITPM/OTPM, e.g. Haiku 4.5 at 1,000 RPM / 2M ITPM / 400K OTPM — but that's paid usage, not free) | Yes — native structured output support (tool-use-based JSON schema enforcement), mature and documented. | Would work well technically; disqualified here only by "no ongoing free tier," which is the priority filter for this decision. |
| **Groq** (bonus) | Yes — genuine free "Free Plan."[[9]](https://console.groq.com/docs/rate-limits) | e.g. `llama-3.3-70b-versatile`: 30 RPM, 1K RPD, 12K TPM, 100K TPD.[[9]](https://console.groq.com/docs/rate-limits) Comfortably covers this use case's volume too. | Yes, documented structured-outputs support. | Not Gemini/OpenAI/Claude-caliber models for this task (Llama/Kimi/etc. on Groq), and would mean maintaining a second provider adapter for no clear benefit over Gemini's free tier. Noted as a fallback option only. |

## Token-math check: does Gemini's free tier cover the actual workload?

Per session: 1× `/api/questions` call (JD input, few hundred–few thousand words ≈ up to ~4,000 tokens in, ~300–500 tokens out) + 1× `/api/score` call (transcript up to ~5,000 words ≈ ~6,500 tokens, plus JD re-sent as context ≈ ~4,000 tokens, ~150 tokens out). Generous per-session estimate: **2 requests, ≈16,000 tokens total.**

At "a handful of sessions/day" (say 5): **~10 requests/day, ~80,000 tokens/day**, spread over the day (sessions are minutes apart at minimum, not sub-minute), so RPM is never remotely stressed.

Against even the most conservative end of the corroborated free-tier ballpark for `gemini-2.5-flash` (10 RPM / 250K TPM / 250 RPD): 10 req/day is 4% of a 250 RPD cap, and a single request's ~8K–10K tokens is ~4% of a 250K TPM cap. **This workload sits roughly 1–2 orders of magnitude below every free-tier dimension** — there's no scenario in normal personal use where this hits a Gemini free-tier wall.

## Recommendation

**Stick with Gemini (`gemini-2.5-flash`) as currently configured — just get a `GEMINI_API_KEY` from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and unblock testing.** Reasoning:

1. **It's the only one of the three priority providers with a genuine ongoing free tier.** OpenAI is pay-as-you-go from token one (the "Free" tier label is a pre-payment rate-limit bucket, not free usage). Anthropic gives a small one-time trial credit, then bills per token — confirmed directly from Anthropic's own pricing FAQ. Gemini is the only one where "free" means free indefinitely, not "free until the trial credit runs out."
2. **Structured output support is confirmed GA and already correctly wired.** `responseMimeType`/`responseSchema` is documented as generally available, and `lib/llm/gemini-text-llm.ts` already uses it correctly for both the questions and score schemas — no rework needed.
3. **The math isn't close.** Even using the most conservative current free-tier numbers found (10 RPM / 250K TPM / 250 RPD), this app's actual load (~10 requests/day, ~16K tokens/session) uses single-digit percentages of every limit. There's real headroom for heavier testing days too.
4. **SDK is in good shape.** `@google/genai` (already the dependency in `package.json`, v2.11.0) is the current, GA, actively-maintained SDK — not the deprecated `@google/generative-ai` package. Nothing to migrate.
5. **One thing to fix, unrelated to provider choice:** `.env.example` and PRD §9 reference `gemini-2.5-flash` (good, still current) but the voice-provider seam's sibling model `gemini-2.0-flash` **was deprecated and shut down on June 1, 2026**, per Google's own pricing page warning.[[10]](https://ai.google.dev/gemini-api/docs/pricing#gemini-2.0-flash) Confirm nothing in the voice adapter or fallback paths still targets `gemini-2.0-flash` — the text seam here targets `gemini-2.5-flash`, which is unaffected, but this is worth a grep before shipping.
6. Only reason to reconsider: Google no longer publishes exact free-tier RPM/TPM/RPD numbers in static docs (moved to an authenticated AI Studio dashboard), so there's some ambiguity in the precise ceiling. Given the workload is 1–2 orders of magnitude under even the most conservative reported numbers, this ambiguity doesn't change the recommendation — but if quotas ever do get hit in practice, Groq is a credible zero-cost fallback (genuine free tier, structured outputs supported) without needing to reach for a paid provider.

## Sources

1. [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing) — free/paid tier pricing tables, "Used to improve our products" caveat, `gemini-2.5-flash` and `gemini-2.0-flash` pricing blocks.
2. [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) — usage tier definitions (Free/Tier 1/2/3), qualification criteria, note that per-model RPM/TPM/RPD now lives only in the AI Studio dashboard.
3. [Gemini API structured output docs](https://ai.google.dev/gemini-api/docs/structured-output) — `responseMimeType`/`responseSchema` GA confirmation, supported JSON-Schema subset.
4. [`@google/genai` on npm](https://www.npmjs.com/package/@google/genai) — current version, GA/maintenance status.
5. [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) — no free-tier line; Standard/Batch/Flex/Priority only.
6. [OpenAI API rate limits](https://developers.openai.com/api/docs/guides/rate-limits) — usage tier table showing "Free" = pre-payment bucket sharing Tier 1's $100/month ceiling.
7. [Claude API pricing FAQ](https://platform.claude.com/docs/en/about-claude/pricing) — "Are there free tiers or trials? New users receive a small amount of free credits to test the API."
8. [Claude API rate limits](https://platform.claude.com/docs/en/api/rate-limits) — Start/Build/Scale/Custom tiers, monthly spend caps, no free tier.
9. [Groq rate limits](https://console.groq.com/docs/rate-limits) — Free Plan RPM/RPD/TPM/TPD figures.
10. [Gemini Developer API pricing — 2.0 Flash deprecation warning](https://ai.google.dev/gemini-api/docs/pricing#gemini-2.0-flash) — "Gemini 2.0 Flash is deprecated and has been shut down June 1, 2026."
