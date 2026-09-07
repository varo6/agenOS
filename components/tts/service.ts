import { remoteTtsIsActive, type RemoteServicesSnapshot, type RemoteServicesStore } from "../remote";
import type { TtsSettings } from "./config";
import { createLocalTtsService, type LocalTtsOptions, type LocalTtsService } from "./local-tts";
import type { TtsPaths } from "./paths";
import { createWavPlayer, type WavPlayer, type WavPlayerOptions } from "./player";
import { createAzureTtsService } from "./remote-tts";

/**
 * Elige quien lee la respuesta: espeak-ng en el equipo o Azure en la nube.
 *
 * El objeto que devuelve no cambia de identidad nunca, asi que Electron puede
 * guardarselo al arrancar y seguir llamandolo igual aunque el usuario cambie el
 * interruptor a mitad de una conversacion.
 */

export type TtsServiceOptions = {
  settings: TtsSettings;
  paths: TtsPaths;
  /** Interruptor de servicios remotos. Sin el solo habla el motor local. */
  remote?: RemoteServicesStore;
  fetchFn?: typeof fetch;
  /** Inyectables para probar el ciclo sin espeak-ng ni tarjeta de sonido. */
  spawnFn?: LocalTtsOptions["spawnFn"];
  playerSpawnFn?: WavPlayerOptions["spawnFn"];
  logger?: (message: string) => void;
};

export function createTtsService(options: TtsServiceOptions): LocalTtsService {
  const { settings, paths } = options;
  const log = options.logger ?? (() => {});
  const local = createLocalTtsService(settings, paths, { spawnFn: options.spawnFn });

  if (!options.remote) {
    return local;
  }

  const store = options.remote;
  const player: WavPlayer = createWavPlayer({ paths, spawnFn: options.playerSpawnFn });
  let azure: LocalTtsService | null = null;
  /** Clave, voz y region se capturan al construir: si cambian, hay que rehacerlo. */
  let azureFingerprint = "";

  function fingerprintOf(snapshot: RemoteServicesSnapshot): string {
    const tts = snapshot.settings.tts;
    return `${snapshot.secrets.azureSpeechKey ?? ""}|${tts.region}|${tts.voice}|${tts.outputFormat}`;
  }

  function getAzure(snapshot: RemoteServicesSnapshot): LocalTtsService {
    const fingerprint = fingerprintOf(snapshot);
    if (!azure || fingerprint !== azureFingerprint) {
      azure = createAzureTtsService({
        remote: snapshot.settings.tts,
        apiKey: snapshot.secrets.azureSpeechKey,
        player,
        maxChars: settings.maxChars,
        fetchFn: options.fetchFn,
        logger: options.logger,
      });
      azureFingerprint = fingerprint;
    }

    return azure;
  }

  function select(): LocalTtsService {
    const snapshot = store.read();
    return remoteTtsIsActive(snapshot) ? getAzure(snapshot) : local;
  }

  let usingRemote = remoteTtsIsActive(store.read());

  store.subscribe((snapshot) => {
    const nextRemote = remoteTtsIsActive(snapshot);
    // El almacen avisa de cualquier cambio, tambien de los del dictado. Sin
    // esta comparacion, tocar el interruptor del microfono cortaria la
    // respuesta que se estuviera leyendo en ese momento.
    if (nextRemote === usingRemote) {
      return;
    }

    usingRemote = nextRemote;

    // Cambiar de motor mientras se esta leyendo dejaria una voz hablando sola.
    local.stop();
    player.stop();
    azure?.stop();

    if (nextRemote) {
      log("Se pasa a voz en la nube (Azure).");
      return;
    }

    log("Se vuelve a la voz del equipo.");
    azure = null;
    azureFingerprint = "";
  });

  return {
    status: () => select().status(),
    speak: (text) => select().speak(text),
    stop() {
      // Se paran los dos sin preguntar: si el interruptor acaba de cambiar, el
      // que sigue hablando es justo el que `select()` ya no devuelve.
      local.stop();
      azure?.stop();
      player.stop();
    },
    isSpeaking: () => local.isSpeaking() || Boolean(azure?.isSpeaking()) || player.isPlaying(),
  };
}
