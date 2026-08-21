import { resolveSttSettings, sttServerBaseUrl, type SttSettings } from "./config";
import { createWhisperEngine, type WhisperEngine } from "./engine";
import { resolveSttPaths, type SttPaths } from "./paths";

/**
 * Punto de entrada unico del STT local.
 *
 * Tanto el proceso principal de Electron como el servidor HTTP construyen su
 * runtime desde aqui, con los mismos ajustes y contra el mismo whisper-server.
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
  const engine = createWhisperEngine({ settings, paths, baseUrl, env, logger: options.logger });

  return { settings, paths, engine, baseUrl };
}
