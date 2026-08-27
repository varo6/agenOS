import type { spawn } from "node:child_process";

import { captureUnavailableReason, startVadCapture, type CaptureHandle, type CapturePhase } from "./capture";
import { WhisperEngineError, type SttEngineName } from "./engine";
import type { SttRuntime } from "./runtime";

/**
 * Ciclo completo de una orden de voz en el equipo: grabar con VAD y transcribir
 * con el motor local. Solo puede haber una captura viva a la vez, y
 * cancelarla mata el microfono sin producir texto.
 */

export type LocalSpeechFailureCode =
  | "unavailable"
  | "no-speech"
  | "cancelled"
  | "capture-failed"
  | "transcription-failed";

export type LocalSpeechResult =
  | {
      ok: true;
      transcript: string;
      engine: SttEngineName;
      language: "es";
      model: string;
      captureMs: number;
      transcribeMs: number;
    }
  | { ok: false; code: LocalSpeechFailureCode; message: string };

export type LocalSpeechService = {
  status(): { available: boolean; reason: string | null; model: string | null };
  /** Graba y transcribe. Devuelve un fallo tipado, nunca lanza. */
  transcribeOnce(onPhase?: (phase: CapturePhase | "transcribing") => void): Promise<LocalSpeechResult>;
  /** Corta la captura viva. La llamada en curso resuelve con `cancelled`. */
  cancel(): void;
  isCapturing(): boolean;
};

const NO_SPEECH_MESSAGE = "No se detecto voz. Intentalo otra vez o usa texto.";

export type LocalSpeechOptions = {
  /** Inyectables para poder probar el ciclo sin microfono ni binarios reales. */
  spawnFn?: typeof spawn;
  tempDir?: string;
};

export function createLocalSpeechService(
  runtime: SttRuntime,
  options: LocalSpeechOptions = {},
): LocalSpeechService {
  let active: CaptureHandle | null = null;

  function status() {
    const engineStatus = runtime.engine.status();
    const captureIssue = captureUnavailableReason(runtime.paths);

    return {
      available: engineStatus.available && !captureIssue,
      reason: engineStatus.reason ?? captureIssue,
      model: engineStatus.model,
    };
  }

  async function transcribeOnce(
    onPhase?: (phase: CapturePhase | "transcribing") => void,
  ): Promise<LocalSpeechResult> {
    if (active) {
      return { ok: false, code: "capture-failed", message: "Ya hay una captura de voz en marcha." };
    }

    const current = status();
    if (!current.available) {
      return { ok: false, code: "unavailable", message: current.reason ?? "STT local no disponible." };
    }

    // Voxtype carga el modelo en paralelo con la grabacion. En el fallback esta
    // llamada comprueba que whisper-server responde.
    const engineReady = runtime.engine.ensureReady();
    void engineReady.catch(() => {});
    const handle = startVadCapture({
      settings: runtime.settings,
      paths: runtime.paths,
      onPhase,
      spawnFn: options.spawnFn,
      tempDir: options.tempDir,
    });
    active = handle;

    let outcome;
    try {
      outcome = await handle.done;
    } finally {
      active = null;
    }

    if (outcome.status === "cancelled") {
      runtime.engine.cancelPending?.();
      return { ok: false, code: "cancelled", message: "Captura cancelada." };
    }
    if (outcome.status === "failed") {
      runtime.engine.cancelPending?.();
      return { ok: false, code: "capture-failed", message: outcome.message };
    }
    if (outcome.status === "no-speech") {
      runtime.engine.cancelPending?.();
      return { ok: false, code: "no-speech", message: NO_SPEECH_MESSAGE };
    }

    onPhase?.("transcribing");

    try {
      await engineReady;
      const transcription = await runtime.engine.transcribeWav(outcome.wav);
      if (!transcription.text) {
        return { ok: false, code: "no-speech", message: NO_SPEECH_MESSAGE };
      }

      return {
        ok: true,
        transcript: transcription.text,
        engine: runtime.engine.status().engine,
        language: transcription.language,
        model: transcription.model,
        captureMs: outcome.durationMs,
        transcribeMs: transcription.durationMs,
      };
    } catch (error) {
      const code = error instanceof WhisperEngineError && error.code === "unavailable"
        ? "unavailable"
        : "transcription-failed";
      return {
        ok: false,
        code,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    status,
    transcribeOnce,
    cancel() {
      active?.cancel();
    },
    isCapturing() {
      return active !== null;
    },
  };
}
