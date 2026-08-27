import { describe, expect, test } from "bun:test";

import { DEFAULT_STT_SETTINGS, resolveSttSettings, sttServerBaseUrl } from "./config";

describe("resolveSttSettings", () => {
  test("sin entorno usa la configuracion objetivo de AgenOS", () => {
    const settings = resolveSttSettings({});

    expect(settings.engine).toBe("voxtype");
    expect(settings.language).toBe("es");
    expect(settings.initialPrompt).toContain("AgenOS");
    expect(settings.threads).toBe(4);
    expect(settings.fallbackBeamSize).toBe(5);
    expect(settings.fallbackBestOf).toBe(5);
    expect(settings.fallbackSuppressNonSpeech).toBe(true);
    // Contexto completo: nada de -ac por defecto.
    expect(settings.fallbackAudioContext).toBe(0);
    expect(settings.maxDurationMs).toBe(15_000);
    expect(settings.silenceMs).toBe(650);
  });

  test("whisper.cpp queda disponible como fallback explicito", () => {
    expect(resolveSttSettings({ AGENOS_STT_ENGINE: "whisper.cpp" }).engine).toBe("whisper.cpp");
    expect(resolveSttSettings({ AGENOS_STT_ENGINE: "desconocido" }).engine).toBe("voxtype");
  });

  test("el idioma sigue fijo y las variables separan el fallback de la captura", () => {
    const settings = resolveSttSettings({
      AGENOS_STT_LANGUAGE: "gl",
      AGENOS_STT_THREADS: "2",
      AGENOS_STT_FALLBACK_BEAM_SIZE: "3",
      AGENOS_STT_FALLBACK_BEST_OF: "2",
      AGENOS_STT_ALSA_DEVICE: "hw:1,0",
      AGENOS_STT_MAX_SECONDS: "8",
      AGENOS_STT_SILENCE_MS: "900",
    });

    expect(settings.language).toBe("es");
    expect(settings.threads).toBe(2);
    expect(settings.fallbackBeamSize).toBe(3);
    expect(settings.fallbackBestOf).toBe(2);
    expect(settings.captureDevice).toBe("hw:1,0");
    expect(settings.maxDurationMs).toBe(8_000);
    expect(settings.silenceMs).toBe(900);
  });

  test("un valor absurdo se recorta en vez de tumbar el arranque", () => {
    expect(resolveSttSettings({ AGENOS_STT_THREADS: "999" }).threads).toBe(16);
    expect(resolveSttSettings({ AGENOS_STT_FALLBACK_BEAM_SIZE: "0" }).fallbackBeamSize).toBe(1);
    expect(resolveSttSettings({ AGENOS_STT_MAX_SECONDS: "no" }).maxDurationMs).toBe(15_000);
  });

  test("las variables antiguas del fallback ya no cambian Voxtype", () => {
    const settings = resolveSttSettings({ AGENOS_STT_BEAM_SIZE: "1", AGENOS_STT_SERVER_PORT: "9999" });
    expect(settings.fallbackBeamSize).toBe(5);
    expect(settings.fallbackServerPort).toBe(8178);
  });
});

describe("sttServerBaseUrl", () => {
  test("por defecto solo escucha en loopback", () => {
    expect(sttServerBaseUrl(DEFAULT_STT_SETTINGS, {})).toBe("http://127.0.0.1:8178");
  });

  test("una URL configurada manda y pierde la barra final", () => {
    expect(sttServerBaseUrl(DEFAULT_STT_SETTINGS, { AGENOS_STT_FALLBACK_SERVER_URL: "http://127.0.0.1:9000/" }))
      .toBe("http://127.0.0.1:9000");
  });
});
