import { existsSync } from "node:fs";

export type TtsPaths = {
  engine: "espeak-ng";
  binary: string | null;
  /**
   * `aplay` reproduce el WAV que devuelve el TTS remoto. No entra en `missing`:
   * un equipo sin el sigue hablando por espeak-ng, que escribe directamente al
   * servidor de sonido y no necesita reproductor.
   */
  player: string | null;
  missing: string[];
};

export type TtsPathsOptions = {
  env?: Record<string, string | undefined>;
  pathExists?: (path: string) => boolean;
};

const ESPEAK_CANDIDATES = ["/usr/bin/espeak-ng", "/bin/espeak-ng", "/usr/local/bin/espeak-ng"];
const PLAYER_CANDIDATES = ["/usr/bin/aplay", "/bin/aplay", "/usr/local/bin/aplay"];

export function resolveTtsPaths(options: TtsPathsOptions = {}): TtsPaths {
  const env = options.env ?? process.env;
  const pathExists = options.pathExists ?? existsSync;

  const firstExisting = (candidates: Array<string | null | undefined>): string | null => {
    for (const candidate of candidates) {
      if (candidate && pathExists(candidate)) {
        return candidate;
      }
    }
    return null;
  };

  const configured = env.AGENOS_TTS_BIN?.trim();
  const binary = configured
    ? (pathExists(configured) ? configured : null)
    : firstExisting(ESPEAK_CANDIDATES);

  const configuredPlayer = env.AGENOS_TTS_PLAYER_BIN?.trim();
  const player = configuredPlayer
    ? (pathExists(configuredPlayer) ? configuredPlayer : null)
    : firstExisting(PLAYER_CANDIDATES);

  return {
    engine: "espeak-ng",
    binary,
    player,
    missing: binary ? [] : ["espeak-ng"],
  };
}
