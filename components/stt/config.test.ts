import { describe, expect, test } from "bun:test";

import { DEFAULT_STT_SETTINGS, resolveLanguage, resolveSttSettings, sttServerBaseUrl } from "./config";

describe("resolveSttSettings", () => {
  test("sin entorno usa la configuracion objetivo de AgenOS", () => {
    const settings = resolveSttSettings({});

    expect(settings.language).toBe("es");
    expect(settings.threads).toBe(4);
    expect(settings.beamSize).toBe(5);
    expect(settings.bestOf).toBe(5);
    expect(settings.suppressNonSpeech).toBe(true);
    // Contexto completo: nada de -ac por defecto.
    expect(settings.audioContext).toBe(0);
    expect(settings.maxDurationMs).toBe(15_000);
    expect(settings.silenceMs).toBe(650);
  });

  test("las variables de entorno mueven modelo, idioma, hilos, beam, best-of, dispositivo y duracion", () => {
    const settings = resolveSttSettings({
      AGENOS_STT_LANGUAGE: "gl",
      AGENOS_STT_THREADS: "2",
      AGENOS_STT_BEAM_SIZE: "3",
      AGENOS_STT_BEST_OF: "2",
      AGENOS_STT_ALSA_DEVICE: "hw:1,0",
      AGENOS_STT_MAX_SECONDS: "8",
      AGENOS_STT_SILENCE_MS: "900",
    });

    expect(settings.language).toBe("gl");
    expect(settings.threads).toBe(2);
    expect(settings.beamSize).toBe(3);
    expect(settings.bestOf).toBe(2);
    expect(settings.captureDevice).toBe("hw:1,0");
    expect(settings.maxDurationMs).toBe(8_000);
    expect(settings.silenceMs).toBe(900);
  });

  test("un valor absurdo se recorta en vez de tumbar el arranque", () => {
    expect(resolveSttSettings({ AGENOS_STT_THREADS: "999" }).threads).toBe(16);
    expect(resolveSttSettings({ AGENOS_STT_BEAM_SIZE: "0" }).beamSize).toBe(1);
    expect(resolveSttSettings({ AGENOS_STT_MAX_SECONDS: "no" }).maxDurationMs).toBe(15_000);
  });

  test("el idioma nunca se autodetecta", () => {
    expect(resolveLanguage("auto", "es")).toBe("es");
    expect(resolveLanguage(undefined, "es")).toBe("es");
    expect(resolveLanguage("  ", "es")).toBe("es");
    expect(resolveLanguage("es-ES", "es")).toBe("es");
    expect(resolveLanguage("EN_us", "es")).toBe("en");
  });
});

describe("sttServerBaseUrl", () => {
  test("por defecto solo escucha en loopback", () => {
    expect(sttServerBaseUrl(DEFAULT_STT_SETTINGS, {})).toBe("http://127.0.0.1:8178");
  });

  test("una URL configurada manda y pierde la barra final", () => {
    expect(sttServerBaseUrl(DEFAULT_STT_SETTINGS, { AGENOS_STT_SERVER_URL: "http://127.0.0.1:9000/" }))
      .toBe("http://127.0.0.1:9000");
  });
});
