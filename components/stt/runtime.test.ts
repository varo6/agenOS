import { describe, expect, test } from "bun:test";

import type { RemoteServicesSnapshot, RemoteServicesStore } from "../remote";
import { DEFAULT_REMOTE_SERVICES_SETTINGS } from "../remote";
import { createSttRuntime } from "./runtime";

/**
 * Almacen de mentira con el interruptor en la mano: permite mover el conmutador
 * a mitad de un test y ver como reacciona el runtime.
 */
function fakeStore(initial: { sttEnabled?: boolean; key?: string | null } = {}) {
  let snapshot: RemoteServicesSnapshot = {
    settings: {
      ...DEFAULT_REMOTE_SERVICES_SETTINGS,
      stt: { ...DEFAULT_REMOTE_SERVICES_SETTINGS.stt, enabled: initial.sttEnabled ?? false },
    },
    secrets: { groqApiKey: initial.key ?? null, azureSpeechKey: null },
  };
  const listeners = new Set<(next: RemoteServicesSnapshot) => void>();

  const store = {
    path: "/tmp/services.json",
    secretsPath: "/tmp/secrets.env",
    read: () => snapshot,
    update: () => snapshot,
    setSecret: () => snapshot,
    describe: () => ({}) as never,
    subscribe(listener: (next: RemoteServicesSnapshot) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as RemoteServicesStore;

  return {
    store,
    set(sttEnabled: boolean, key: string | null = initial.key ?? "gsk_prueba") {
      snapshot = {
        settings: {
          ...snapshot.settings,
          stt: { ...snapshot.settings.stt, enabled: sttEnabled },
        },
        secrets: { ...snapshot.secrets, groqApiKey: key },
      };
      for (const listener of listeners) listener(snapshot);
    },
  };
}

const ENV = { AGENOS_STT_ENGINE: "whisper.cpp" };

describe("createSttRuntime", () => {
  test("sin interruptor remoto se comporta como siempre", () => {
    const runtime = createSttRuntime({ env: ENV });
    expect(runtime.activeEngine()).toBe("whisper.cpp");
    expect(runtime.engine.status().engine).toBe("whisper.cpp");
  });

  test("con el interruptor y la clave puestos transcribe por Groq", async () => {
    const { store } = fakeStore({ sttEnabled: true, key: "gsk_prueba" });
    let called = false;
    const runtime = createSttRuntime({
      env: ENV,
      remote: store,
      fetchFn: (async () => {
        called = true;
        return new Response(JSON.stringify({ text: "hola" }), {
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });

    expect(runtime.activeEngine()).toBe("groq");
    expect((await runtime.engine.transcribeWav(new Uint8Array([1]))).text).toBe("hola");
    expect(called).toBe(true);
  });

  test("el interruptor sin clave se queda en local", () => {
    const { store } = fakeStore({ sttEnabled: true, key: null });
    const runtime = createSttRuntime({ env: ENV, remote: store });
    expect(runtime.activeEngine()).toBe("whisper.cpp");
  });

  test("encender la nube libera el motor local", () => {
    const controller = fakeStore();
    const logs: string[] = [];
    const runtime = createSttRuntime({ env: ENV, remote: controller.store, logger: (m) => logs.push(m) });

    // Basta con mirar el estado para que el motor local exista.
    expect(runtime.engine.status().engine).toBe("whisper.cpp");
    controller.set(true);

    expect(logs.some((line) => line.includes("libera el motor local"))).toBe(true);
    expect(runtime.activeEngine()).toBe("groq");
  });

  test("volver a local rehace el motor en vez de reusar el ya cerrado", async () => {
    const controller = fakeStore();
    const runtime = createSttRuntime({ env: ENV, remote: controller.store });

    runtime.engine.status();
    controller.set(true);
    controller.set(false);

    // El motor cerrado responderia "ya se ha cerrado". Uno recien creado se
    // queja de que faltan los binarios, que es lo correcto en este entorno.
    await expect(runtime.engine.ensureReady()).rejects.toThrow(/no disponible/);
  });

  test("cancelar no resucita un motor que no existia", () => {
    const { store } = fakeStore({ sttEnabled: true, key: "gsk_prueba" });
    const runtime = createSttRuntime({ env: ENV, remote: store });
    expect(() => runtime.engine.cancelPending?.()).not.toThrow();
  });

  test("cerrar el runtime deja de aceptar trabajo", async () => {
    const { store } = fakeStore();
    const runtime = createSttRuntime({ env: ENV, remote: store });
    runtime.engine.dispose();
    await expect(runtime.engine.ensureReady()).rejects.toThrow(/ya se ha cerrado/);
  });
});
