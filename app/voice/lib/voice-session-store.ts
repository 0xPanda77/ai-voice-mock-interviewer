// Voice-session persistence for the /voice demo surface (issue #9).
// Reuses the lib/session-store.ts pattern from M1 (localStorage, keyed by a
// session id) but under its own storage prefix — this is a deliberately
// SEPARATE surface from the M1 text-loop session (see app/page.tsx), not
// wired together yet. Wiring the two together is M3's job (issue #10).

import type { Turn } from "@/lib/types";

export type VoiceSession = {
  id: string;
  jd: string;
  transcript: Turn[];
  updatedAt: number;
};

const STORAGE_PREFIX = "ai-mock-interviewer:voice-session:";
const CURRENT_SESSION_KEY = "ai-mock-interviewer:voice-current-session-id";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function createVoiceSessionId(): string {
  if (isBrowser() && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `voice-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function emptyVoiceSession(id: string): VoiceSession {
  return { id, jd: "", transcript: [], updatedAt: Date.now() };
}

export function loadVoiceSession(id: string): VoiceSession | null {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VoiceSession;
  } catch {
    return null;
  }
}

export function saveVoiceSession(session: VoiceSession): void {
  if (!isBrowser()) return;
  const toSave: VoiceSession = { ...session, updatedAt: Date.now() };
  window.localStorage.setItem(
    STORAGE_PREFIX + session.id,
    JSON.stringify(toSave)
  );
  window.localStorage.setItem(CURRENT_SESSION_KEY, session.id);
}

export function getCurrentVoiceSessionId(): string | null {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(CURRENT_SESSION_KEY);
}

export function loadOrCreateCurrentVoiceSession(): VoiceSession {
  const existingId = getCurrentVoiceSessionId();
  if (existingId) {
    const existing = loadVoiceSession(existingId);
    if (existing) return existing;
  }
  const id = createVoiceSessionId();
  const fresh = emptyVoiceSession(id);
  saveVoiceSession(fresh);
  return fresh;
}
