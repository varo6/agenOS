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

export type SpeechRecognitionCallbacks = {
  onResult: (transcript: string) => void;
  onError: (error: SpeechRecognitionError) => void;
  onEnd: () => void;
};

export type SpeechRecognitionController = {
  supported: boolean;
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
  return Boolean(getSpeechRecognitionConstructor(targetWindow));
}

export function createSpeechRecognitionController(
  callbacks: SpeechRecognitionCallbacks,
  targetWindow: Window | undefined = globalThis.window,
): SpeechRecognitionController {
  const SpeechRecognitionCtor = getSpeechRecognitionConstructor(targetWindow);
  if (!SpeechRecognitionCtor) {
    return {
      supported: false,
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
  recognition.onerror = (event) => {
    callbacks.onError(normalizeSpeechError(event.error));
  };
  recognition.onend = () => {
    callbacks.onEnd();
  };

  return {
    supported: true,
    start() {
      try {
        recognition.start();
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

      if (typeof recognition.abort === "function") {
        recognition.abort();
      } else {
        recognition.stop();
      }
    },
  };
}
