import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";

import { DEFAULT_STT_SETTINGS } from "../../../../stt/config";
import { WhisperEngineError, type TranscribeWavResult, type WhisperEngine } from "../../../../stt/engine";
import type { SttPaths } from "../../../../stt/paths";
import type { SttRuntime } from "../../../../stt/runtime";
import { createSttService, detectAudioFormat, ffmpegArgs, type SttCommandRunner } from "./stt";

const ROOT = "/opt/agenos/system/whisper.cpp";

const PATHS: SttPaths = {
  root: ROOT,
  manifest: {
    engine: "whisper.cpp",
    ref: "v1.7.6",
    buildProfile: "static-simd-plus-baseline-x86_64-v2-server-vad",
    model: "ggml-base-q5_1.bin",
    vadModel: "ggml-silero-v5.1.2.bin",
    language: "es",
  },
  server: `${ROOT}/whisper-server`,
  vadCapture: `${ROOT}/agenos-vad-capture`,
  model: `${ROOT}/models/ggml-base-q5_1.bin`,
  vadModel: `${ROOT}/models/ggml-silero-v5.1.2.bin`,
  recorder: "/usr/bin/arecord",
  ffmpeg: "/usr/bin/ffmpeg",
  missing: [],
};

type RecordedCall = { command: string; args: string[] };

type FakeRuntimeOptions = {
  text?: string;
  paths?: Partial<SttPaths>;
  transcribeError?: Error;
};

function wavBytes(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8);
  return bytes;
}

function fakeRuntime(options: FakeRuntimeOptions = {}) {
  const requests: Array<{ wav: Uint8Array; language: string | undefined }> = [];
  const paths: SttPaths = { ...PATHS, ...options.paths };
  const missing = paths.missing ?? [];

  const engine: WhisperEngine = {
    status: () => ({
      available: missing.length === 0,
      reason: missing.length === 0 ? null : `STT local no disponible: falta ${missing.join(" y ")}.`,
      model: paths.model,
      vadModel: paths.vadModel,
      baseUrl: "http://127.0.0.1:8178",
      engine: "whisper.cpp",
    }),
    ensureReady: async () => {},
    transcribeWav: async (wav, transcribeOptions): Promise<TranscribeWavResult> => {
      if (options.transcribeError) {
        throw options.transcribeError;
      }
      requests.push({ wav, language: transcribeOptions?.language });
      return {
        text: options.text ?? "abre el navegador",
        durationMs: 900,
        model: paths.model as string,
        language: transcribeOptions?.language ?? "es",
      };
    },
    dispose: () => {},
  };

  const runtime: SttRuntime = {
    settings: DEFAULT_STT_SETTINGS,
    paths,
    engine,
    baseUrl: "http://127.0.0.1:8178",
  };

  return { runtime, requests };
}

function recordingRunner(calls: RecordedCall[]): SttCommandRunner {
  return async (command, args) => {
    calls.push({ command, args });
    // ffmpeg tiene que dejar el wav donde el servicio lo va a leer.
    await Bun.write(args[args.length - 1], wavBytes());
    return { stdout: "", stderr: "" };
  };
}

function serviceWith(runtime: SttRuntime, runCommand?: SttCommandRunner) {
  return createSttService({ env: {}, runtime, runCommand, tempDir: tmpdir() });
}

describe("detectAudioFormat", () => {
  test("acepta lo que graba el navegador y rechaza el resto", () => {
    expect(detectAudioFormat("audio/wav")).toBe("wav");
    expect(detectAudioFormat("audio/webm;codecs=opus")).toBe("webm");
    expect(detectAudioFormat("application/ogg")).toBe("ogg");
    expect(detectAudioFormat("audio/mpeg")).toBeNull();
    expect(detectAudioFormat("")).toBeNull();
  });
});

describe("ffmpegArgs", () => {
  test("convierte a 16 kHz mono y aplica el tope de duracion", () => {
    const args = ffmpegArgs("/tmp/in.webm", "/tmp/out.wav", 15_000);

    expect(args[args.indexOf("-ar") + 1]).toBe("16000");
    expect(args[args.indexOf("-ac") + 1]).toBe("1");
    expect(args[args.indexOf("-t") + 1]).toBe("15.000");
  });
});

