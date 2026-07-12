// Basic env config per PRD §8/§9 — provider selection for the swappable
// text-LLM and voice-engine seams. Defaults match PRD §9 (today's cheapest
// smooth option): text = gemini, voice = gemini.

export type TextProvider = string;
export type VoiceProvider = string;

export const config = {
  textProvider: (process.env.TEXT_PROVIDER || "gemini") as TextProvider,
  voiceProvider: (process.env.VOICE_PROVIDER || "gemini") as VoiceProvider,
};
