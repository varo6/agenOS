import { describe, expect, test } from "bun:test";
import { createTtsNarrator } from "./tts-narrator";
import type { PiSpeechMessage, PiTurnState } from "./pi-types";
import type { TextToSpeechOutcome } from "./tts-bridge";

const now = Date.parse("2026-09-09T12:00:00Z");
function message(id: number, text: string, complete = false, afterTools = 0): PiSpeechMessage {
  return { id, text, complete, afterTools };
}
function turn(messages: PiSpeechMessage[], status: PiTurnState["status"] = "processing", tools: string[] = [], id = "t1"): PiTurnState {
  return { turnId: id, status, source: "voice", input: "Abre el informe", startedAt: new Date(now + 1).toISOString(),
    finishedAt: status === "processing" ? undefined : new Date(now + 1000).toISOString(),
    reply: messages.map((m) => m.text).join(""),
    progress: { startedAt: new Date(now + 1).toISOString(), streamedText: "NO LEER EL STREAM GENERAL", currentTool: null, currentToolMessage: "NO LEER LA TOOL", completedTools: tools, speechMessages: messages },
  };
}
function fixture() {
  const spoken: string[] = [];
  const pending: Array<(outcome: TextToSpeechOutcome) => void> = [];
  const states: boolean[] = [];
  let stops = 0;
  const narrator = createTtsNarrator({ mountedAt: now, onSpeaking: (value) => states.push(value), getBridge: () => ({
    isAvailable: () => true, status: async () => ({ available: true, engine: "espeak-ng", voice: "es", reason: null }),
    speak: (text) => { spoken.push(text); return new Promise((resolve) => pending.push(resolve)); },
    stop: async () => { stops++; },
  }) });
  narrator.update([]);
  return { narrator, spoken, states, stops: () => stops, async finish(outcome: TextToSpeechOutcome = { ok: true, engine: "espeak-ng", voice: "es" }) {
    pending.shift()?.(outcome);
    for (let i = 0; i < 6; i++) await Promise.resolve();
  } };
}

