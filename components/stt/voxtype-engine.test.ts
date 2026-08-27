import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { DEFAULT_STT_SETTINGS } from "./config";
import type { SttPaths } from "./paths";
import {
  createVoxtypeEngine,
  encodeVoxtypeAudio,
  hasAudibleSignal,
  voxtypeWorkerArgs,
  wavToFloat32,
} from "./voxtype-engine";

const ROOT = "/opt/agenos/system/whisper.cpp";
const PATHS: SttPaths = {
  root: ROOT,
  manifest: {
    engine: "voxtype",
    ref: "v1.7.6",
    voxtypeRef: "v0.7.5",
    buildProfile: "test",
    model: "ggml-small-q5_1.bin",
    vadModel: "ggml-silero-v5.1.2.bin",
    language: "es",
  },
  server: `${ROOT}/whisper-server`,
  voxtype: `${ROOT}/voxtype`,
  vadCapture: `${ROOT}/agenos-vad-capture`,
  model: `${ROOT}/models/ggml-small-q5_1.bin`,
  vadModel: `${ROOT}/models/ggml-silero-v5.1.2.bin`,
  recorder: "/usr/bin/arecord",
  ffmpeg: "/usr/bin/ffmpeg",
  missing: [],
};

type FakeChild = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  signalCode: string | null;
  killedWith: string[];
  kill(signal?: string): boolean;
};

function pcmWav(samples: number[]): Uint8Array {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => bytes.writeInt16LE(sample, 44 + index * 2));
  return new Uint8Array(bytes);
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.killedWith = [];
  child.kill = (signal = "SIGTERM") => {
    child.killedWith.push(signal);
    child.signalCode = signal;
    return true;
  };
  return child;
}

describe("audio de Voxtype", () => {
  test("convierte el WAV canonico a muestras f32", () => {
    const samples = wavToFloat32(pcmWav([-32_768, 0, 16_384]));

    expect(Array.from(samples)).toEqual([-1, 0, 0.5]);
    const payload = encodeVoxtypeAudio(samples);
    expect(payload.readUInt32LE(0)).toBe(3);
    expect(payload.readFloatLE(4)).toBe(-1);
    expect(payload.readFloatLE(12)).toBe(0.5);
    expect(hasAudibleSignal(samples)).toBe(true);
    expect(hasAudibleSignal(new Float32Array(16_000))).toBe(false);
  });

  test("rechaza formatos que obligarian a adivinar el audio", () => {
    expect(() => wavToFloat32(new Uint8Array([1, 2, 3]))).toThrow(/WAV no valido/);
  });
});

