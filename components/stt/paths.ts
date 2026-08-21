import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Resolucion de binarios y modelos del STT local.
 *
 * El build escribe un manifiesto `stt.env` junto a los binarios con el nombre
 * exacto de los modelos que ha instalado. El runtime lo lee en vez de llevar su
 * propia lista: asi no puede pasar que el build empaquete `ggml-base-q5_1.bin` y
 * el runtime siga buscando `ggml-small.bin`, que es como se rompio la ultima vez.
 */

export type SttManifest = {
  engine: string | null;
  ref: string | null;
  buildProfile: string | null;
  model: string | null;
  vadModel: string | null;
  language: string | null;
};

export type SttPaths = {
  root: string | null;
  manifest: SttManifest;
  server: string | null;
  vadCapture: string | null;
  model: string | null;
  vadModel: string | null;
  recorder: string | null;
  ffmpeg: string | null;
  /** Lo que falta para poder transcribir, en castellano y listo para mostrar. */
  missing: string[];
};

export type SttPathsOptions = {
  env?: Record<string, string | undefined>;
  /** Raices adicionales, en orden de preferencia (Electron pasa las suyas). */
  extraRoots?: string[];
  pathExists?: (path: string) => boolean;
  readFile?: (path: string) => string;
  readCpuInfo?: () => string;
  platform?: NodeJS.Platform;
  arch?: string;
};

const SYSTEM_ROOTS = ["/opt/agenos/system/whisper.cpp"];

const RECORDER_CANDIDATES = ["/usr/bin/arecord", "/bin/arecord", "/usr/local/bin/arecord"];

const FFMPEG_CANDIDATES = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"];

/** El binario SIMD asume estas extensiones; sin ellas hay que usar el baseline. */
const REQUIRED_SIMD_FLAGS = ["sse4_2", "avx", "avx2", "fma", "f16c", "bmi2"];

/** Fallback historico por si el manifiesto no viaja en la imagen. */
export const FALLBACK_WHISPER_MODEL = "ggml-base-q5_1.bin";
export const FALLBACK_VAD_MODEL = "ggml-silero-v5.1.2.bin";

export function parseSttManifest(contents: string): SttManifest {
  const values = new Map<string, string>();

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator > 0) {
      values.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
    }
  }

  return {
    engine: values.get("engine") ?? null,
    ref: values.get("ref") ?? null,
    buildProfile: values.get("build_profile") ?? null,
    model: values.get("model") ?? null,
    vadModel: values.get("vad_model") ?? null,
    language: values.get("language") ?? null,
  };
}

const EMPTY_MANIFEST: SttManifest = {
  engine: null,
  ref: null,
  buildProfile: null,
  model: null,
  vadModel: null,
  language: null,
};

export function resolveSttPaths(options: SttPathsOptions = {}): SttPaths {
  const env = options.env ?? process.env;
  const pathExists = options.pathExists ?? existsSync;
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  const readCpuInfo = options.readCpuInfo ?? (() => readFileSync("/proc/cpuinfo", "utf8"));
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;

  const firstExisting = (candidates: Array<string | null | undefined>): string | null => {
    for (const candidate of candidates) {
      if (candidate && pathExists(candidate)) {
        return candidate;
      }
    }
    return null;
  };

  const supportsSimd = (): boolean => {
    if (env.AGENOS_STT_FORCE_BASELINE?.trim() === "1") {
      return false;
    }
    if (platform !== "linux" || arch !== "x64") {
      return true;
    }

    try {
      const flagsLine = readCpuInfo()
        .toLowerCase()
        .split(/\r?\n/)
        .find((line) => line.startsWith("flags"));
      const flags = new Set((flagsLine?.split(":")[1] ?? "").trim().split(/\s+/));
      return REQUIRED_SIMD_FLAGS.every((flag) => flags.has(flag));
    } catch {
      // Si no se puede leer /proc/cpuinfo, el binario SIMD es la apuesta razonable.
      return true;
    }
  };

  const roots = [
    env.AGENOS_WHISPER_DIR?.trim() || null,
    ...(options.extraRoots ?? []),
    ...SYSTEM_ROOTS,
  ].filter((value): value is string => Boolean(value));

  const root = firstExisting(roots);
  const manifest = (() => {
    if (!root) {
      return EMPTY_MANIFEST;
    }
    const manifestPath = resolve(root, "stt.env");
    if (!pathExists(manifestPath)) {
      return EMPTY_MANIFEST;
    }
    try {
      return parseSttManifest(readFile(manifestPath));
    } catch {
      return EMPTY_MANIFEST;
    }
  })();

  const variants = supportsSimd() ? ["", "-baseline"] : ["-baseline", ""];

  const resolveBinary = (name: string, override: string | undefined): string | null => {
    const configured = override?.trim();
    if (configured) {
      return pathExists(configured) ? configured : null;
    }
    if (!root) {
      return null;
    }
    return firstExisting(variants.map((suffix) => resolve(root, `${name}${suffix}`)));
  };

  const resolveModel = (override: string | undefined, declared: string | null, fallback: string): string | null => {
    const configured = override?.trim();
    if (configured) {
      return pathExists(configured) ? resolve(configured) : null;
    }
    if (!root) {
      return null;
    }
    // El nombre declarado por el build manda; el fallback solo cubre imagenes
    // viejas sin manifiesto.
    return firstExisting([
      declared ? resolve(root, "models", declared) : null,
      declared ? null : resolve(root, "models", fallback),
    ]);
  };

  const server = resolveBinary("whisper-server", env.AGENOS_WHISPER_SERVER_BIN);
  const vadCapture = resolveBinary("agenos-vad-capture", env.AGENOS_STT_VAD_CAPTURE_BIN);
  const model = resolveModel(env.AGENOS_WHISPER_MODEL, manifest.model, FALLBACK_WHISPER_MODEL);
  const vadModel = resolveModel(env.AGENOS_STT_VAD_MODEL, manifest.vadModel, FALLBACK_VAD_MODEL);

  const configuredRecorder = env.AGENOS_STT_RECORDER_BIN?.trim();
  const recorder = configuredRecorder
    ? (pathExists(configuredRecorder) ? configuredRecorder : null)
    : firstExisting(RECORDER_CANDIDATES);

  const configuredFfmpeg = env.AGENOS_FFMPEG_BIN?.trim();
  const ffmpeg = configuredFfmpeg
    ? (pathExists(configuredFfmpeg) ? configuredFfmpeg : null)
    : firstExisting(FFMPEG_CANDIDATES);

  const missing: string[] = [];
  if (!server) {
    missing.push("whisper-server");
  }
  if (!model) {
    missing.push(`modelo ${manifest.model ?? FALLBACK_WHISPER_MODEL}`);
  }
  if (!vadModel) {
    missing.push(`modelo VAD ${manifest.vadModel ?? FALLBACK_VAD_MODEL}`);
  }

  return { root, manifest, server, vadCapture, model, vadModel, recorder, ffmpeg, missing };
}