describe("narración procedural", () => {
  test("habla una frase mientras el agente sigue trabajando y no repite al terminar", async () => {
    const f = fixture();
    f.narrator.update([turn([message(1, "Voy a buscar")])]);
    expect(f.spoken).toEqual([]);
    const intro = message(1, "Voy a buscar el archivo.", true);
    f.narrator.update([turn([intro])]);
    expect(f.spoken).toEqual([intro.text]);
    f.narrator.update([turn([intro], "processing", ["files_manage"])]);
    const result = message(2, "Archivo abierto.", true, 1);
    f.narrator.update([turn([intro, result], "processing", ["files_manage"])]);
    expect(f.spoken).toHaveLength(1);
    await f.finish();
    expect(f.spoken).toEqual([intro.text, result.text]);
    f.narrator.update([turn([intro, result], "succeeded", ["files_manage"])]);
    await f.finish();
    expect(f.spoken).toHaveLength(2);
    expect(f.states.at(-1)).toBe(false);
  });

  test("si solo llega el turno terminado, omite anuncios anteriores y tools", () => {
    const f = fixture();
    f.narrator.update([turn([message(1, "Voy a buscar.", true), message(2, "Abierto.", true, 1)], "succeeded", ["files_open"])]);
    expect(f.spoken).toEqual(["Abierto."]);
  });

  test("elimina de la cola frases atrasadas cuando acaba la herramienta", async () => {
    const f = fixture();
    const intro = message(1, "Voy a buscar. Revisaré tus carpetas.", true);
    f.narrator.update([turn([intro])]);
    f.narrator.update([turn([intro], "processing", ["files_manage"])]);
    await f.finish();
    expect(f.spoken).toEqual(["Voy a buscar."]);
  });

  test("lee varias frases en orden sin solapamiento ni duplicados por sondeo", async () => {
    const f = fixture();
    const first = turn([message(1, "Primera frase. Segunda")]);
    f.narrator.update([first]);
    f.narrator.update([first]);
    f.narrator.update([turn([message(1, "Primera frase. Segunda frase.")])]);
    expect(f.spoken).toEqual(["Primera frase."]);
    await f.finish();
    expect(f.spoken).toEqual(["Primera frase.", "Segunda frase."]);
    f.narrator.update([turn([message(1, "Primera frase. Segunda frase. Último fragmento", true)], "succeeded")]);
    await f.finish();
    expect(f.spoken).toEqual(["Primera frase.", "Segunda frase.", "Último fragmento"]);
  });

  test("parar silencia el resto del turno, pero permite hablar en el siguiente", async () => {
    const f = fixture();
    f.narrator.update([turn([message(1, "Buscando. Más información.")])]);
    f.narrator.stop();
    f.narrator.update([turn([message(2, "Abierto.", true, 1)], "succeeded", ["files_open"])]);
    await f.finish();
    expect(f.stops()).toBe(1);
    expect(f.spoken).toEqual(["Buscando."]);
    f.narrator.update([turn([message(1, "Nueva petición.", true)], "processing", [], "t2")]);
    expect(f.spoken).toEqual(["Buscando.", "Nueva petición."]);
  });

  for (const status of ["cancelled", "failed"] as const) {
    test(`${status} detiene el audio y vacía las frases pendientes`, async () => {
      const f = fixture();
      f.narrator.update([turn([message(1, "Buscando. Otra frase.")])]);
      f.narrator.update([turn([message(1, "Buscando. Otra frase.")], status)]);
      await f.finish();
      expect(f.stops()).toBe(1);
      expect(f.spoken).toEqual(["Buscando."]);
    });
  }

  test("un fallo del motor no repite frases ni sigue lanzando síntesis", async () => {
    const f = fixture();
    f.narrator.update([turn([message(1, "Primera. Segunda.")])]);
    await f.finish({ ok: false, code: "synthesis-failed", message: "No audio" });
    f.narrator.update([turn([message(2, "Final.", true)], "succeeded")]);
    expect(f.spoken).toEqual(["Primera."]);
  });

  test("restaurar un turno activo no relee el mensaje antiguo, sí los nuevos", async () => {
    const f = fixture();
    const old = turn([message(1, "Ya lo estaba buscando.", true)]);
    old.startedAt = new Date(now - 1000).toISOString();
    f.narrator.update([old]);
    expect(f.spoken).toEqual([]);
    f.narrator.update([{ ...old, progress: { ...old.progress, completedTools: ["files_open"], speechMessages: [message(1, "Ya lo estaba buscando.", true), message(2, "Abierto.", true, 1)] } }]);
    expect(f.spoken).toEqual(["Abierto."]);
  });

  test("no convierte un resultado de tool en narración si no hay texto del asistente", () => {
    const f = fixture();
    f.narrator.update([{ ...turn([], "succeeded"), reply: '{"tool":"files_open","secret":"hidden"}' }]);
    expect(f.spoken).toEqual([]);
  });

  test("vaciar la conversación corta el audio y la cola", async () => {
    const f = fixture();
    f.narrator.update([turn([message(1, "Primera. Segunda.")])]);
    f.narrator.update([]);
    await f.finish();
    expect(f.stops()).toBe(1);
    expect(f.spoken).toEqual(["Primera."]);
  });

  test("un turno nuevo interrumpe el anterior y su callback tardío no para la nueva voz", async () => {
    const f = fixture();
    f.narrator.update([turn([message(1, "Primera. Frase antigua pendiente.")])]);
    f.narrator.update([turn([message(1, "Respuesta nueva.", true)], "processing", [], "t2")]);
    await f.finish();
    expect(f.stops()).toBe(1);
    expect(f.spoken).toEqual(["Primera.", "Respuesta nueva."]);
    expect(f.states.at(-1)).toBe(true);
    await f.finish();
    expect(f.states.at(-1)).toBe(false);
  });

  test("desmontar el narrador impide reproducir la cola al terminar una síntesis", async () => {
    const f = fixture();
    f.narrator.update([turn([message(1, "Primera. Segunda.")])]);
    f.narrator.dispose();
    await f.finish();
    expect(f.stops()).toBe(1);
    expect(f.spoken).toEqual(["Primera."]);
  });
});
