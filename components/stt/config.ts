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
  /** Idioma fijo del producto. No se acepta configuracion ni autodeteccion. */
  language: "es";
  /** Vocabulario que ayuda a Whisper con nombres propios del sistema. */
  initialPrompt: string;
  threads: number;
  /** Ajustes exclusivos del fallback whisper.cpp. Voxtype no los recibe. */
  fallbackBeamSize: number;
  fallbackBestOf: number;
  /**
   * Contexto del encoder. 0 = ventana completa de 30 s, que es el default.
   * Recortarlo baja la latencia mucho (unos 3,1 s -> 1,1 s en un N100) a costa
   * de precision, asi que se deja como decision explicita de quien despliega.
   */
  fallbackAudioContext: number;
  /** `-sns` del fallback whisper.cpp. */
  fallbackSuppressNonSpeech: boolean;
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
  fallbackServerHost: string;
  fallbackServerPort: number;
  /** Deja que el runtime levante whisper-server cuando se selecciona el fallback. */
  fallbackServerAutostart: boolean;
};

export const DEFAULT_STT_SETTINGS: SttSettings = {
  engine: "voxtype",
  language: "es",
  initialPrompt: "Orden breve para AgenOS: abre, cierra, busca, volumen, brillo, Wi-Fi, Bluetooth.",
  threads: 4,
  fallbackBeamSize: 5,
  fallbackBestOf: 5,
  fallbackAudioContext: 0,
  fallbackSuppressNonSpeech: true,
  maxDurationMs: 15_000,
  silenceMs: 650,
  minSpeechMs: 250,
  speechPadMs: 320,
  vadThreshold: 0.5,
  startTimeoutMs: 8_000,
  captureDevice: "default",
  fallbackServerHost: "127.0.0.1",
  fallbackServerPort: 8178,
  fallbackServerAutostart: true,
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

export function resolveSttSettings(env: EnvLike = process.env): SttSettings {
  const defaults = DEFAULT_STT_SETTINGS;
  const requestedEngine = env.AGENOS_STT_ENGINE?.trim().toLowerCase();

  return {
    engine: requestedEngine === "whisper.cpp" ? "whisper.cpp" : defaults.engine,
    language: "es",
    initialPrompt: env.AGENOS_STT_INITIAL_PROMPT?.trim() || defaults.initialPrompt,
    threads: readInt(env, "AGENOS_STT_THREADS", defaults.threads, 1, 16),
    fallbackBeamSize: readInt(env, "AGENOS_STT_FALLBACK_BEAM_SIZE", defaults.fallbackBeamSize, 1, 8),
    fallbackBestOf: readInt(env, "AGENOS_STT_FALLBACK_BEST_OF", defaults.fallbackBestOf, 1, 8),
    fallbackAudioContext: readInt(env, "AGENOS_STT_FALLBACK_AUDIO_CTX", defaults.fallbackAudioContext, 0, 1500),
    fallbackSuppressNonSpeech: readFlag(env, "AGENOS_STT_FALLBACK_SUPPRESS_NON_SPEECH", defaults.fallbackSuppressNonSpeech),
    maxDurationMs: readInt(env, "AGENOS_STT_MAX_SECONDS", defaults.maxDurationMs / 1000, 2, 120) * 1000,
    silenceMs: readInt(env, "AGENOS_STT_SILENCE_MS", defaults.silenceMs, 200, 5_000),
    minSpeechMs: readInt(env, "AGENOS_STT_MIN_SPEECH_MS", defaults.minSpeechMs, 64, 5_000),
    speechPadMs: readInt(env, "AGENOS_STT_SPEECH_PAD_MS", defaults.speechPadMs, 0, 2_000),
    vadThreshold: readFloat(env, "AGENOS_STT_VAD_THRESHOLD", defaults.vadThreshold, 0.05, 0.95),
    startTimeoutMs: readInt(env, "AGENOS_STT_START_TIMEOUT_MS", defaults.startTimeoutMs, 1_000, 60_000),
    captureDevice: env.AGENOS_STT_ALSA_DEVICE?.trim() || defaults.captureDevice,
    fallbackServerHost: env.AGENOS_STT_FALLBACK_SERVER_HOST?.trim() || defaults.fallbackServerHost,
    fallbackServerPort: readInt(env, "AGENOS_STT_FALLBACK_SERVER_PORT", defaults.fallbackServerPort, 1, 65_535),
    fallbackServerAutostart: readFlag(env, "AGENOS_STT_FALLBACK_SERVER_AUTOSTART", defaults.fallbackServerAutostart),
  };
}

export function sttServerBaseUrl(settings: SttSettings, env: EnvLike = process.env): string {
  const configured = env.AGENOS_STT_FALLBACK_SERVER_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  return `http://${settings.fallbackServerHost}:${settings.fallbackServerPort}`;
}
