export type SpeechTranscriptionResponse = {
  transcript: string;
  engine: "whisper.cpp";
  language: "es";
  model: string;
};

export type AgenosSpeechBridge = {
  transcribeOnce(): Promise<SpeechTranscriptionResponse>;
  isAvailable(): boolean;
};

export function getSpeechBridge(): AgenosSpeechBridge | null {
  const candidate = globalThis.window?.agenosSpeech;
  if (!candidate) {
    return null;
  }

  return typeof candidate.isAvailable === "function" ? candidate : null;
}
