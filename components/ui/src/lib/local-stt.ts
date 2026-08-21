import type {
  SpeechRecognitionCallbacks,
  SpeechRecognitionController,
  SpeechRecognitionError,
} from "./speech-recognition";

export const LOCAL_STT_STATUS_PATH = "/api/speech/status";
export const LOCAL_STT_TRANSCRIBE_PATH = "/api/speech/transcribe";

/**
 * Tope de captura del camino web. Es el mismo que aplica el VAD en Electron;
 * el servidor lo publica en /api/speech/status y aqui solo se usa si la sonda
 * no llego a contestar.
 */
const DEFAULT_MAX_DURATION_MS = 15_000;
const STATUS_PROBE_TIMEOUT_MS = 1_500;

type RecorderDataEvent = { data: Blob };

export type LocalSttRecorder = {
  mimeType?: string;
  state?: string;
  ondataavailable: ((event: RecorderDataEvent) => void) | null;
  onstop: (() => void) | null;
  start(): void;
  stop(): void;
};

export type LocalSttMediaTrack = { stop(): void };

export type LocalSttMediaStream = { getTracks(): LocalSttMediaTrack[] };

export type LocalSttControllerOptions = {
  fetchFn?: typeof fetch;
  requestStream?: () => Promise<LocalSttMediaStream>;
  createRecorder?: (stream: LocalSttMediaStream) => LocalSttRecorder;
  maxDurationMs?: number;
  lang?: string;
};

let cachedAvailability: boolean | null = null;
let cachedMaxDurationMs: number | null = null;

export function getCachedLocalSttAvailability(): boolean | null {
  return cachedAvailability;
}

/** Tope publicado por el servidor, para no duplicar el valor en el cliente. */
export function getCachedLocalSttMaxDurationMs(): number | null {
  return cachedMaxDurationMs;
}

export function resetLocalSttAvailabilityCache(): void {
  cachedAvailability = null;
  cachedMaxDurationMs = null;
}

export async function probeLocalSttAvailability(fetchFn: typeof fetch | undefined = globalThis.fetch): Promise<boolean> {
  if (cachedAvailability !== null) {
    return cachedAvailability;
  }

  if (!fetchFn) {
    cachedAvailability = false;
    return cachedAvailability;
  }

  try {
    const response = await fetchFn(LOCAL_STT_STATUS_PATH, {
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(STATUS_PROBE_TIMEOUT_MS) : undefined,
    });
    if (!response.ok) {
      cachedAvailability = false;
      return cachedAvailability;
    }
    const payload = await response.json() as { available?: unknown; maxDurationMs?: unknown };
    cachedAvailability = payload?.available === true;
    if (typeof payload?.maxDurationMs === "number" && Number.isFinite(payload.maxDurationMs)) {
      cachedMaxDurationMs = payload.maxDurationMs;
    }
  } catch {
    cachedAvailability = false;
  }

  return cachedAvailability;
}

function defaultRequestStream(): Promise<LocalSttMediaStream> {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.getUserMedia) {
    return Promise.reject(new Error("audio-capture"));
  }
  return mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}

function pickRecorderMimeType(): string | undefined {
  const Recorder = globalThis.MediaRecorder;
  if (!Recorder || typeof Recorder.isTypeSupported !== "function") {
    return undefined;
  }

  return [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ].find((candidate) => Recorder.isTypeSupported(candidate));
}

function defaultCreateRecorder(stream: LocalSttMediaStream): LocalSttRecorder {
  const Recorder = globalThis.MediaRecorder;
  if (!Recorder) {
    throw new Error("audio-capture");
  }

  const mimeType = pickRecorderMimeType();
  return new Recorder(stream as MediaStream, mimeType ? { mimeType } : undefined) as unknown as LocalSttRecorder;
}

function captureError(error: unknown): SpeechRecognitionError {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);

  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      code: "not-allowed",
      message: "El sistema no concedio permiso al microfono. Usa texto.",
      disableVoice: true,
    };
  }

  if (name === "NotFoundError" || message.includes("audio-capture")) {
    return {
      code: "audio-capture",
      message: "No se detecto un microfono disponible. Usa texto.",
      disableVoice: true,
    };
  }

  return {
    code: "capture-error",
    message: "No se pudo grabar audio. Intentalo otra vez o usa texto.",
    disableVoice: false,
  };
}

