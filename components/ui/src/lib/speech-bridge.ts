export type SpeechTranscriptionResponse = {
  transcript: string;
  engine: "whisper.cpp";
  language: "es";
  model: string;
};

/** Fases observables de una captura local, empujadas por el proceso principal. */
export type SpeechCapturePhase = "listening" | "transcribing";

export type AgenosSpeechBridge = {
  transcribeOnce(): Promise<SpeechTranscriptionResponse>;
  /**
   * Avisa de cuándo deja de grabar y empieza a transcribir. Es opcional: los
   * puentes antiguos no lo exponen y la interfaz se queda en "te escucho".
   */
  onPhase?(listener: (phase: SpeechCapturePhase) => void): () => void;
  isAvailable(): boolean;
};

export function getSpeechBridge(): AgenosSpeechBridge | null {
  const candidate = globalThis.window?.agenosSpeech;
  if (!candidate) {
    return null;
  }

  return typeof candidate.isAvailable === "function" ? candidate : null;
}
