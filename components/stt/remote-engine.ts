import type { RemoteSttSettings } from "../remote";
import type { SttSettings } from "./config";
import {
  normalizeWhisperTranscript,
  WhisperEngineError,
  type TranscribeWavOptions,
  type TranscribeWavResult,
  type WhisperEngine,
  type WhisperEngineStatus,
} from "./engine";

/**
 * Motor de STT remoto contra Groq.
 *
 * Es el mismo Whisper large v3 que corre en local, pero en la maquina de otro:
 * aqui solo se graba y se sube el WAV, asi que el equipo se ahorra la
 * inferencia entera. Por eso este motor no mira `SttPaths` para nada, ni
 * siquiera para declararse disponible: sin modelo instalado tambien transcribe.
 *
 * El interruptor vive fuera, en `components/remote`. Si alguien construye este
 * motor es porque esa decision ya esta tomada.
 */

/** Tope de Groq para el fichero subido. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const MISSING_KEY_REASON =
  "STT remoto no disponible: falta la clave de la API de Groq. Anadela en el panel de servicios remotos.";

export type GroqEngineOptions = {
  /** De aqui salen el idioma y el vocabulario de AgenOS. */
  settings: SttSettings;
  remote: RemoteSttSettings;
  apiKey: string | null;
  fetchFn?: typeof fetch;
  now?: () => number;
  logger?: (message: string) => void;
};

export function createGroqEngine(options: GroqEngineOptions): WhisperEngine {
  const { settings, remote } = options;
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  const log = options.logger ?? (() => {});
  const apiKey = options.apiKey?.trim() || null;
  const endpoint = `${remote.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`;

  function status(): WhisperEngineStatus {
    return {
      available: Boolean(apiKey),
      reason: apiKey ? null : MISSING_KEY_REASON,
      model: remote.model,
      vadModel: null,
      baseUrl: remote.baseUrl,
      engine: "groq",
    };
  }

  async function ensureReady(): Promise<void> {
    // No hay peticion de calentamiento a proposito: no queda nada precargado al
    // otro lado y la sonda solo gastaria cuota del limite de peticiones.
    if (!apiKey) {
      throw new WhisperEngineError("unavailable", MISSING_KEY_REASON);
    }
  }

  async function readErrorMessage(response: Response): Promise<string> {
    try {
      const payload = await response.json() as { error?: { message?: unknown } };
      const message = payload?.error?.message;
      return typeof message === "string" ? message : "";
    } catch {
      return "";
    }
  }

  function describeFailure(response: Response, detail: string): WhisperEngineError {
    const suffix = detail ? ` ${detail}` : "";

    // Una clave mala no es un fallo de transcripcion sino de configuracion: se
    // marca como `unavailable` para que la interfaz mande a arreglar la clave.
    if (response.status === 401 || response.status === 403) {
      return new WhisperEngineError(
        "unavailable",
        `Groq rechaza la clave de la API (${response.status}). Revisala en el panel de servicios remotos.${suffix}`,
      );
    }
    if (response.status === 413) {
      return new WhisperEngineError(
        "transcription-failed",
        `El audio pasa del limite de 25 MB que acepta Groq.${suffix}`,
      );
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      return new WhisperEngineError(
        "transcription-failed",
        retryAfter
          ? `Groq ha limitado las peticiones. Reintenta en ${retryAfter} s.${suffix}`
          : `Groq ha limitado las peticiones.${suffix}`,
      );
    }

    return new WhisperEngineError("transcription-failed", `Groq devolvio ${response.status}.${suffix}`);
  }

  function describeNetworkFailure(error: unknown, signal: AbortSignal | undefined): WhisperEngineError {
    // Cortar la captura es un final normal, no un error de red.
    if (signal && signal.aborted) {
      return new WhisperEngineError("cancelled", "Transcripcion remota cancelada.");
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      return new WhisperEngineError(
        "transcription-failed",
        `Groq no respondio en ${remote.timeoutMs} ms.`,
      );
    }

    return new WhisperEngineError(
      "transcription-failed",
      `No se pudo hablar con Groq: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  async function transcribeWav(
    wav: Uint8Array,
    transcribeOptions: TranscribeWavOptions = {},
  ): Promise<TranscribeWavResult> {
    await ensureReady();

    if (wav.byteLength > MAX_UPLOAD_BYTES) {
      throw new WhisperEngineError(
        "transcription-failed",
        "El audio pasa del limite de 25 MB que acepta Groq.",
      );
    }

    const startedAt = now();
    const form = new FormData();
    // El audio llega ya en 16 kHz mono S16_LE, que es justo lo que Groq quiere:
    // reconvertirlo solo anadiria latencia y perdida.
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "utterance.wav");
    form.append("model", remote.model);
    form.append("language", settings.language);
    form.append("response_format", "json");
    form.append("temperature", "0");
    if (settings.initialPrompt) {
      // Mismo vocabulario que en local para que los nombres del sistema salgan
      // escritos igual vengan de donde vengan.
      form.append("prompt", settings.initialPrompt);
    }

    let response: Response;
    try {
      response = await fetchFn(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: transcribeOptions.signal ?? AbortSignal.timeout(remote.timeoutMs),
      });
    } catch (error) {
      throw describeNetworkFailure(error, transcribeOptions.signal);
    }

    if (response.ok === false) {
      const failure = describeFailure(response, await readErrorMessage(response));
      log(failure.message);
      throw failure;
    }

    const payload = await response.json() as { text?: unknown };

    return {
      // El Whisper de Groq emite las mismas etiquetas de no-habla que el local.
      text: normalizeWhisperTranscript(typeof payload.text === "string" ? payload.text : ""),
      durationMs: Math.max(0, now() - startedAt),
      model: remote.model,
      language: "es",
    };
  }

  function cancelPending(): void {
    // No hay nada precargado que soltar, pero el contrato lo pide y quien llama
    // no deberia tener que saber que motor le ha tocado.
  }

  function dispose(): void {
    // Sin proceso hijo ni modelo en memoria, cerrar el motor remoto no libera
    // nada: se puede llamar tantas veces como haga falta.
  }

  return { status, ensureReady, transcribeWav, cancelPending, dispose };
}
