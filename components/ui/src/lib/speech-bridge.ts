/**
 * Contrato entre el renderer y el proceso principal para la voz local.
 *
 * `transcribeOnce` devuelve un resultado tipado en vez de lanzar: cancelar una
 * captura es un final normal, no un fallo, y la interfaz no debe pintar ningún
 * error cuando la persona decide parar.
 */

export type SpeechTranscriptionFailureCode =
  | "unavailable"
  | "no-speech"
  | "cancelled"
  | "capture-failed"
  | "transcription-failed";

export type SpeechTranscriptionOutcome =
  | {
      ok: true;
      transcript: string;
      engine: "whisper.cpp";
      /** Siempre "es" salvo que AGENOS_STT_LANGUAGE lo cambie; nunca autodetectado. */
      language: string;
      model: string;
    }
  | { ok: false; code: SpeechTranscriptionFailureCode; message: string };

/**
 * Fases observables de una captura local, empujadas por el proceso principal.
 * `speech` la publica Silero cuando confirma que lo que entra es voz.
 */
export type SpeechCapturePhase = "listening" | "speech" | "transcribing";

export type AgenosSpeechBridge = {
  transcribeOnce(): Promise<SpeechTranscriptionOutcome>;
  /**
   * Aborta la captura viva. Mata el grabador, suelta el micrófono y hace que la
   * llamada a `transcribeOnce` en curso resuelva con `cancelled`.
   */
  cancel(): Promise<void>;
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