const NO_SPEECH_ERROR: SpeechRecognitionError = {
  code: "no-speech",
  message: "No se detecto voz. Intentalo otra vez o usa texto.",
  disableVoice: false,
};

const UNAVAILABLE_ERROR: SpeechRecognitionError = {
  code: "local-stt-unavailable",
  message: "STT local no disponible. Revisa whisper.cpp y el modelo base Q5_1 multilingue.",
  disableVoice: true,
};

export function createLocalHttpSpeechController(
  callbacks: SpeechRecognitionCallbacks,
  options: LocalSttControllerOptions = {},
): SpeechRecognitionController {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const requestStream = options.requestStream ?? defaultRequestStream;
  const createRecorder = options.createRecorder ?? defaultCreateRecorder;
  const maxDurationMs = options.maxDurationMs ?? cachedMaxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const lang = options.lang ?? "es";

  let disposed = false;
  let listening = false;
  let cancelled = false;
  let activeRecorder: LocalSttRecorder | null = null;
  let activeStream: LocalSttMediaStream | null = null;

  function stopRecorder(): void {
    if (activeRecorder && activeRecorder.state !== "inactive") {
      try {
        activeRecorder.stop();
      } catch {
        // El grabador puede haberse detenido ya; el flujo continua por onstop.
      }
    }
  }

  function releaseStream(): void {
    activeStream?.getTracks().forEach((track) => {
      track.stop();
    });
    activeStream = null;
  }

  async function transcribe(blob: Blob): Promise<void> {
    const response = await fetchFn(`${LOCAL_STT_TRANSCRIBE_PATH}?lang=${encodeURIComponent(lang)}`, {
      method: "POST",
      headers: { "content-type": blob.type || "audio/webm" },
      body: blob,
    });

    if (response.status === 503) {
      callbacks.onError(UNAVAILABLE_ERROR);
      return;
    }

    // 422 = el audio no traia voz. El servidor ya lo filtro con Silero, asi que
    // aqui no hay nada que reintentar ni que mostrar como fallo tecnico.
    if (response.status === 422) {
      callbacks.onError(NO_SPEECH_ERROR);
      return;
    }

    const payload = await response.json() as { ok?: unknown; text?: unknown; message?: unknown };
    if (!response.ok || payload.ok !== true) {
      callbacks.onError({
        code: "transcription-failed",
        message: typeof payload.message === "string" && payload.message
          ? payload.message
          : "No se pudo transcribir con STT local. Usa texto.",
        disableVoice: false,
      });
      return;
    }

    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) {
      callbacks.onError(NO_SPEECH_ERROR);
      return;
    }

    callbacks.onResult(text);
  }

  async function run(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;

    try {
      activeStream = await requestStream();
      const recorder = createRecorder(activeStream);
      activeRecorder = recorder;

      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      const stopped = new Promise<void>((resolveStop) => {
        recorder.onstop = () => resolveStop();
      });

      recorder.start();
      callbacks.onPhase?.("listening");
      timer = setTimeout(() => stopRecorder(), maxDurationMs);
      await stopped;

      // Cancelar tira la grabacion entera: nunca se sube ni se transcribe.
      if (disposed || cancelled) {
        return;
      }

      // A partir de aquí ya no se graba: se sube el audio y se transcribe.
      callbacks.onPhase?.("transcribing");

      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      if (blob.size === 0) {
        callbacks.onError(NO_SPEECH_ERROR);
        return;
      }

      await transcribe(blob);
    } catch (error) {
      if (!disposed) {
        callbacks.onError(captureError(error));
      }
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      releaseStream();
      activeRecorder = null;
      listening = false;
      if (!disposed) {
        callbacks.onEnd();
      }
    }
  }

  /** Cancela: corta el grabador, suelta el microfono y descarta el audio. */
  const abort = () => {
    cancelled = true;
    stopRecorder();
    releaseStream();
  };

  return {
    supported: true,
    engine: "local-http",
    start() {
      if (listening || disposed) {
        return false;
      }
      listening = true;
      cancelled = false;
      void run();
      return true;
    },
    stop() {
      abort();
    },
    dispose() {
      disposed = true;
      abort();
    },
  };
}
