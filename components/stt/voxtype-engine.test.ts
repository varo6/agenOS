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
  child.kill = () => true;
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
});
