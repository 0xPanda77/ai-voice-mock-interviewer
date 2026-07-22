#!/usr/bin/env bash
# Runs the /voice E2E test against the REAL Gemini Live adapter
# (VOICE_PROVIDER=gemini, requires GEMINI_API_KEY in .env). Costs real API
# usage (PRD §10) — the spec keeps the session open only a few seconds
# before ending it. Use run-stub.sh for routine/cheap verification; use
# this only when you need to prove the fix holds against the real upstream.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."

if [ ! -f .env ] || ! grep -q "^GEMINI_API_KEY=.\+" .env; then
  echo "[run-gemini] GEMINI_API_KEY not found in .env — aborting." >&2
  exit 1
fi

RELAY_PORT="${RELAY_PORT:-8787}"
APP_PORT="${APP_PORT:-3000}"

echo "[run-gemini] starting relay (VOICE_PROVIDER=gemini) on port $RELAY_PORT..."
VOICE_PROVIDER=gemini RELAY_PORT="$RELAY_PORT" npx tsx --env-file=.env relay/server.ts &
RELAY_PID=$!

echo "[run-gemini] starting Next.js dev server on port $APP_PORT..."
NEXT_PUBLIC_RELAY_URL="ws://localhost:$RELAY_PORT" npx next dev -p "$APP_PORT" &
APP_PID=$!

cleanup() {
  echo "[run-gemini] cleaning up (killing relay pid $RELAY_PID, app pid $APP_PID)..."
  kill "$RELAY_PID" 2>/dev/null || true
  kill "$APP_PID" 2>/dev/null || true
  wait "$RELAY_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "[run-gemini] waiting for relay to accept connections..."
npx wait-on -t 20000 "tcp:localhost:$RELAY_PORT"

echo "[run-gemini] waiting for Next.js dev server to respond..."
npx wait-on -t 60000 "http://localhost:$APP_PORT/voice"

echo "[run-gemini] running Playwright spec (real Gemini Live — short session)..."
E2E_VOICE_PROVIDER=gemini npx playwright test app/interview/e2e/voice-page.spec.ts
