#!/usr/bin/env bash
# Runs the /voice E2E test against the relay's StubVoiceAdapter (no real
# Gemini Live call — see relay/adapters/stub-voice-adapter.ts). Proves the
# browser<->relay handshake/protocol works end to end through the actual
# app/voice/page.tsx code path, not a raw WS test script.
#
# Starts relay/server.ts (VOICE_PROVIDER=stub) and `npm run dev` in the
# background, waits for both to be reachable, runs the Playwright spec, then
# kills both regardless of test outcome.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."

RELAY_PORT="${RELAY_PORT:-8787}"
APP_PORT="${APP_PORT:-3000}"

echo "[run-stub] starting relay (VOICE_PROVIDER=stub) on port $RELAY_PORT..."
VOICE_PROVIDER=stub RELAY_PORT="$RELAY_PORT" npx tsx relay/server.ts &
RELAY_PID=$!

echo "[run-stub] starting Next.js dev server on port $APP_PORT..."
NEXT_PUBLIC_RELAY_URL="ws://localhost:$RELAY_PORT" npx next dev -p "$APP_PORT" &
APP_PID=$!

cleanup() {
  echo "[run-stub] cleaning up (killing relay pid $RELAY_PID, app pid $APP_PID)..."
  kill "$RELAY_PID" 2>/dev/null || true
  kill "$APP_PID" 2>/dev/null || true
  wait "$RELAY_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "[run-stub] waiting for relay to accept connections..."
npx wait-on -t 20000 "tcp:localhost:$RELAY_PORT"

echo "[run-stub] waiting for Next.js dev server to respond..."
npx wait-on -t 60000 "http://localhost:$APP_PORT/voice"

echo "[run-stub] running Playwright spec..."
E2E_VOICE_PROVIDER=stub npx playwright test app/voice/e2e/voice-page.spec.ts
