import { describe, expect, test } from "bun:test";

import { createRemoteServicesStore } from "./store";
import { createRemoteSecretsStore } from "./secrets";
import { applyRemoteServicesEnv, DEFAULT_REMOTE_SERVICES_SETTINGS, parseRemoteServicesSettings } from "./settings";

function memoryStore(initial: Record<string, string> = {}, env: Record<string, string | undefined> = {}) {
  const files = { ...initial };
  const secrets = createRemoteSecretsStore({
    env,
    secretsPath: "/tmp/secrets.env",
    fileExists: (path) => path in files,
    readFile: (path) => files[path] ?? "",
    writeFile: (path, body) => { files[path] = body; },
  });

  return {
    files,
    store: createRemoteServicesStore({
      env,
      settingsPath: "/tmp/services.json",
      secrets,
      fileExists: (path) => path in files,
      readFile: (path) => files[path] ?? "",
      writeFile: (path, body) => { files[path] = body; },
    }),
  };
}

describe("createRemoteServicesStore", () => {
  test("arranca en local con todo apagado", () => {
    const { store } = memoryStore();
    expect(store.describe()).toEqual({
      stt: { enabled: false, model: "whisper-large-v3-turbo", keyConfigured: false, active: false },
      tts: { enabled: false, region: "westeurope", voice: "es-ES-ElviraNeural", keyConfigured: false, active: false },
    });
  });

  test("un interruptor encendido sin clave no activa el servicio", () => {
    const { store } = memoryStore();
    const view = store.update({ stt: { enabled: true } });
    expect(view.settings.stt.enabled).toBe(true);
    expect(store.describe().stt.active).toBe(false);
  });

  test("con clave e interruptor el servicio queda activo", () => {
    const { store } = memoryStore();
    store.update({ stt: { enabled: true } });
    store.setSecret("groqApiKey", "gsk_prueba");
    expect(store.describe().stt).toEqual({
      enabled: true, model: "whisper-large-v3-turbo", keyConfigured: true, active: true,
    });
  });

  test("la vista redactada nunca lleva la clave", () => {
    const { store } = memoryStore();
    store.setSecret("azureSpeechKey", "secreto-de-azure");
    expect(JSON.stringify(store.describe())).not.toContain("secreto-de-azure");
  });

  test("guardar una cadena vacia borra la clave", () => {
    const { store } = memoryStore();
    store.setSecret("groqApiKey", "gsk_prueba");
    expect(store.describe().stt.keyConfigured).toBe(true);
    store.setSecret("groqApiKey", null);
    expect(store.describe().stt.keyConfigured).toBe(false);
  });

  test("avisa a los suscriptores en cada cambio", () => {
    const { store } = memoryStore();
    const seen: boolean[] = [];
    store.subscribe((snapshot) => seen.push(snapshot.settings.tts.enabled));
    store.update({ tts: { enabled: true } });
    store.update({ tts: { enabled: false } });
    expect(seen).toEqual([true, false]);
  });

  test("un JSON corrupto cae a local en vez de dejar el equipo mudo", () => {
    const { store } = memoryStore({ "/tmp/services.json": "{ esto no es json" });
    expect(store.describe().stt.enabled).toBe(false);
  });

  test("no persiste modelos ni voces que no existen", () => {
    const { store } = memoryStore();
    store.update({ stt: { model: "modelo-inventado" }, tts: { voice: "en-US-JennyNeural" } });
    const view = store.describe();
    expect(view.stt.model).toBe("whisper-large-v3-turbo");
    // Solo castellano: una voz en ingles no puede colarse.
    expect(view.tts.voice).toBe("es-ES-ElviraNeural");
  });

  test("el entorno manda sobre el fichero pero no lo reescribe", () => {
    const { store, files } = memoryStore({}, { AGENOS_STT_REMOTE: "1" });
    expect(store.read().settings.stt.enabled).toBe(true);
    store.update({ tts: { enabled: true } });
    expect(JSON.parse(files["/tmp/services.json"]).stt.enabled).toBe(false);
  });
});

describe("settings", () => {
  test("la clave del entorno gana a la del fichero", () => {
    const files: Record<string, string> = { "/tmp/secrets.env": "AGENOS_GROQ_API_KEY=del-fichero\n" };
    const secrets = createRemoteSecretsStore({
      env: { AGENOS_GROQ_API_KEY: "del-entorno" },
      secretsPath: "/tmp/secrets.env",
      fileExists: (path) => path in files,
      readFile: (path) => files[path] ?? "",
      writeFile: (path, body) => { files[path] = body; },
    });
    expect(secrets.read().groqApiKey).toBe("del-entorno");
  });

  test("parseRemoteServicesSettings descarta lo que no encaja", () => {
    expect(parseRemoteServicesSettings({ stt: { enabled: "si" } })).toEqual(DEFAULT_REMOTE_SERVICES_SETTINGS);
    expect(parseRemoteServicesSettings(null)).toEqual(DEFAULT_REMOTE_SERVICES_SETTINGS);
  });

  test("applyRemoteServicesEnv respeta los limites del timeout", () => {
    const applied = applyRemoteServicesEnv(DEFAULT_REMOTE_SERVICES_SETTINGS, {
      AGENOS_STT_REMOTE_TIMEOUT_MS: "999999",
    });
    expect(applied.stt.timeoutMs).toBe(120_000);
  });
});
