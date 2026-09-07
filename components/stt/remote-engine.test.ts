import { describe, expect, test } from "bun:test";

import { DEFAULT_REMOTE_SERVICES_SETTINGS } from "../remote";
import { DEFAULT_STT_SETTINGS } from "./config";
import { WhisperEngineError } from "./engine";
import { createGroqEngine } from "./remote-engine";

const REMOTE = DEFAULT_REMOTE_SERVICES_SETTINGS.stt;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function engineWith(fetchFn: typeof fetch, apiKey: string | null = "gsk_prueba") {
  return createGroqEngine({ settings: DEFAULT_STT_SETTINGS, remote: REMOTE, apiKey, fetchFn });
}

describe("createGroqEngine", () => {
  test("sube el WAV con el modelo, el idioma y el vocabulario de AgenOS", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const engine = engineWith((async (target: string, options: RequestInit) => {
      url = target;
      init = options;
      return jsonResponse({ text: "abre el navegador" });
    }) as unknown as typeof fetch);

    const result = await engine.transcribeWav(new Uint8Array([1, 2, 3]));

    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer gsk_prueba");

    const form = init?.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("language")).toBe("es");
    expect(form.get("response_format")).toBe("json");
    expect(form.get("temperature")).toBe("0");
    expect(form.get("prompt")).toBe(DEFAULT_STT_SETTINGS.initialPrompt);
    expect(result.text).toBe("abre el navegador");
    expect(result.language).toBe("es");
  });

  test("sin clave no esta disponible y no llega a llamar a nadie", async () => {
    let called = false;
    const engine = engineWith((async () => {
      called = true;
      return jsonResponse({});
    }) as unknown as typeof fetch, null);

    expect(engine.status().available).toBe(false);
    expect(engine.status().reason).toContain("Groq");

    await expect(engine.transcribeWav(new Uint8Array([1]))).rejects.toMatchObject({ code: "unavailable" });
    expect(called).toBe(false);
  });

  test("no depende de que haya modelo instalado en el equipo", () => {
    const status = engineWith((async () => jsonResponse({ text: "" })) as unknown as typeof fetch).status();
    expect(status.available).toBe(true);
    expect(status.vadModel).toBeNull();
    expect(status.engine).toBe("groq");
  });

  test("una clave rechazada es un problema de configuracion, no de transcripcion", async () => {
    const engine = engineWith((async () => (
      jsonResponse({ error: { message: "Invalid API Key" } }, 401)
    )) as unknown as typeof fetch);

    await expect(engine.transcribeWav(new Uint8Array([1]))).rejects.toMatchObject({ code: "unavailable" });
  });

  test("el limite de peticiones dice cuando reintentar", async () => {
    const engine = engineWith((async () => (
      jsonResponse({ error: { message: "rate limited" } }, 429, { "retry-after": "12" })
    )) as unknown as typeof fetch);

    await expect(engine.transcribeWav(new Uint8Array([1]))).rejects.toThrow(/12 s/);
  });

  test("un fallo de red no se confunde con una cancelacion", async () => {
    const engine = engineWith((async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch);

    await expect(engine.transcribeWav(new Uint8Array([1]))).rejects.toMatchObject({
      code: "transcription-failed",
    });
  });

  test("cancelar la captura resuelve como cancelacion", async () => {
    const controller = new AbortController();
    const engine = engineWith((async () => {
      controller.abort();
      throw new Error("The operation was aborted");
    }) as unknown as typeof fetch);

    await expect(
      engine.transcribeWav(new Uint8Array([1]), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "cancelled" });
  });

  test("limpia las etiquetas de no-habla igual que el motor local", async () => {
    const engine = engineWith((async () => (
      jsonResponse({ text: "[Música] sube el volumen" })
    )) as unknown as typeof fetch);

    expect((await engine.transcribeWav(new Uint8Array([1]))).text).toBe("sube el volumen");
  });

  test("rechaza un audio que pasa del tope de Groq sin subirlo", async () => {
    let called = false;
    const engine = engineWith((async () => {
      called = true;
      return jsonResponse({});
    }) as unknown as typeof fetch);

    await expect(
      engine.transcribeWav(new Uint8Array(26 * 1024 * 1024)),
    ).rejects.toBeInstanceOf(WhisperEngineError);
    expect(called).toBe(false);
  });

  test("cerrar el motor remoto se puede repetir sin romper nada", () => {
    const engine = engineWith((async () => jsonResponse({})) as unknown as typeof fetch);
    expect(() => { engine.dispose(); engine.dispose(); }).not.toThrow();
  });
});
