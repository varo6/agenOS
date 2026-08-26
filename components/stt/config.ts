/**
 * Ajustes del STT local, en un unico sitio.
 *
 * Electron y la ruta HTTP comparten este modulo a proposito: hasta ahora cada
 * una resolvia sus propios flags y acababan pidiendole cosas distintas al mismo
 * Whisper. Los valores por defecto son los que AgenOS considera correctos para
 * ordenes cortas en espanol; las variables de entorno solo existen para poder
 * moverlos sin recompilar.
 */

export type SttSettings = {
  /** Motor de transcripcion. Voxtype usa Whisper local y libera el modelo al acabar. */
  engine: "voxtype" | "whisper.cpp";
  /** Idioma fijo. AgenOS nunca autodetecta: `auto` cae en el idioma por defecto. */
  language: string;
  /** Vocabulario que ayuda a Whisper con nombres propios del sistema. */
  initialPrompt: string;
  threads: number;
  beamSize: number;
  bestOf: number;
  /**
   * Contexto del encoder. 0 = ventana completa de 30 s, que es el default.
   * Recortarlo baja la latencia mucho (unos 3,1 s -> 1,1 s en un N100) a costa
   * de precision, asi que se deja como decision explicita de quien despliega.
   */
  audioContext: number;
  /** `-sns`: descarta los tokens que Whisper reserva para lo que no es habla. */
  suppressNonSpeech: boolean;
  /** Tope duro de captura. Nada puede grabar mas que esto. */
  maxDurationMs: number;
  /** Silencio que cierra la frase una vez ha habido voz. */
  silenceMs: number;
  /** Voz acumulada minima para aceptar la grabacion. */
  minSpeechMs: number;
  /** Margen que se conserva antes y despues de la voz al recortar. */
  speechPadMs: number;
  /** Umbral de probabilidad de Silero. */
  vadThreshold: number;
  /** Espera maxima sin oir nada antes de rendirse. */
  startTimeoutMs: number;
  /** Dispositivo ALSA de captura. */
  captureDevice: string;
  serverHost: string;
  serverPort: number;
  /** Deja que el runtime levante whisper-server si no lo ha hecho systemd. */
  serverAutostart: boolean;
};

export const DEFAULT_STT_SETTINGS: SttSettings = {
  engine: "voxtype",
  language: "es",
  initialPrompt: "AgenOS, Pi, ChatGPT, Chromium, Wi-Fi, Bluetooth, volumen, brillo. Orden breve en español.",
  threads: 4,
  beamSize: 5,
  bestOf: 5,
  audioContext: 0,
  suppressNonSpeech: true,
  maxDurationMs: 15_000,
  silenceMs: 650,
  minSpeechMs: 250,
  speechPadMs: 320,
  vadThreshold: 0.5,
  startTimeoutMs: 8_000,
  captureDevice: "default",
  serverHost: "127.0.0.1",
  serverPort: 8178,
  serverAutostart: true,
};

type EnvLike = Record<string, string | undefined>;

function readInt(env: EnvLike, name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function readFloat(env: EnvLike, name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(env[name] ?? "");
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function readFlag(env: EnvLike, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  return raw !== "0" && raw !== "false" && raw !== "no";
}

/**
 * Normaliza un idioma pedido a la etiqueta que entiende Whisper. Ausente, vacio
 * o `auto` caen en el idioma por defecto porque `auto` se equivoca demasiado en
 * frases de dos segundos, y sin `-l` Whisper asume ingles.
 */
export function resolveLanguage(requested: string | undefined, fallback: string): string {
  const normalized = requested?.trim().toLowerCase();
  if (!normalized || normalized === "auto") {
    return fallback;
  }

  return normalized.split(/[-_]/)[0] || fallback;
}

export function resolveSttSettings(env: EnvLike = process.env): SttSettings {
  const defaults = DEFAULT_STT_SETTINGS;
  const requestedEngine = env.AGENOS_STT_ENGINE?.trim().toLowerCase();

  return {
    engine: requestedEngine === "whisper.cpp" ? "whisper.cpp" : defaults.engine,
    language: resolveLanguage(env.AGENOS_STT_LANGUAGE, defaults.language),
    initialPrompt: env.AGENOS_STT_INITIAL_PROMPT?.trim() || defaults.initialPrompt,
    threads: readInt(env, "AGENOS_STT_THREADS", defaults.threads, 1, 16),
    beamSize: readInt(env, "AGENOS_STT_BEAM_SIZE", defaults.beamSize, 1, 8),
    bestOf: readInt(env, "AGENOS_STT_BEST_OF", defaults.bestOf, 1, 8),
    audioContext: readInt(env, "AGENOS_STT_AUDIO_CTX", defaults.audioContext, 0, 1500),
    suppressNonSpeech: readFlag(env, "AGENOS_STT_SUPPRESS_NON_SPEECH", defaults.suppressNonSpeech),
    maxDurationMs: readInt(env, "AGENOS_STT_MAX_SECONDS", defaults.maxDurationMs / 1000, 2, 120) * 1000,
    silenceMs: readInt(env, "AGENOS_STT_SILENCE_MS", defaults.silenceMs, 200, 5_000),
    minSpeechMs: readInt(env, "AGENOS_STT_MIN_SPEECH_MS", defaults.minSpeechMs, 64, 5_000),
    speechPadMs: readInt(env, "AGENOS_STT_SPEECH_PAD_MS", defaults.speechPadMs, 0, 2_000),
    vadThreshold: readFloat(env, "AGENOS_STT_VAD_THRESHOLD", defaults.vadThreshold, 0.05, 0.95),
    startTimeoutMs: readInt(env, "AGENOS_STT_START_TIMEOUT_MS", defaults.startTimeoutMs, 1_000, 60_000),
    captureDevice: env.AGENOS_STT_ALSA_DEVICE?.trim() || defaults.captureDevice,
    serverHost: env.AGENOS_STT_SERVER_HOST?.trim() || defaults.serverHost,
    serverPort: readInt(env, "AGENOS_STT_SERVER_PORT", defaults.serverPort, 1, 65_535),
    serverAutostart: readFlag(env, "AGENOS_STT_SERVER_AUTOSTART", defaults.serverAutostart),
  };
}

export function sttServerBaseUrl(settings: SttSettings, env: EnvLike = process.env): string {
  const configured = env.AGENOS_STT_SERVER_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  return `http://${settings.serverHost}:${settings.serverPort}`;
}
