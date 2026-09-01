import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Claves de los servicios remotos de voz.
 *
 * Se guardan igual que el resto de secretos del sistema: un `secrets.env` con
 * permisos 0600 dentro de un directorio 0700, escrito de forma atomica. La
 * clave nunca vuelve al renderer; la interfaz solo llega a saber si esta
 * puesta o no.
 *
 * La variable de entorno gana al fichero para que una imagen pueda traer la
 * clave inyectada sin reescribir el estado del usuario.
 */

export type RemoteSecretName = "groqApiKey" | "azureSpeechKey";

export type RemoteSecrets = {
  groqApiKey: string | null;
  azureSpeechKey: string | null;
};

const ENV_NAMES: Record<RemoteSecretName, string> = {
  groqApiKey: "AGENOS_GROQ_API_KEY",
  azureSpeechKey: "AGENOS_AZURE_SPEECH_KEY",
};

export const REMOTE_SECRET_ENV_NAMES = ENV_NAMES;

export type RemoteSecretsStoreOptions = {
  env?: Record<string, string | undefined>;
  /** Ruta del `secrets.env`. Por defecto `~/.agenos/remote/secrets.env`. */
  secretsPath?: string;
  readFile?: (path: string) => string;
  writeFile?: (path: string, body: string) => void;
  fileExists?: (path: string) => boolean;
};

export type RemoteSecretsStore = {
  path: string;
  read(): RemoteSecrets;
  /** `null` o cadena vacia borran la clave del fichero. */
  write(name: RemoteSecretName, value: string | null): void;
};

export function resolveRemoteSecretsPath(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.AGENOS_REMOTE_SECRETS_PATH?.trim();
  if (configured) {
    return configured;
  }

  const stateDir = env.AGENOS_REMOTE_STATE_DIR?.trim() || join(homedir(), ".agenos", "remote");
  return join(stateDir, "secrets.env");
}

/** Formato `CLAVE=valor`, una por linea, ignorando comentarios y vacios. */
export function parseSecretsFile(body: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    entries[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }

  return entries;
}

export function serializeSecretsFile(entries: Record<string, string>): string {
  const lines = Object.entries(entries)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`);

  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function defaultWriteFile(path: string, body: string): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);

  // Temporal mas rename: si el proceso muere a medias no queda un fichero de
  // secretos truncado.
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, body, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
  chmodSync(path, 0o600);
}

export function createRemoteSecretsStore(
  options: RemoteSecretsStoreOptions = {},
): RemoteSecretsStore {
  const env = options.env ?? process.env;
  const path = options.secretsPath ?? resolveRemoteSecretsPath(env);
  const fileExists = options.fileExists ?? existsSync;
  const readFile = options.readFile ?? ((target: string) => readFileSync(target, "utf8"));
  const writeFile = options.writeFile ?? defaultWriteFile;

  function readEntries(): Record<string, string> {
    if (!fileExists(path)) {
      return {};
    }

    try {
      return parseSecretsFile(readFile(path));
    } catch {
      return {};
    }
  }

  function read(): RemoteSecrets {
    const entries = readEntries();
    const resolve = (name: RemoteSecretName): string | null => {
      const envName = ENV_NAMES[name];
      return env[envName]?.trim() || entries[envName]?.trim() || null;
    };

    return {
      groqApiKey: resolve("groqApiKey"),
      azureSpeechKey: resolve("azureSpeechKey"),
    };
  }

  function write(name: RemoteSecretName, value: string | null): void {
    const entries = readEntries();
    const envName = ENV_NAMES[name];
    const trimmed = value?.trim() ?? "";

    if (trimmed) {
      entries[envName] = trimmed;
    } else {
      delete entries[envName];
    }

    writeFile(path, serializeSecretsFile(entries));
  }

  return { path, read, write };
}
