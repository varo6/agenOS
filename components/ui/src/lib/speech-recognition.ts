import {
  createLocalHttpSpeechController,
  getCachedLocalSttAvailability,
  probeLocalSttAvailability,
} from "./local-stt";
import {
  getSpeechBridge,
  type AgenosSpeechBridge,
  type SpeechCapturePhase,
  type SpeechTranscriptionOutcome,
} from "./speech-bridge";

type BrowserSpeechRecognitionAlternative = {
  transcript: string;
};

type BrowserSpeechRecognitionResult = {
  isFinal: boolean;
  0: BrowserSpeechRecognitionAlternative;
  length: number;
};

type BrowserSpeechRecognitionResultList = ArrayLike<BrowserSpeechRecognitionResult>;

type BrowserSpeechRecognitionEvent = {
  results: BrowserSpeechRecognitionResultList;
};

type BrowserSpeechRecognitionErrorEvent = {
  error?: string;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onspeechend: (() => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

export type SpeechRecognitionError = {
  code: string;
  message: string;
  disableVoice: boolean;
};

export type { SpeechCapturePhase };

export type SpeechRecognitionCallbacks = {
  onResult: (transcript: string) => void;
  onError: (error: SpeechRecognitionError) => void;
  onEnd: () => void;
  /**
   * Progreso de la captura: permite distinguir "te escucho" de "estoy
   * entendiendo lo que has dicho". Es opcional para no romper a quien ya
   * construye controladores con las tres callbacks originales.
   */
  onPhase?: (phase: SpeechCapturePhase) => void;
};

export type SpeechRecognitionController = {
  supported: boolean;
  engine: "native" | "local-http" | "browser" | "none";
  start: () => boolean;
  stop: () => void;
  dispose: () => void;
};

function getSpeechRecognitionConstructor(targetWindow: Window | undefined = globalThis.window) {
  return targetWindow?.SpeechRecognition ?? targetWindow?.webkitSpeechRecognition ?? null;
}

function normalizeSpeechError(code: string | undefined): SpeechRecognitionError {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return {
        code: code ?? "not-allowed",
        message: "El navegador no concedio permiso al microfono. Usa texto.",
        disableVoice: true,
      };
    case "audio-capture":
      return {
        code,
        message: "No se detecto un microfono disponible. Usa texto.",
        disableVoice: true,
      };
    case "no-speech":
      return {
        code,
        message: "No se detecto voz. Intentalo otra vez o usa texto.",
        disableVoice: false,
      };
    default:
      return {
        code: code ?? "unknown",
        message: "No se pudo usar el reconocimiento de voz. Usa texto.",
        disableVoice: false,
      };
  }
}

/**
 * Traduce el fallo tipado del puente a lo que la interfaz sabe pintar. Que sea
 * un codigo y no una cadena importa: antes esto adivinaba el motivo buscando
 * subcadenas en el mensaje de error de arecord.
 */
function nativeFailureToSpeechError(
  failure: Extract<SpeechTranscriptionOutcome, { ok: false }>,
): SpeechRecognitionError {
  switch (failure.code) {
    case "unavailable":
      return {
        code: "native-unavailable",
        message: "STT local no disponible. Revisa whisper.cpp, el modelo base Q5_1 multilingue y el microfono.",
        disableVoice: true,
      };
    case "no-speech":
      return {
        code: "no-speech",
        message: failure.message || "No se detecto voz. Intentalo otra vez o usa texto.",
        disableVoice: false,
      };
    default:
      return {
        code: "native-error",
        message: failure.message || "No se pudo transcribir con STT local. Usa texto.",
        disableVoice: false,
      };
  }
}

/** Un fallo del propio canal IPC: el puente ni siquiera llego a contestar. */
function normalizeNativeSpeechError(error: unknown): SpeechRecognitionError {
  const message = error instanceof Error ? error.message : String(error);

  return {
    code: "native-error",
    message: message || "No se pudo transcribir con STT local. Usa texto.",
    disableVoice: false,
  };
}

function extractTranscript(results: BrowserSpeechRecognitionResultList): string {
  const chunks: string[] = [];

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (!result?.isFinal) {
      continue;
    }

    const transcript = result[0]?.transcript?.trim();
    if (transcript) {
      chunks.push(transcript);
    }
  }

  return chunks.join(" ").trim();
}