describe("createSttService.status", () => {
  test("una instalacion completa se anuncia disponible con su tope", () => {
    const { runtime } = fakeRuntime();
    const status = serviceWith(runtime).status();

    expect(status.available).toBe(true);
    expect(status.engine).toBe("whisper.cpp");
    expect(status.model).toBe(PATHS.model);
    expect(status.maxDurationMs).toBe(15_000);
  });

  test("si falta el modelo lo dice por su nombre", () => {
    const { runtime } = fakeRuntime({ paths: { model: null, missing: ["modelo ggml-base-q5_1.bin"] } });
    const status = serviceWith(runtime).status();

    expect(status.available).toBe(false);
    expect(status.reason).toContain("ggml-base-q5_1.bin");
  });
});

describe("createSttService.transcribe", () => {
  test("un wav va directo al motor residente, en espanol", async () => {
    const { runtime, requests } = fakeRuntime();
    const calls: RecordedCall[] = [];

    const result = await serviceWith(runtime, recordingRunner(calls)).transcribe({
      audio: wavBytes(),
      contentType: "audio/wav",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("abre el navegador");
      expect(result.engine).toBe("whisper.cpp");
    }
    // Un wav no necesita ffmpeg.
    expect(calls).toHaveLength(0);
    expect(requests[0].language).toBe("es");
  });

  test("el webm del navegador pasa por ffmpeg antes del motor", async () => {
    const { runtime, requests } = fakeRuntime();
    const calls: RecordedCall[] = [];

    const result = await serviceWith(runtime, recordingRunner(calls)).transcribe({
      audio: new Uint8Array([1, 2, 3]),
      contentType: "audio/webm;codecs=opus",
    });

    expect(result.ok).toBe(true);
    expect(calls[0].command).toBe("/usr/bin/ffmpeg");
    expect(calls[0].args).toContain("16000");
    expect(requests).toHaveLength(1);
  });

  test("`auto` y una etiqueta regional acaban en el idioma fijo", async () => {
    const { runtime, requests } = fakeRuntime();
    const service = serviceWith(runtime);

    await service.transcribe({ audio: wavBytes(), contentType: "audio/wav", lang: "auto" });
    await service.transcribe({ audio: wavBytes(), contentType: "audio/wav", lang: "es-ES" });

    expect(requests.map((request) => request.language)).toEqual(["es", "es"]);
  });

  test("silencio y ruido bajo devuelven no-speech en vez de texto inventado", async () => {
    const { runtime } = fakeRuntime({ text: "" });

    const result = await serviceWith(runtime).transcribe({
      audio: wavBytes(),
      contentType: "audio/wav",
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe("no-speech");
    }
  });

  test("un formato que no se puede convertir se rechaza sin tocar el motor", async () => {
    const { runtime, requests } = fakeRuntime();

    const result = await serviceWith(runtime).transcribe({
      audio: new Uint8Array([1]),
      contentType: "audio/mpeg",
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe("unsupported-media");
    }
    expect(requests).toHaveLength(0);
  });

  test("sin ffmpeg no se puede aceptar webm", async () => {
    const { runtime } = fakeRuntime({ paths: { ffmpeg: null } });

    const result = await serviceWith(runtime).transcribe({
      audio: new Uint8Array([1]),
      contentType: "audio/webm",
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe("unavailable");
    }
  });

  test("un motor caido se reporta como no disponible, no como fallo de audio", async () => {
    const { runtime } = fakeRuntime({
      transcribeError: new WhisperEngineError("unavailable", "whisper-server no llego a responder."),
    });

    const result = await serviceWith(runtime).transcribe({
      audio: wavBytes(),
      contentType: "audio/wav",
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe("unavailable");
    }
  });

  test("otro fallo del motor se reporta como transcripcion fallida", async () => {
    const { runtime } = fakeRuntime({ transcribeError: new Error("boom") });

    const result = await serviceWith(runtime).transcribe({
      audio: wavBytes(),
      contentType: "audio/wav",
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe("transcription-failed");
    }
  });
});
