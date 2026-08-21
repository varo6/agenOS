import { resolveTtsSettings, type TtsSettings } from "./config";
import { resolveTtsPaths, type TtsPaths } from "./paths";

export type TtsRuntime = {
  settings: TtsSettings;
  paths: TtsPaths;
};

export type TtsRuntimeOptions = {
  env?: Record<string, string | undefined>;
};

export function createTtsRuntime(options: TtsRuntimeOptions = {}): TtsRuntime {
  const env = options.env ?? process.env;

  return {
    settings: resolveTtsSettings(env),
    paths: resolveTtsPaths({ env }),
  };
}