describe("worker de Voxtype", () => {
  test("fija modelo small, idioma espanol e hilos", () => {
    const args = voxtypeWorkerArgs(DEFAULT_STT_SETTINGS, PATHS.model as string);
    expect(args).toEqual([
      "--initial-prompt", DEFAULT_STT_SETTINGS.initialPrompt,
      "--no-whisper-context-optimization",
      "transcribe-worker",
      "--model", PATHS.model,
      "--language", "es",
      "--threads", "4",
    ]);
  });

  test("precarga, transcribe por JSON y deja salir al worker", async () => {
    const children: FakeChild[] = [];
    const spawnFn = (() => {
      const child = fakeChild();
      children.push(child);
      queueMicrotask(() => child.stdout.write("READY\n"));
      child.stdin.on("finish", () => {
        child.stdout.write('{"ok":true,"text":" abre AgenOS ","language":"es"}\n');
        child.exitCode = 0;
        child.emit("close", 0);
      });
      return child;
    }) as never;
    const engine = createVoxtypeEngine({ settings: DEFAULT_STT_SETTINGS, paths: PATHS, spawnFn });

    await engine.ensureReady();
    const result = await engine.transcribeWav(pcmWav([0, 1000, -1000]));

    expect(children).toHaveLength(1);
    expect(result.text).toBe("abre AgenOS");
    expect(result.language).toBe("es");
    expect(engine.status().engine).toBe("voxtype");
  });

  test("rechaza concurrencia sin compartir stdin", async () => {
    const child = fakeChild();
    const spawnFn = (() => {
      queueMicrotask(() => child.stdout.write("READY\n"));
      return child;
    }) as never;
    const engine = createVoxtypeEngine({ settings: DEFAULT_STT_SETTINGS, paths: PATHS, spawnFn });
    const controller = new AbortController();
    const first = engine.transcribeWav(pcmWav([0, 1000, -1000]), { signal: controller.signal });

    await Promise.resolve();
    await expect(engine.transcribeWav(pcmWav([0, 1000, -1000]))).rejects.toMatchObject({ code: "busy" });
    controller.abort();
    await expect(first).rejects.toMatchObject({ code: "cancelled" });
    expect(child.killedWith).toEqual(["SIGKILL"]);
  });

  test("un WAV invalido despues de precargar mata el worker y permite reintentar", async () => {
    const children: FakeChild[] = [];
    const spawnFn = (() => {
      const child = fakeChild();
      children.push(child);
      queueMicrotask(() => child.stdout.write("READY\n"));
      if (children.length === 2) {
        child.stdin.on("finish", () => child.stdout.write('{"ok":true,"text":"abre fotos","language":"en"}\n'));
      }
      return child;
    }) as never;
    const engine = createVoxtypeEngine({ settings: DEFAULT_STT_SETTINGS, paths: PATHS, spawnFn });

    await engine.ensureReady();
    await expect(engine.transcribeWav(new Uint8Array([1, 2, 3]))).rejects.toThrow(/WAV no valido/);
    expect(children[0].killedWith).toEqual(["SIGKILL"]);

    const result = await engine.transcribeWav(pcmWav([0, 1000, -1000]));
    expect(result.text).toBe("abre fotos");
    expect(result.language).toBe("es");
    expect(children[1].killedWith).toEqual(["SIGKILL"]);
  });

  test("el timeout de inferencia mata el worker", async () => {
    const child = fakeChild();
    const engine = createVoxtypeEngine({
      settings: DEFAULT_STT_SETTINGS,
      paths: PATHS,
      spawnFn: (() => {
        queueMicrotask(() => child.stdout.write("READY\n"));
        return child;
      }) as never,
      inferenceTimeoutMs: 5,
    });

    await expect(engine.transcribeWav(pcmWav([0, 1000, -1000]))).rejects.toThrow(/tiempo/);
    expect(child.killedWith).toEqual(["SIGKILL"]);
  });

  test("el timeout de precarga mata el worker", async () => {
    const child = fakeChild();
    const engine = createVoxtypeEngine({
      settings: DEFAULT_STT_SETTINGS,
      paths: PATHS,
      spawnFn: (() => child) as never,
      startTimeoutMs: 5,
    });

    await expect(engine.ensureReady()).rejects.toThrow(/cargo el modelo/);
    expect(child.killedWith).toEqual(["SIGKILL"]);
  });

  test("cancelar durante la inferencia mata el worker", async () => {
    const child = fakeChild();
    const controller = new AbortController();
    const engine = createVoxtypeEngine({
      settings: DEFAULT_STT_SETTINGS,
      paths: PATHS,
      spawnFn: (() => {
        queueMicrotask(() => child.stdout.write("READY\n"));
        return child;
      }) as never,
    });
    const transcription = engine.transcribeWav(pcmWav([0, 1000, -1000]), { signal: controller.signal });
    await Promise.resolve();
    controller.abort();

    await expect(transcription).rejects.toMatchObject({ code: "cancelled" });
    expect(child.killedWith).toEqual(["SIGKILL"]);
  });

  test("una salida prematura limpia el estado y la siguiente frase funciona", async () => {
    const children: FakeChild[] = [];
    const spawnFn = (() => {
      const child = fakeChild();
      children.push(child);
      queueMicrotask(() => child.stdout.write("READY\n"));
      child.stdin.on("finish", () => {
        if (children.length === 1) {
          child.exitCode = 7;
          child.emit("close", 7);
        } else {
          child.stdout.write('{"ok":true,"text":"sube el volumen"}\n');
        }
      });
      return child;
    }) as never;
    const engine = createVoxtypeEngine({ settings: DEFAULT_STT_SETTINGS, paths: PATHS, spawnFn });

    await expect(engine.transcribeWav(pcmWav([0, 1000, -1000]))).rejects.toThrow(/codigo 7/);
    expect((await engine.transcribeWav(pcmWav([0, 1000, -1000]))).text).toBe("sube el volumen");
    expect(children).toHaveLength(2);
  });

  test("JSON mal formado y dispose limpian siempre el proceso", async () => {
    const malformed = fakeChild();
    const engine = createVoxtypeEngine({
      settings: DEFAULT_STT_SETTINGS,
      paths: PATHS,
      spawnFn: (() => {
        queueMicrotask(() => malformed.stdout.write("READY\n"));
        malformed.stdin.on("finish", () => malformed.stdout.write("{mal}\n"));
        return malformed;
      }) as never,
    });

    await expect(engine.transcribeWav(pcmWav([0, 1000, -1000]))).rejects.toThrow(/JSON/);
    expect(malformed.killedWith).toEqual(["SIGKILL"]);

    const preloaded = fakeChild();
    const disposable = createVoxtypeEngine({
      settings: DEFAULT_STT_SETTINGS,
      paths: PATHS,
      spawnFn: (() => {
        queueMicrotask(() => preloaded.stdout.write("READY\n"));
        return preloaded;
      }) as never,
    });
    await disposable.ensureReady();
    disposable.dispose();
    disposable.dispose();
    expect(preloaded.killedWith).toEqual(["SIGKILL"]);
  });

  test("un fallo declarado y un error de stdin matan sus workers", async () => {
    const failed = fakeChild();
    const failedEngine = createVoxtypeEngine({
      settings: DEFAULT_STT_SETTINGS,
      paths: PATHS,
      spawnFn: (() => {
        queueMicrotask(() => failed.stdout.write("READY\n"));
        failed.stdin.on("finish", () => failed.stdout.write('{"ok":false,"error":"modelo roto"}\n'));
        return failed;
      }) as never,
    });
    await expect(failedEngine.transcribeWav(pcmWav([0, 1000, -1000]))).rejects.toThrow(/modelo roto/);
    expect(failed.killedWith).toEqual(["SIGKILL"]);

    const stdinFailed = fakeChild();
    const stdinEngine = createVoxtypeEngine({
      settings: DEFAULT_STT_SETTINGS,
      paths: PATHS,
      spawnFn: (() => {
        queueMicrotask(() => stdinFailed.stdout.write("READY\n"));
        stdinFailed.stdin.on("finish", () => stdinFailed.stdin.emit("error", new Error("EPIPE")));
        return stdinFailed;
      }) as never,
    });
    await expect(stdinEngine.transcribeWav(pcmWav([0, 1000, -1000]))).rejects.toThrow(/EPIPE/);
    expect(stdinFailed.killedWith).toEqual(["SIGKILL"]);
  });

  test("un error de spawn no deja estado y permite el siguiente intento", async () => {
    let attempts = 0;
    const recovered = fakeChild();
    const engine = createVoxtypeEngine({
      settings: DEFAULT_STT_SETTINGS,
      paths: PATHS,
      spawnFn: (() => {
        attempts += 1;
        if (attempts === 1) throw new Error("ENOENT");
        queueMicrotask(() => recovered.stdout.write("READY\n"));
        recovered.stdin.on("finish", () => recovered.stdout.write('{"ok":true,"text":"abre ajustes"}\n'));
        return recovered;
      }) as never,
    });

    await expect(engine.transcribeWav(pcmWav([0, 1000, -1000]))).rejects.toThrow(/ENOENT/);
    expect((await engine.transcribeWav(pcmWav([0, 1000, -1000]))).text).toBe("abre ajustes");
    expect(attempts).toBe(2);
  });
});
