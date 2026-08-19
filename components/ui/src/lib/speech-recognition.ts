import {
  createLocalHttpSpeechController,
  getCachedLocalSttAvailability,
  probeLocalSttAvailability,
} from "./local-stt";
import {
  getSpeechBridge,
  type AgenosSpeechBridge,
  type SpeechCapturePhase,
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

function normalizeNativeSpeechError(error: unknown): SpeechRecognitionError {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("no se detecto voz")) {
    return {
      code: "no-speech",
      message,
      disableVoice: false,
    };
  }

  if (
    normalized.includes("no esta instalado")
    || normalized.includes("enoent")
    || normalized.includes("arecord")
    || normalized.includes("whisper")
  ) {
    return {
      code: "native-unavailable",
      message: "STT local no disponible. Revisa whisper.cpp, el modelo small multilingue y el microfono.",
      disableVoice: true,
    };
  }

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
          if (!disposed && result.transcript.trim()) {
            callbacks.onResult(result.transcript);
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
      listening = false;
    },
    dispose() {
      disposed = true;
      listening = false;
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
