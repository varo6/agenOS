import { resolveSttSettings, sttServerBaseUrl, type SttSettings } from "./config";
import { createWhisperEngine, type WhisperEngine } from "./engine";
import { createVoxtypeEngine } from "./voxtype-engine";
import { resolveSttPaths, type SttPaths } from "./paths";

/**
 * Punto de entrada unico del STT local.
 *
 * Tanto el proceso principal de Electron como el servidor HTTP construyen su
 * runtime desde aqui y usan el mismo motor seleccionado.
 */

export type SttRuntime = {
  settings: SttSettings;
  paths: SttPaths;
  engine: WhisperEngine;
  baseUrl: string;
};

export type SttRuntimeOptions = {
  env?: Record<string, string | undefined>;
  /** Raices donde buscar los binarios ademas de /opt/agenos/system/whisper.cpp. */
  extraRoots?: string[];
  logger?: (message: string) => void;
};

export function createSttRuntime(options: SttRuntimeOptions = {}): SttRuntime {
  const env = options.env ?? process.env;
  const settings = resolveSttSettings(env);
  const paths = resolveSttPaths({ env, extraRoots: options.extraRoots });
  const baseUrl = sttServerBaseUrl(settings, env);
  const engine = settings.engine === "voxtype"
    ? createVoxtypeEngine({ settings, paths, env, logger: options.logger })
    : createWhisperEngine({ settings, paths, baseUrl, env, logger: options.logger });

  return { settings, paths, engine, baseUrl };
}
