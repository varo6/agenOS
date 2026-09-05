/**
 * Ajustes del TTS local.
 *
 * La primera implementacion usa un binario nativo empaquetado por la distro
 * (`espeak-ng`). No hay servidor ni runtime Python: Electron lanza el proceso
 * solo cuando hay una respuesta nueva que leer.
 */

/**
 * Motores capaces de leer una respuesta. `espeak-ng` es el de siempre y corre
 * en local; `azure` solo entra si el usuario enciende el servicio remoto.
 */
export type TtsEngineName = "espeak-ng" | "azure";

export type TtsSettings = {
  voice: string;
  rate: number;
  pitch: number;
  amplitude: number;
  maxChars: number;
};

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  voice: "es",
  rate: 165,
  pitch: 45,
  amplitude: 140,
  maxChars: 4_000,
};

type EnvLike = Record<string, string | undefined>;

function readInt(env: EnvLike, name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

export function resolveTtsSettings(env: EnvLike = process.env): TtsSettings {
  const defaults = DEFAULT_TTS_SETTINGS;

  return {
    voice: env.AGENOS_TTS_VOICE?.trim() || defaults.voice,
    rate: readInt(env, "AGENOS_TTS_RATE", defaults.rate, 80, 450),
    pitch: readInt(env, "AGENOS_TTS_PITCH", defaults.pitch, 0, 99),
    amplitude: readInt(env, "AGENOS_TTS_AMPLITUDE", defaults.amplitude, 0, 200),
    maxChars: readInt(env, "AGENOS_TTS_MAX_CHARS", defaults.maxChars, 250, 20_000),
  };
}
