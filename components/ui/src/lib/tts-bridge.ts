/**
 * `espeak-ng` habla en el equipo; `azure` solo aparece si el usuario enciende
 * la voz en la nube desde los ajustes.
 */
export type TtsEngineName = "espeak-ng" | "azure";

export type TextToSpeechFailureCode = "unavailable" | "cancelled" | "synthesis-failed";

export type TextToSpeechOutcome =
  | { ok: true; engine: TtsEngineName; voice: string }
  | { ok: false; code: TextToSpeechFailureCode; message: string };

export type TextToSpeechStatus = {
  available: boolean;
  reason: string | null;
  engine: TtsEngineName;
  voice: string;
};

export type AgenosTtsBridge = {
  speak(text: string): Promise<TextToSpeechOutcome>;
  stop(): Promise<void>;
  status(): Promise<TextToSpeechStatus>;
  isAvailable(): boolean;
};

export function getTtsBridge(): AgenosTtsBridge | null {
  const candidate = globalThis.window?.agenosTts;
  if (!candidate) {
    return null;
  }

  return typeof candidate.isAvailable === "function" ? candidate : null;
}
