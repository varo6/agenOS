/**
 * Ajustes de los servicios remotos opcionales de voz.
 *
 * Por defecto AgenOS transcribe y habla en local. Este modulo describe el
 * interruptor que permite delegar cualquiera de las dos cosas en un servicio
 * externo para liberar CPU del equipo, sin tocar la ruta local: si el
 * interruptor esta apagado nada de esto llega a ejecutarse.
 *
 * El idioma es castellano fijo en las dos direcciones, igual que en la ruta
 * local. No hay autodeteccion ni ingles.
 */

/** Groq sirve Whisper large v3 por una API compatible con la de OpenAI. */
export type RemoteSttProvider = "groq";

/**
 * Azure AI Speech es el unico proveedor con voces castellanas nativas, medio
 * millon de caracteres gratis al mes de forma recurrente y salida WAV directa.
 * Groq no vale aqui: sus modelos de voz solo hablan ingles y arabe.
 */
export type RemoteTtsProvider = "azure";

export type RemoteSttSettings = {
  /** Interruptor del usuario. Apagado = se usa Voxtype en local. */
  enabled: boolean;
  provider: RemoteSttProvider;
  /**
   * `whisper-large-v3-turbo` es 2,8 veces mas barato y mas rapido;
   * `whisper-large-v3` acierta algo mas. Los dos son multiidioma.
   */
  model: string;
  baseUrl: string;
  timeoutMs: number;
};

export type RemoteTtsSettings = {
  /** Interruptor del usuario. Apagado = se usa espeak-ng en local. */
  enabled: boolean;
  provider: RemoteTtsProvider;
  /** Region del recurso de Azure Speech, por ejemplo `westeurope`. */
  region: string;
  /** Voz neuronal castellana. */
  voice: string;
  /**
   * WAV a secas y no mp3: asi el audio se reproduce con `aplay`, que ya viene
   * en la imagen por el microfono, y no hace falta ningun descodificador.
   */
  outputFormat: string;
  timeoutMs: number;
};

export type RemoteServicesSettings = {
  stt: RemoteSttSettings;
  tts: RemoteTtsSettings;
};

/** Voces castellanas de Azure que el panel de ajustes ofrece. */
export const AZURE_SPANISH_VOICES = [
  { id: "es-ES-ElviraNeural", label: "Elvira (femenina)" },
  { id: "es-ES-AlvaroNeural", label: "Alvaro (masculina)" },
  { id: "es-ES-XimenaNeural", label: "Ximena (femenina)" },
  { id: "es-ES-ArabellaNeural", label: "Arabella (femenina)" },
  { id: "es-ES-TristanNeural", label: "Tristan (masculina)" },
] as const;

/** Modelos de Groq que el panel de ajustes ofrece. */
export const GROQ_WHISPER_MODELS = [
  { id: "whisper-large-v3-turbo", label: "Rapido (turbo)" },
  { id: "whisper-large-v3", label: "Preciso (large v3)" },
] as const;

export const DEFAULT_REMOTE_SERVICES_SETTINGS: RemoteServicesSettings = {
  stt: {
    enabled: false,
    provider: "groq",
    model: "whisper-large-v3-turbo",
    baseUrl: "https://api.groq.com/openai/v1",
    timeoutMs: 30_000,
  },
  tts: {
    enabled: false,
    provider: "azure",
    region: "westeurope",
    voice: "es-ES-ElviraNeural",
    outputFormat: "riff-24khz-16bit-mono-pcm",
    timeoutMs: 30_000,
  },
};

export type RemoteServicesPatch = {
  stt?: Partial<Pick<RemoteSttSettings, "enabled" | "model">>;
  tts?: Partial<Pick<RemoteTtsSettings, "enabled" | "region" | "voice">>;
};

type EnvLike = Record<string, string | undefined>;

function readFlag(env: EnvLike, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  return raw !== "0" && raw !== "false" && raw !== "no";
}

