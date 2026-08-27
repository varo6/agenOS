import { describe, expect, test } from "bun:test";

import { DEFAULT_STT_SETTINGS, type SttSettings } from "./config";
import {
  createWhisperEngine,
  inferenceFields,
  normalizeWhisperTranscript,
  whisperServerArgs,
} from "./engine";
import type { SttPaths } from "./paths";

const PATHS: SttPaths = {
  root: "/opt/agenos/system/whisper.cpp",
  manifest: {
    engine: "whisper.cpp",
    ref: "v1.7.6",
    voxtypeRef: "v0.7.5",
    buildProfile: "static-simd-plus-baseline-x86_64-v2-server-vad",
    model: "ggml-base-q5_1.bin",
    vadModel: "ggml-silero-v5.1.2.bin",
    language: "es",
  },
  server: "/opt/agenos/system/whisper.cpp/whisper-server",
  voxtype: "/opt/agenos/system/whisper.cpp/voxtype",
  vadCapture: "/opt/agenos/system/whisper.cpp/agenos-vad-capture",
  model: "/opt/agenos/system/whisper.cpp/models/ggml-base-q5_1.bin",
  vadModel: "/opt/agenos/system/whisper.cpp/models/ggml-silero-v5.1.2.bin",
  recorder: "/usr/bin/arecord",
  ffmpeg: "/usr/bin/ffmpeg",
  missing: [],
};

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function engineWith(fetchFn: typeof fetch, settings: SttSettings = DEFAULT_STT_SETTINGS) {
  return createWhisperEngine({
    settings,
    paths: PATHS,
    baseUrl: "http://127.0.0.1:8178",
    fetchFn,
    env: {},
    sleep: async () => {},
  });
}

describe("whisperServerArgs", () => {
  test("arranca con la configuracion objetivo", () => {
    const args = whisperServerArgs(DEFAULT_STT_SETTINGS, PATHS);

    expect(flag(args, "-l")).toBe("es");
    expect(flag(args, "-t")).toBe("4");
    expect(flag(args, "-bs")).toBe("5");
    expect(flag(args, "-bo")).toBe("5");
    expect(args).toContain("--suppress-nst");
    expect(args).toContain("--vad");
    expect(flag(args, "-vm")).toBe(PATHS.vadModel as string);
    // Contexto completo y con marcas de tiempo: ni -ac ni -nt.
    expect(args).not.toContain("-ac");
    expect(args).not.toContain("-nt");
  });

  test("solo escucha en loopback", () => {
    expect(flag(whisperServerArgs(DEFAULT_STT_SETTINGS, PATHS), "--host")).toBe("127.0.0.1");
  });

  test("no pasa los flags de VAD rotos de whisper.cpp v1.7.6", () => {
    const args = whisperServerArgs(DEFAULT_STT_SETTINGS, PATHS);

    expect(args).not.toContain("-vsd");
    expect(args).not.toContain("--vad-min-silence-duration-ms");
  });
});

describe("inferenceFields", () => {
  test("cada peticion lleva los mismos parametros que el arranque", () => {
    const fields = inferenceFields(DEFAULT_STT_SETTINGS, 0);

    expect(fields.language).toBe("es");
    expect(fields.beam_size).toBe("5");
    expect(fields.best_of).toBe("5");
    expect(fields.suppress_nst).toBe("true");
    expect(fields.audio_ctx).toBe("0");
    expect(fields.no_timestamps).toBe("false");
    expect(fields.vad).toBe("true");
    expect(fields.vad_min_silence_duration_ms).toBe("650");
  });
});

describe("normalizeWhisperTranscript", () => {
  test("quita marcas de tiempo y junta lineas", () => {
    const text = "[00:00:00.000 --> 00:00:02.000]  Abre el navegador\n[00:00:02.000 --> 00:00:03.000]  y busca el tiempo.";

    expect(normalizeWhisperTranscript(text)).toBe("Abre el navegador y busca el tiempo.");
  });

  test("una linea que solo es una etiqueta de no-habla se descarta", () => {
    expect(normalizeWhisperTranscript("[BLANK_AUDIO]")).toBe("");
    expect(normalizeWhisperTranscript("(Ruido de fondo)")).toBe("");
    expect(normalizeWhisperTranscript("[Pausa]\n[MUSIC]")).toBe("");
  });

  test("el silencio devuelve cadena vacia, nunca una frase inventada", () => {
    expect(normalizeWhisperTranscript("")).toBe("");
    expect(normalizeWhisperTranscript("\n\n")).toBe("");
  });
});

describe("createWhisperEngine", () => {
  test("dos transcripciones seguidas reutilizan el mismo servidor", async () => {
    const calls: string[] = [];
    const engine = engineWith((async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/inference")) {
        return new Response(JSON.stringify({ text: " hola que tal\n" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("ok");
    }) as unknown as typeof fetch);

    const first = await engine.transcribeWav(new Uint8Array([1, 2, 3]));
    const second = await engine.transcribeWav(new Uint8Array([1, 2, 3]));

    expect(first.text).toBe("hola que tal");
    expect(second.text).toBe("hola que tal");
    // Ninguna llamada arranco un proceso nuevo: solo sondas y dos inferencias.
    expect(calls.filter((url) => url.endsWith("/inference"))).toHaveLength(2);
  });

  test("silencio en el servidor se traduce en texto vacio", async () => {
    const engine = engineWith((async (input: string | URL | Request) => (
      String(input).endsWith("/inference")
        ? new Response(JSON.stringify({ text: "" }))
        : new Response("ok")
    )) as unknown as typeof fetch);

    expect((await engine.transcribeWav(new Uint8Array([1]))).text).toBe("");
  });

  test("sin modelo el motor se declara no disponible en vez de intentarlo", async () => {
    const engine = createWhisperEngine({
      settings: DEFAULT_STT_SETTINGS,
      paths: { ...PATHS, model: null, missing: ["modelo ggml-base-q5_1.bin"] },
      baseUrl: "http://127.0.0.1:8178",
      fetchFn: (async () => {
        throw new Error("sin servidor");
      }) as unknown as typeof fetch,
      env: {},
      sleep: async () => {},
    });

    expect(engine.status().available).toBe(false);
    await expect(engine.transcribeWav(new Uint8Array([1]))).rejects.toThrow(/no disponible/);
  });

  test("con autoarranque desactivado y servidor caido falla claro", async () => {
    const engine = engineWith(
      (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
      { ...DEFAULT_STT_SETTINGS, fallbackServerAutostart: false },
    );

    await expect(engine.transcribeWav(new Uint8Array([1]))).rejects.toThrow(/no responde/);
  });
});
