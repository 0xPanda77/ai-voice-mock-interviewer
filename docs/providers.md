# Provider swap guide

The app promises the AI provider can be changed at any time (PRD §8, §9). This
doc makes that concrete: what the env flags do, and exactly how to add a new
provider for either seam.

**Design rule (PRD §8b), stated plainly:** if adding a provider requires
touching anything outside its one adapter file, the abstraction has leaked —
fix the seam, not the callers.

## The two seams

| Seam | Interface | Env flag | Read in | Factory |
|---|---|---|---|---|
| Text LLM (question gen + scoring) | `TextLLM` (`lib/llm/text-llm.ts`) | `TEXT_PROVIDER` | `lib/config.ts` | `getTextLLM()` in `lib/llm/text-llm.ts` |
| Voice engine (realtime speech-to-speech) | `VoiceAdapter` (`relay/voice-adapter.ts`) | `VOICE_PROVIDER` | `lib/config.ts` | `createVoiceAdapter()` in `relay/voice-adapter.ts` |

Both flags default to `"gemini"` if unset (see `lib/config.ts`).

### Valid values today

- `TEXT_PROVIDER`: `gemini` (only option implemented; anything else throws
  `Unknown TEXT_PROVIDER` from `getTextLLM()`).
- `VOICE_PROVIDER`: `gemini` (real product option) or `stub` (test-only fake
  upstream used by `npm run relay:test:smoke` / the Playwright e2e stub run —
  not a real product provider, just reachable if you explicitly set
  `VOICE_PROVIDER=stub`). Anything else throws `Unknown VOICE_PROVIDER` from
  `createVoiceAdapter()`.

Callers never import a concrete adapter directly — API routes call
`getTextLLM()`, and the relay server calls `createVoiceAdapter()`. Both
factories dynamic-`import()` the concrete adapter only for the selected
provider, so a module graph that never selects `gemini` never pulls in the
Gemini SDK.

## How to add a new text provider

1. Implement `TextLLM` (`lib/llm/text-llm.ts`) in a new file, e.g.
   `lib/llm/claude-text-llm.ts`:
   ```ts
   import type { TextLLM } from "./text-llm";

   export class ClaudeTextLLM implements TextLLM {
     async generateQuestions(jd: string) { /* ... */ }
     async scoreTranscript(transcript, jd) { /* ... */ }
   }
   ```
   All vendor SDK imports (e.g. `@anthropic-ai/sdk`) live only in this file.
2. Register it in the `getTextLLM()` switch in `lib/llm/text-llm.ts`:
   ```ts
   case "claude": {
     const { ClaudeTextLLM } = await import("@/lib/llm/claude-text-llm");
     cached = new ClaudeTextLLM();
     return cached;
   }
   ```
3. Set `TEXT_PROVIDER=claude` in the environment.

Done — no changes to `app/api/questions/route.ts`, `app/api/score/route.ts`,
or any other caller.

## How to add a new voice provider

1. Implement `VoiceAdapter` (`relay/voice-adapter.ts`) in a new file, e.g.
   `relay/adapters/openai-realtime-adapter.ts`:
   ```ts
   import type { VoiceAdapter, VoiceAdapterConfig } from "../voice-adapter";
   import type { RelayEvent } from "../protocol";

   export class OpenAIRealtimeAdapter implements VoiceAdapter {
     async connect(config: VoiceAdapterConfig) { /* ... */ }
     sendAudio(frame: ArrayBuffer) { /* ... */ }
     onEvent(cb: (e: RelayEvent) => void) { /* ... */ }
     close() { /* ... */ }
   }
   ```
   All vendor SDK imports live only in this file — translate the vendor's
   wire format into the normalized `RelayEvent` protocol (PRD §8b) here.
2. Register it in the `createVoiceAdapter()` switch in `relay/voice-adapter.ts`:
   ```ts
   case "openai-realtime": {
     const { OpenAIRealtimeAdapter } = await import(
       "./adapters/openai-realtime-adapter"
     );
     return new OpenAIRealtimeAdapter();
   }
   ```
3. Set `VOICE_PROVIDER=openai-realtime` in the environment.

Done — no changes to `relay/server.ts`, the browser client
(`app/voice/lib/relay-client.ts`), or any other caller.

## Sanity-check: no vendor SDK leaks (verified 2026-07-13)

Grepped the whole repo for `@google/genai` and any `gemini` reference outside
the two adapter files (`lib/llm/gemini-text-llm.ts`,
`relay/adapters/gemini-voice-adapter.ts`). Result: clean.

- `@google/genai` is imported only in those two files.
- Every other hit (`lib/config.ts`, `lib/llm/text-llm.ts`,
  `relay/voice-adapter.ts`, `relay/protocol.ts`,
  `app/voice/lib/audio-playback.ts`, `playwright.config.ts`,
  `relay/test/gemini-live-smoke.ts`, `app/voice/e2e/voice-page.spec.ts`) is
  either a comment/doc reference, the string literal `"gemini"` as an env var
  value, or a test file that imports only `ws` + the relay server + the
  normalized protocol types — never the vendor SDK directly.
