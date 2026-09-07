import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { createRemoteSecretsStore, type RemoteSecretName, type RemoteSecrets, type RemoteSecretsStore } from "./secrets";
import {
  applyRemoteServicesEnv,
  DEFAULT_REMOTE_SERVICES_SETTINGS,
  mergeRemoteServicesSettings,
  parseRemoteServicesSettings,
  type RemoteServicesPatch,
  type RemoteServicesSettings,
} from "./settings";

/**
 * Estado persistente del interruptor de servicios remotos.
 *
 * Electron no tenia hasta ahora ningun ajuste que sobreviviese al reinicio:
 * todo salia de variables de entorno leidas una sola vez al arrancar. Este
 * almacen es el primero, y por eso se queda pequeno a proposito: un JSON con
 * dos interruptores y sus parametros, mas el `secrets.env` de al lado.
 *
 * Precedencia al leer: valores por defecto, luego el fichero, luego el
 * entorno. El entorno gana para que una imagen pueda fijar el modo.
 */

export type RemoteServicesSnapshot = {
  settings: RemoteServicesSettings;
  secrets: RemoteSecrets;
};

/** Lo unico que cruza al renderer: sin claves, solo si estan puestas. */
export type RemoteServicesView = {
  stt: {
    enabled: boolean;
    model: string;
    keyConfigured: boolean;
    /** Falso si el interruptor esta puesto pero falta la clave. */
    active: boolean;
  };
  tts: {
    enabled: boolean;
    region: string;
    voice: string;
    keyConfigured: boolean;
    active: boolean;
  };
};

export type RemoteServicesStore = {
  path: string;
  secretsPath: string;
  read(): RemoteServicesSnapshot;
  update(patch: RemoteServicesPatch): RemoteServicesSnapshot;
  setSecret(name: RemoteSecretName, value: string | null): RemoteServicesSnapshot;
  describe(): RemoteServicesView;
  /** Avisa a quien haya que reconfigurar cuando cambia algo. */
  subscribe(listener: (snapshot: RemoteServicesSnapshot) => void): () => void;
};

export type RemoteServicesStoreOptions = {
  env?: Record<string, string | undefined>;
  settingsPath?: string;
  secrets?: RemoteSecretsStore;
  readFile?: (path: string) => string;
  writeFile?: (path: string, body: string) => void;
  fileExists?: (path: string) => boolean;
};

export function resolveRemoteSettingsPath(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.AGENOS_REMOTE_SETTINGS_PATH?.trim();
  if (configured) {
    return configured;
  }

  const stateDir = env.AGENOS_REMOTE_STATE_DIR?.trim() || join(homedir(), ".agenos", "remote");
  return join(stateDir, "services.json");
}

function defaultWriteFile(path: string, body: string): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);

  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, body, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
  chmodSync(path, 0o600);
}

/**
 * Un interruptor encendido sin clave no sirve para nada: sin ella la peticion
 * al servicio externo fallaria y nos quedariamos sin voz. En ese caso se sigue
 * usando el motor local y el panel lo dice.
 */
export function remoteSttIsActive(snapshot: RemoteServicesSnapshot): boolean {
  return snapshot.settings.stt.enabled && Boolean(snapshot.secrets.groqApiKey);
}

export function remoteTtsIsActive(snapshot: RemoteServicesSnapshot): boolean {
  return snapshot.settings.tts.enabled && Boolean(snapshot.secrets.azureSpeechKey);
}

export function describeRemoteServices(snapshot: RemoteServicesSnapshot): RemoteServicesView {
  return {
    stt: {
      enabled: snapshot.settings.stt.enabled,
      model: snapshot.settings.stt.model,
      keyConfigured: Boolean(snapshot.secrets.groqApiKey),
      active: remoteSttIsActive(snapshot),
    },
    tts: {
      enabled: snapshot.settings.tts.enabled,
      region: snapshot.settings.tts.region,
      voice: snapshot.settings.tts.voice,
      keyConfigured: Boolean(snapshot.secrets.azureSpeechKey),
      active: remoteTtsIsActive(snapshot),
    },
  };
}

export function createRemoteServicesStore(
  options: RemoteServicesStoreOptions = {},
): RemoteServicesStore {
  const env = options.env ?? process.env;
  const path = options.settingsPath ?? resolveRemoteSettingsPath(env);
  const fileExists = options.fileExists ?? existsSync;
  const readFile = options.readFile ?? ((target: string) => readFileSync(target, "utf8"));
  const writeFile = options.writeFile ?? defaultWriteFile;
  const secrets = options.secrets ?? createRemoteSecretsStore({ env });
  const listeners = new Set<(snapshot: RemoteServicesSnapshot) => void>();

  function readStored(): RemoteServicesSettings {
    if (!fileExists(path)) {
      return DEFAULT_REMOTE_SERVICES_SETTINGS;
    }

    try {
      return parseRemoteServicesSettings(JSON.parse(readFile(path)));
    } catch {
      // Un JSON corrupto no puede dejar la maquina sin voz: se cae a local.
      return DEFAULT_REMOTE_SERVICES_SETTINGS;
    }
  }

  function read(): RemoteServicesSnapshot {
    return {
      settings: applyRemoteServicesEnv(readStored(), env),
      secrets: secrets.read(),
    };
  }

  function notify(snapshot: RemoteServicesSnapshot): void {
    for (const listener of listeners) {
      listener(snapshot);
    }
  }

  function update(patch: RemoteServicesPatch): RemoteServicesSnapshot {
    // Se guarda lo que hay en el fichero, no lo que el entorno haya impuesto:
    // asi quitar la variable devuelve la eleccion del usuario tal cual estaba.
    const next = mergeRemoteServicesSettings(readStored(), patch);
    writeFile(path, `${JSON.stringify(next, null, 2)}\n`);

    const snapshot = read();
    notify(snapshot);
    return snapshot;
  }

  function setSecret(name: RemoteSecretName, value: string | null): RemoteServicesSnapshot {
    secrets.write(name, value);

    const snapshot = read();
    notify(snapshot);
    return snapshot;
  }

  return {
    path,
    secretsPath: secrets.path,
    read,
    update,
    setSecret,
    describe: () => describeRemoteServices(read()),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
