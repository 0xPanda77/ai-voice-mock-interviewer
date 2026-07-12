// Session persistence — PRD §5 / §12: localStorage only, no DB, no accounts.
// Session state (JD, questions, transcript, feedback) is keyed by a session id.

import type { Feedback, Question, Turn } from "@/lib/types";

export type Session = {
  id: string;
  jd: string;
  questions: Question[];
  transcript: Turn[];
  feedback: Feedback | null;
  updatedAt: number;
};

const STORAGE_PREFIX = "ai-mock-interviewer:session:";
const CURRENT_SESSION_KEY = "ai-mock-interviewer:current-session-id";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function createSessionId(): string {
  if (isBrowser() && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function emptySession(id: string): Session {
  return {
    id,
    jd: "",
    questions: [],
    transcript: [],
    feedback: null,
    updatedAt: Date.now(),
  };
}

export function loadSession(id: string): Session | null {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  if (!isBrowser()) return;
  const toSave: Session = { ...session, updatedAt: Date.now() };
  window.localStorage.setItem(
    STORAGE_PREFIX + session.id,
    JSON.stringify(toSave)
  );
  window.localStorage.setItem(CURRENT_SESSION_KEY, session.id);
}

export function getCurrentSessionId(): string | null {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(CURRENT_SESSION_KEY);
}

/** Load the current session, or create + persist a fresh one if none exists. */
export function loadOrCreateCurrentSession(): Session {
  const existingId = getCurrentSessionId();
  if (existingId) {
    const existing = loadSession(existingId);
    if (existing) return existing;
  }
  const id = createSessionId();
  const fresh = emptySession(id);
  saveSession(fresh);
  return fresh;
}