function readInt(env: EnvLike, name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

/** Solo se aceptan los modelos que sabemos que existen y hablan castellano. */
export function normalizeGroqModel(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return GROQ_WHISPER_MODELS.some((model) => model.id === raw) ? raw : fallback;
}

export function normalizeAzureVoice(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  // Cualquier voz `es-ES-*` vale: Azure anade voces nuevas mas a menudo de lo
  // que se actualiza esta lista, pero el castellano no es negociable.
  return /^es-ES-[A-Za-z0-9:]+$/.test(raw) ? raw : fallback;
}

export function normalizeAzureRegion(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z]{2,}[a-z0-9]*$/.test(raw) ? raw : fallback;
}

/** Aplica un cambio del panel de ajustes sobre los valores actuales. */
export function mergeRemoteServicesSettings(
  current: RemoteServicesSettings,
  patch: RemoteServicesPatch | null | undefined,
): RemoteServicesSettings {
  return {
    stt: {
      ...current.stt,
      enabled: typeof patch?.stt?.enabled === "boolean" ? patch.stt.enabled : current.stt.enabled,
      model: patch?.stt?.model === undefined
        ? current.stt.model
        : normalizeGroqModel(patch.stt.model, current.stt.model),
    },
    tts: {
      ...current.tts,
      enabled: typeof patch?.tts?.enabled === "boolean" ? patch.tts.enabled : current.tts.enabled,
      region: patch?.tts?.region === undefined
        ? current.tts.region
        : normalizeAzureRegion(patch.tts.region, current.tts.region),
      voice: patch?.tts?.voice === undefined
        ? current.tts.voice
        : normalizeAzureVoice(patch.tts.voice, current.tts.voice),
    },
  };
}

/** Lee lo que se haya guardado en disco, descartando lo que no encaje. */
export function parseRemoteServicesSettings(raw: unknown): RemoteServicesSettings {
  const defaults = DEFAULT_REMOTE_SERVICES_SETTINGS;
  if (!raw || typeof raw !== "object") {
    return defaults;
  }

  const source = raw as { stt?: unknown; tts?: unknown };
  const stt = (source.stt ?? {}) as Record<string, unknown>;
  const tts = (source.tts ?? {}) as Record<string, unknown>;

  return mergeRemoteServicesSettings(defaults, {
    stt: {
      enabled: typeof stt.enabled === "boolean" ? stt.enabled : undefined,
      model: typeof stt.model === "string" ? stt.model : undefined,
    },
    tts: {
      enabled: typeof tts.enabled === "boolean" ? tts.enabled : undefined,
      region: typeof tts.region === "string" ? tts.region : undefined,
      voice: typeof tts.voice === "string" ? tts.voice : undefined,
    },
  });
}

/**
 * Las variables de entorno mandan sobre el fichero.
 *
 * Es la valvula de escape para fijar el modo desde la imagen o desde un
 * despliegue sin depender de que alguien pulse el interruptor.
 */
export function applyRemoteServicesEnv(
  settings: RemoteServicesSettings,
  env: EnvLike = process.env,
): RemoteServicesSettings {
  return {
    stt: {
      ...settings.stt,
      enabled: readFlag(env, "AGENOS_STT_REMOTE", settings.stt.enabled),
      model: normalizeGroqModel(env.AGENOS_STT_REMOTE_MODEL, settings.stt.model),
      baseUrl: env.AGENOS_STT_REMOTE_BASE_URL?.trim().replace(/\/+$/, "") || settings.stt.baseUrl,
      timeoutMs: readInt(env, "AGENOS_STT_REMOTE_TIMEOUT_MS", settings.stt.timeoutMs, 1_000, 120_000),
    },
    tts: {
      ...settings.tts,
      enabled: readFlag(env, "AGENOS_TTS_REMOTE", settings.tts.enabled),
      region: normalizeAzureRegion(env.AGENOS_TTS_REMOTE_REGION, settings.tts.region),
      voice: normalizeAzureVoice(env.AGENOS_TTS_REMOTE_VOICE, settings.tts.voice),
      outputFormat: env.AGENOS_TTS_REMOTE_FORMAT?.trim() || settings.tts.outputFormat,
      timeoutMs: readInt(env, "AGENOS_TTS_REMOTE_TIMEOUT_MS", settings.tts.timeoutMs, 1_000, 120_000),
    },
  };
}
