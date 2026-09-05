import { remoteSttIsActive, type RemoteServicesSnapshot, type RemoteServicesStore } from "../remote";
import { resolveSttSettings, sttServerBaseUrl, type SttSettings } from "./config";
import { createWhisperEngine, WhisperEngineError, type SttEngineName, type WhisperEngine } from "./engine";
import { createGroqEngine } from "./remote-engine";
import { createVoxtypeEngine } from "./voxtype-engine";
import { resolveSttPaths, type SttPaths } from "./paths";

/**
 * Punto de entrada unico del STT.
 *
 * Tanto el proceso principal de Electron como el servidor HTTP construyen su
 * runtime desde aqui y usan el mismo motor seleccionado.
 *
 * Cuando se pasa un almacen de servicios remotos, `engine` deja de ser un motor
 * y pasa a ser un delegador: su identidad no cambia nunca, pero cada llamada
 * mira el interruptor y va al motor local o a Groq. Asi encender la nube desde
 * los ajustes libera el proceso de Voxtype sin reiniciar la aplicacion, que es
 * justo lo que se buscaba: recuperar la CPU del equipo.
 */

export type SttRuntime = {
  settings: SttSettings;
  paths: SttPaths;
  engine: WhisperEngine;
  baseUrl: string;
  /** Motor que atendera la proxima transcripcion. */
  activeEngine(): SttEngineName;
};

export type SttRuntimeOptions = {
  env?: Record<string, string | undefined>;
  /** Raices donde buscar los binarios ademas de /opt/agenos/system/whisper.cpp. */
  extraRoots?: string[];
  logger?: (message: string) => void;
  /** Interruptor de servicios remotos. Sin el solo existe el motor local. */
  remote?: RemoteServicesStore;
  fetchFn?: typeof fetch;
};

export function createSttRuntime(options: SttRuntimeOptions = {}): SttRuntime {
  const env = options.env ?? process.env;
  const settings = resolveSttSettings(env);
  const paths = resolveSttPaths({ env, extraRoots: options.extraRoots });
  const baseUrl = sttServerBaseUrl(settings, env);
  const log = options.logger ?? (() => {});

  const makeLocalEngine = (): WhisperEngine => (settings.engine === "voxtype"
    ? createVoxtypeEngine({ settings, paths, env, logger: options.logger })
    : createWhisperEngine({ settings, paths, baseUrl, env, logger: options.logger }));

  // Sin interruptor remoto el runtime es exactamente el de siempre: un unico
  // motor local construido al arrancar y nada que vigilar.
  if (!options.remote) {
    const engine = makeLocalEngine();
    return { settings, paths, engine, baseUrl, activeEngine: () => engine.status().engine };
  }

  const store = options.remote;
  let localEngine: WhisperEngine | null = null;
  let remoteEngine: WhisperEngine | null = null;
  /** Clave y modelo se capturan al construir, asi que un cambio obliga a rehacerlo. */
  let remoteFingerprint = "";
  let disposed = false;

  function fingerprintOf(snapshot: RemoteServicesSnapshot): string {
    return `${snapshot.secrets.groqApiKey ?? ""}|${snapshot.settings.stt.model}|${snapshot.settings.stt.baseUrl}`;
  }

  function getLocal(): WhisperEngine {
    // Se rehace bajo demanda porque `dispose()` es terminal en los dos motores
    // locales: una vez cerrados no vuelven a transcribir.
    if (!localEngine) {
      localEngine = makeLocalEngine();
    }

    return localEngine;
  }

  function getRemote(snapshot: RemoteServicesSnapshot): WhisperEngine {
    const fingerprint = fingerprintOf(snapshot);
    if (!remoteEngine || fingerprint !== remoteFingerprint) {
      remoteEngine = createGroqEngine({
        settings,
        remote: snapshot.settings.stt,
        apiKey: snapshot.secrets.groqApiKey,
        fetchFn: options.fetchFn,
        logger: options.logger,
      });
      remoteFingerprint = fingerprint;
    }

    return remoteEngine;
  }

  function select(): WhisperEngine {
    if (disposed) {
      throw new WhisperEngineError("unavailable", "El motor de STT ya se ha cerrado.");
    }

    const snapshot = store.read();
    return remoteSttIsActive(snapshot) ? getRemote(snapshot) : getLocal();
  }

  // Soltar el motor local en el momento del cambio y no en la siguiente
  // transcripcion es lo que hace util el interruptor: si el usuario enciende la
  // nube para aligerar el equipo, Voxtype tiene que morir ya.
  store.subscribe((snapshot) => {
    if (disposed) {
      return;
    }

    if (remoteSttIsActive(snapshot)) {
      if (localEngine) {
        log("Se pasa a dictado en la nube (Groq). Se libera el motor local.");
        localEngine.dispose();
        localEngine = null;
      }
      return;
    }

    if (remoteEngine) {
      log("Se vuelve al dictado del equipo.");
      remoteEngine.dispose();
      remoteEngine = null;
      remoteFingerprint = "";
    }
  });

  const engine: WhisperEngine = {
    status: () => select().status(),
    // `async` a proposito: `select()` lanza si el runtime esta cerrado, y quien
    // llama espera una promesa rechazada, no una excepcion sincrona.
    async ensureReady() {
      return select().ensureReady();
    },
    async transcribeWav(wav, transcribeOptions) {
      return select().transcribeWav(wav, transcribeOptions);
    },
    cancelPending() {
      // Sin `select()`: cancelar no debe resucitar un motor que no existia.
      localEngine?.cancelPending?.();
      remoteEngine?.cancelPending?.();
    },
    dispose() {
      disposed = true;
      localEngine?.dispose();
      localEngine = null;
      remoteEngine?.dispose();
      remoteEngine = null;
    },
  };

  return {
    settings,
    paths,
    engine,
    baseUrl,
    activeEngine: () => (remoteSttIsActive(store.read()) ? "groq" : settings.engine),
  };
}
