import { describe, expect, test } from "bun:test";

import { normalizeCommand, summarize, wordErrorCount } from "./evaluate";

describe("metricas STT", () => {
  test("normaliza mayusculas, puntuacion y tildes", () => {
    expect(normalizeCommand("¡Ábreme Fotos! ")).toBe("abreme fotos");
  });

  test("calcula errores de palabra y coincidencia exacta", () => {
    expect(wordErrorCount("abre fotos", "abre las fotos")).toBe(1);
    const report = summarize([
      { wavPath: "a.wav", expected: "abre fotos", actual: "abre fotos", silence: false, readyMs: 10, finalMs: 20, peakRssKb: 100, idleRssKb: 0, error: null },
      { wavPath: "s.wav", expected: "", actual: "gracias", silence: true, readyMs: 12, finalMs: 22, peakRssKb: 110, idleRssKb: 0, error: null },
    ]);
    expect(report.normalizedWer).toBe(0);
    expect(report.exactCommandMatchRate).toBe(1);
    expect(report.silenceHallucinations).toBe(1);
    expect(report.peakWorkerRssKb).toBe(110);
  });
});
