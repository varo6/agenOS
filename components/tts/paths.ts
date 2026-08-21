import { existsSync } from "node:fs";

export type TtsPaths = {
  engine: "espeak-ng";
  binary: string | null;
  missing: string[];
};

export type TtsPathsOptions = {
  env?: Record<string, string | undefined>;
  pathExists?: (path: string) => boolean;
};

const ESPEAK_CANDIDATES = ["/usr/bin/espeak-ng", "/bin/espeak-ng", "/usr/local/bin/espeak-ng"];

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

  return {
    engine: "espeak-ng",
    binary,
    missing: binary ? [] : ["espeak-ng"],
  };
}
