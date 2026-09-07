import { describe, expect, test } from "bun:test";

import { DEFAULT_REMOTE_SERVICES_SETTINGS, type RemoteServicesSnapshot, type RemoteServicesStore } from "../remote";
import { DEFAULT_TTS_SETTINGS } from "./config";
import type { TtsPaths } from "./paths";
import { createTtsService } from "./service";

const PATHS: TtsPaths = { engine: "espeak-ng", binary: "/usr/bin/espeak-ng", player: "/usr/bin/aplay", missing: [] };

function fakeStore(enabled = false, key: string | null = null) {
  let snapshot: RemoteServicesSnapshot = {
    settings: {
      ...DEFAULT_REMOTE_SERVICES_SETTINGS,
      tts: { ...DEFAULT_REMOTE_SERVICES_SETTINGS.tts, enabled },
    },
    secrets: { groqApiKey: null, azureSpeechKey: key },
  };
  const listeners = new Set<(next: RemoteServicesSnapshot) => void>();

  const store = {
    read: () => snapshot,
    subscribe(listener: (next: RemoteServicesSnapshot) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as RemoteServicesStore;

  return {
    store,
    set(nextEnabled: boolean, nextKey: string | null = "clave") {
      snapshot = {
        settings: { ...snapshot.settings, tts: { ...snapshot.settings.tts, enabled: nextEnabled } },
        secrets: { ...snapshot.secrets, azureSpeechKey: nextKey },
      };
      for (const listener of listeners) listener(snapshot);
    },
  };
}

describe("createTtsService", () => {
  test("sin interruptor remoto es el servicio local de siempre", () => {
    const service = createTtsService({ settings: DEFAULT_TTS_SETTINGS, paths: PATHS });
    expect(service.status().engine).toBe("espeak-ng");
  });

  test("apagado habla el equipo", () => {
    const { store } = fakeStore(false);
    const service = createTtsService({ settings: DEFAULT_TTS_SETTINGS, paths: PATHS, remote: store });
    expect(service.status().engine).toBe("espeak-ng");
  });

  test("encendido y con clave habla Azure", () => {
    const { store } = fakeStore(true, "clave");
    const service = createTtsService({ settings: DEFAULT_TTS_SETTINGS, paths: PATHS, remote: store });
    expect(service.status().engine).toBe("azure");
    expect(service.status().voice).toBe("es-ES-ElviraNeural");
  });

  test("encendido sin clave se queda en el equipo", () => {
    const { store } = fakeStore(true, null);
    const service = createTtsService({ settings: DEFAULT_TTS_SETTINGS, paths: PATHS, remote: store });
    expect(service.status().engine).toBe("espeak-ng");
  });

  test("cambiar de motor a mitad de una lectura calla al anterior", () => {
    const controller = fakeStore();
    const logs: string[] = [];
    const service = createTtsService({
      settings: DEFAULT_TTS_SETTINGS,
      paths: PATHS,
      remote: controller.store,
      logger: (message) => logs.push(message),
    });

    controller.set(true);
    expect(service.status().engine).toBe("azure");
    expect(logs.some((line) => line.includes("nube"))).toBe(true);

    controller.set(false, null);
    expect(service.status().engine).toBe("espeak-ng");
    expect(logs.some((line) => line.includes("equipo"))).toBe(true);
  });

  test("parar no lanza aunque no haya nada hablando", () => {
    const { store } = fakeStore(true, "clave");
    const service = createTtsService({ settings: DEFAULT_TTS_SETTINGS, paths: PATHS, remote: store });
    expect(() => service.stop()).not.toThrow();
    expect(service.isSpeaking()).toBe(false);
  });
});

describe("createTtsService y los cambios ajenos", () => {
  test("un cambio que no afecta a la voz no corta la lectura", () => {
    const controller = fakeStore(true, "clave");
    const logs: string[] = [];
    const service = createTtsService({
      settings: DEFAULT_TTS_SETTINGS,
      paths: PATHS,
      remote: controller.store,
      logger: (message) => logs.push(message),
    });

    // Mismo destino que ya estaba: tocar el dictado no debe mover nada aqui.
    controller.set(true, "clave");
    expect(logs).toEqual([]);
    expect(service.status().engine).toBe("azure");
  });
});