export function isSpeechRecognitionSupported(targetWindow: Window | undefined = globalThis.window): boolean {
  const bridge = getSpeechBridge();
  return Boolean(
    bridge?.isAvailable()
    || getCachedLocalSttAvailability()
    || getSpeechRecognitionConstructor(targetWindow),
  );
}

function createNativeSpeechRecognitionController(
  callbacks: SpeechRecognitionCallbacks,
  bridge: AgenosSpeechBridge,
): SpeechRecognitionController {
  let disposed = false;
  let listening = false;

  // El puente empuja la fase real (grabando / transcribiendo) si la expone.
  const unsubscribePhase = bridge.onPhase?.((phase) => {
    if (!disposed && listening) {
      callbacks.onPhase?.(phase);
    }
  });

  /**
   * Cancelar es matar la captura en el proceso principal, no solo dejar de
   * mirar. Antes `stop()` se limitaba a bajar una bandera aqui y arecord seguia
   * con el microfono abierto hasta agotar sus segundos.
   */
  const abort = () => {
    listening = false;
    void bridge.cancel().catch(() => {
      // Si el puente ya no esta, la captura ha muerto con el de todos modos.
    });
  };

  return {
    supported: true,
    engine: "native",
    start() {
      if (listening || disposed) {
        return false;
      }

      listening = true;
      callbacks.onPhase?.("listening");
      void bridge.transcribeOnce()
        .then((result) => {
          if (disposed) {
            return;
          }

          if (result.ok) {
            const transcript = result.transcript.trim();
            if (transcript) {
              callbacks.onResult(transcript);
            }
            return;
          }

          // Cancelar es una decision de la persona: se termina en silencio.
          if (result.code !== "cancelled") {
            callbacks.onError(nativeFailureToSpeechError(result));
          }
        })
        .catch((error) => {
          if (!disposed) {
            callbacks.onError(normalizeNativeSpeechError(error));
          }
        })
        .finally(() => {
          listening = false;
          if (!disposed) {
            callbacks.onEnd();
          }
        });

      return true;
    },
    stop() {
      abort();
    },
    dispose() {
      disposed = true;
      abort();
      unsubscribePhase?.();
    },
  };
}

export async function createPreferredSpeechRecognitionController(
  callbacks: SpeechRecognitionCallbacks,
  targetWindow: Window | undefined = globalThis.window,
): Promise<SpeechRecognitionController> {
  const bridge = getSpeechBridge();
  if (bridge?.isAvailable()) {
    return createNativeSpeechRecognitionController(callbacks, bridge);
  }

  if (await probeLocalSttAvailability()) {
    return createLocalHttpSpeechController(callbacks);
  }

  return createSpeechRecognitionController(callbacks, targetWindow);
}

export function createSpeechRecognitionController(
  callbacks: SpeechRecognitionCallbacks,
  targetWindow: Window | undefined = globalThis.window,
): SpeechRecognitionController {
  const bridge = getSpeechBridge();
  if (bridge?.isAvailable()) {
    return createNativeSpeechRecognitionController(callbacks, bridge);
  }

  const SpeechRecognitionCtor = getSpeechRecognitionConstructor(targetWindow);
  if (!SpeechRecognitionCtor) {
    return {
      supported: false,
      engine: "none",
      start: () => false,
      stop: () => {},
      dispose: () => {},
    };
  }

  const recognition = new SpeechRecognitionCtor();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.lang = targetWindow?.navigator.language || "es-ES";
  recognition.onresult = (event) => {
    const transcript = extractTranscript(event.results);
    if (transcript) {
      callbacks.onResult(transcript);
    }
  };
  recognition.onspeechend = () => {
    callbacks.onPhase?.("transcribing");
  };
  recognition.onerror = (event) => {
    callbacks.onError(normalizeSpeechError(event.error));
  };
  recognition.onend = () => {
    callbacks.onEnd();
  };

  return {
    supported: true,
    engine: "browser",
    start() {
      try {
        recognition.start();
        callbacks.onPhase?.("listening");
        return true;
      } catch {
        callbacks.onError(normalizeSpeechError("start-failed"));
        return false;
      }
    },
    stop() {
      recognition.stop();
    },
    dispose() {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onspeechend = null;

      if (typeof recognition.abort === "function") {
        recognition.abort();
      } else {
        recognition.stop();
      }
    },
  };
}
