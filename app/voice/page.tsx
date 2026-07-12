"use client";

// /voice — issue #9: browser mic capture + AI audio playback + live
// transcript, driven over the relay's normalized protocol (relay/protocol.ts).
//
// Deliberately a DISTINCT surface from the M1 text loop (app/page.tsx) — not
// wired into questions/scoring yet, that's M3 (issue #10). This proves
// mic-in / audio-out / transcript-capture works against the relay + real
// Gemini Live, using a fixed placeholder JD/questions for now.

import { useEffect, useRef, useState } from "react";
import type { Question, Turn } from "@/lib/types";
import { connectRelay, base64ToArrayBuffer, type RelayClient } from "./lib/relay-client";
import { startMicCapture, type MicCapture } from "./lib/mic-capture";
import { createAudioPlayer, type AudioPlayer } from "./lib/audio-playback";
import {
  loadOrCreateCurrentVoiceSession,
  saveVoiceSession,
  type VoiceSession,
} from "./lib/voice-session-store";

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL || "ws://localhost:8787";

const PLACEHOLDER_JD =
  "Senior Fullstack Developer: TypeScript, React, Node.js, PostgreSQL. " +
  "Building customer-facing web apps at scale.";
const PLACEHOLDER_QUESTIONS: Question[] = [
  { text: "Tell me about a challenging project you led." },
  { text: "Describe a time you debugged a hard production issue." },
];

type Status =
  | "idle"
  | "connecting"
  | "ready"
  | "in-session"
  | "error"
  | "ended";

export default function VoicePage() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [meSpeaking, setMeSpeaking] = useState(false);
  const [session, setSession] = useState<VoiceSession | null>(null);

  const relayRef = useRef<RelayClient | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  // Accumulate transcript.delta text per open turn, flush a Turn on turn.end.
  const pendingTextRef = useRef<{ ai: string; me: string }>({ ai: "", me: "" });

  useEffect(() => {
    setSession(loadOrCreateCurrentVoiceSession());
  }, []);

  function persistTranscript(next: Turn[]) {
    setSession((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, transcript: next };
      saveVoiceSession(updated);
      return updated;
    });
  }

  async function handleStart() {
    setErrorMessage(null);
    setTranscript([]);
    pendingTextRef.current = { ai: "", me: "" };
    setStatus("connecting");

    playerRef.current = createAudioPlayer();

    const relay = connectRelay(
      RELAY_URL,
      () => {
        // Socket is actually open now — speak first. The relay only emits
        // session.ready once it's processed a session.start.
        relay.sendSessionStart(PLACEHOLDER_QUESTIONS, PLACEHOLDER_JD);
      },
      (event) => {
        switch (event.type) {
          case "session.ready": {
            setStatus("ready");
            setStatus("in-session");
            startMic(relay);
            break;
          }
          case "audio.chunk": {
            playerRef.current?.enqueue(
              base64ToArrayBuffer(event.data),
              event.sampleRate
            );
            break;
          }
          case "turn.start": {
            if (event.speaker === "ai") setAiSpeaking(true);
            else setMeSpeaking(true);
            break;
          }
          case "turn.end": {
            const key = event.speaker;
            const text = pendingTextRef.current[key].trim();
            if (text) {
              setTranscript((prev) => {
                const next: Turn[] = [
                  ...prev,
                  { speaker: event.speaker, text, ts: Date.now() },
                ];
                persistTranscript(next);
                return next;
              });
            }
            pendingTextRef.current[key] = "";
            if (event.speaker === "ai") {
              setAiSpeaking(false);
            } else {
              setMeSpeaking(false);
              // Barge-in: if I started talking while the AI was mid-turn,
              // stop whatever's still queued for playback.
              playerRef.current?.flush();
            }
            break;
          }
          case "transcript.delta": {
            pendingTextRef.current[event.speaker] += event.text;
            break;
          }
          case "error": {
            setErrorMessage(event.message);
            setStatus("error");
            break;
          }
        }
      },
      () => {
        // Relay closed the socket.
        setStatus((prev) => (prev === "error" ? prev : "ended"));
      }
    );

    relayRef.current = relay;
  }

  async function startMic(relay: RelayClient) {
    try {
      const mic = await startMicCapture((frame) => {
        relay.sendAudioChunk(frame);
      });
      micRef.current = mic;
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? `Mic access failed: ${err.message}`
          : "Mic access failed."
      );
      setStatus("error");
    }
  }

  function handleStop() {
    relayRef.current?.sendSessionEnd();
    relayRef.current?.close();
    relayRef.current = null;
    micRef.current?.stop();
    micRef.current = null;
    playerRef.current?.close();
    playerRef.current = null;
    setAiSpeaking(false);
    setMeSpeaking(false);
    setStatus("ended");
  }

  useEffect(() => {
    return () => {
      micRef.current?.stop();
      playerRef.current?.close();
      relayRef.current?.close();
    };
  }, []);

  return (
    <div className="min-h-screen p-6 sm:p-10 max-w-3xl mx-auto flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold">Voice relay demo (M2)</h1>
        <p className="text-sm text-black/60 dark:text-white/60 mt-1">
          Proves mic-in / AI audio-out / live transcript against the relay +
          Gemini Live. Distinct from the M1 text loop — not wired into
          questions/scoring yet (that&apos;s M3).
        </p>
        <p className="text-xs text-black/40 dark:text-white/40 mt-1">
          Relay: {RELAY_URL} {session && <> &middot; Session: {session.id}</>}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <p className="text-sm">
          Status: <span className="font-mono">{status}</span>
          {aiSpeaking && <span className="ml-2 text-blue-600">AI speaking…</span>}
          {meSpeaking && <span className="ml-2 text-green-600">Listening…</span>}
        </p>
        <div className="flex gap-3">
          <button
            className="self-start rounded-full bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
            onClick={handleStart}
            disabled={status === "connecting" || status === "in-session"}
          >
            Start voice session
          </button>
          <button
            className="self-start rounded-full border border-black/15 dark:border-white/20 px-4 py-2 text-sm font-medium disabled:opacity-50"
            onClick={handleStop}
            disabled={status !== "in-session" && status !== "ready"}
          >
            End session
          </button>
        </div>
        {errorMessage && (
          <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Live transcript</h2>
        {transcript.length === 0 ? (
          <p className="text-sm text-black/40 dark:text-white/40">
            No turns captured yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {transcript.map((t, i) => (
              <li key={i} className="text-sm">
                <span className="font-semibold">
                  {t.speaker === "ai" ? "Interviewer" : "Me"}:
                </span>{" "}
                {t.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
