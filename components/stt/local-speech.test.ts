import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_STT_SETTINGS } from "./config";
import { createLocalSpeechService } from "./local-speech";
import type { SttPaths } from "./paths";
import type { SttRuntime } from "./runtime";
import type { TranscribeWavResult, WhisperEngine } from "./engine";

const PATHS: SttPaths = {
  root: "/opt/agenos/system/whisper.cpp",
  manifest: {
    engine: "whisper.cpp",
    ref: "v1.7.6",
    voxtypeRef: "v0.7.5",
    buildProfile: "p",
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

type FakeChild = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  signalCode: string | null;
  killed: boolean;
  kill(signal?: string): boolean;
};

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.kill = (signal?: string) => {
    child.killed = true;
    child.signalCode = signal ?? "SIGTERM";
    return true;
  };
  return child;
}

/**
 * Runtime falso: captura con procesos simulados y un motor que cuenta cuantas
 * veces se le pide transcribir, para poder afirmar que se reutiliza.
 */
function fakeRuntime() {
  const spawned: Array<{ command: string; args: string[]; child: FakeChild }> = [];
  const transcribed: Uint8Array[] = [];
  let text = "abre el navegador";

  const engine: WhisperEngine = {
    status: () => ({
      available: true,
      reason: null,
      model: PATHS.model,
      vadModel: PATHS.vadModel,
      baseUrl: "http://127.0.0.1:8178",
      engine: "whisper.cpp",
    }),
    ensureReady: async () => {},
    transcribeWav: async (wav): Promise<TranscribeWavResult> => {
      transcribed.push(wav);
      return { text, durationMs: 1200, model: PATHS.model as string, language: "es" };
    },
    dispose: () => {},
  };

  const runtime: SttRuntime = {
    settings: DEFAULT_STT_SETTINGS,
    paths: PATHS,
    engine,
    baseUrl: "http://127.0.0.1:8178",
  };

  const spawnFn = ((command: string, args: string[]) => {
    const child = fakeChild();
    spawned.push({ command, args, child });
    return child;
  }) as unknown as typeof import("node:child_process").spawn;

  return {
    runtime,
    spawned,
    transcribed,
    spawnFn,
    setText(next: string) {
      text = next;
    },
  };
}

/** Cierra el analizador simulado como lo haria el binario real. */
function finishAnalyzer(child: FakeChild, code: number, line?: string) {
  if (line) {
    child.stdout.write(`${line}\n`);
  }
  child.exitCode = code;
  queueMicrotask(() => child.emit("close", code));
}

describe("createLocalSpeechService", () => {
  test("sin whisper ni microfono se declara no disponible", () => {
    const { runtime } = fakeRuntime();
    const service = createLocalSpeechService({
      ...runtime,
      paths: { ...PATHS, recorder: null },
    });

    expect(service.status().available).toBe(false);
    expect(service.status().reason).toContain("arecord");
  });

  test("una frase se graba, se recorta y se transcribe", async () => {
    const { runtime, spawned, transcribed, spawnFn } = fakeRuntime();
    const tempDir = await mkdtemp(join(tmpdir(), "agenos-stt-test-"));
    const service = createLocalSpeechService(runtime, { spawnFn, tempDir });
    const phases: string[] = [];

    const pending = service.transcribeOnce((phase) => phases.push(phase));
    await Bun.sleep(10);

    const analyzer = spawned[1].child;
    await writeFile(spawned[1].args[spawned[1].args.indexOf("--out") + 1], new Uint8Array([82, 73]));
    analyzer.stdout.write('{"event":"listening"}\n{"event":"speech"}\n');
    await Bun.sleep(5);
    finishAnalyzer(analyzer, 0, '{"event":"done","speech":true,"reason":"silence","durationMs":3870,"speechMs":3100}');

    const result = await pending;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transcript).toBe("abre el navegador");
      expect(result.captureMs).toBe(3870);
    }
    expect(transcribed).toHaveLength(1);
    expect(phases).toEqual(["listening", "speech", "transcribing"]);
  });

  test("silencio no genera texto ni llega al motor", async () => {
    const { runtime, spawned, transcribed, spawnFn } = fakeRuntime();
    const service = createLocalSpeechService(runtime, { spawnFn });

    const pending = service.transcribeOnce();
    await Bun.sleep(10);
    finishAnalyzer(spawned[1].child, 4, '{"event":"done","speech":false,"reason":"no-speech","durationMs":8000,"speechMs":0}');

    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("no-speech");
    }
    expect(transcribed).toHaveLength(0);
  });

  test("un transcript vacio se trata como falta de voz, no como acierto", async () => {
    const { runtime, spawned, spawnFn, setText } = fakeRuntime();
    setText("");
    const tempDir = await mkdtemp(join(tmpdir(), "agenos-stt-test-"));
    const service = createLocalSpeechService(runtime, { spawnFn, tempDir });

    const pending = service.transcribeOnce();
    await Bun.sleep(10);
    await writeFile(spawned[1].args[spawned[1].args.indexOf("--out") + 1], new Uint8Array([82]));
    finishAnalyzer(spawned[1].child, 0, '{"event":"done","speech":true,"reason":"silence","durationMs":2000,"speechMs":900}');

    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("no-speech");
    }
  });

  test("cancelar mata la captura y no produce transcripcion", async () => {
    const { runtime, spawned, transcribed, spawnFn } = fakeRuntime();
    const service = createLocalSpeechService(runtime, { spawnFn });

    const pending = service.transcribeOnce();
    await Bun.sleep(10);
    expect(service.isCapturing()).toBe(true);

    service.cancel();
    spawned[1].child.emit("close", null);

    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("cancelled");
    }
    expect(transcribed).toHaveLength(0);
    expect(spawned[0].child.killed).toBe(true);
    expect(spawned[1].child.killed).toBe(true);
    expect(service.isCapturing()).toBe(false);
  });

  test("terminar la captura procesa el audio recibido", async () => {
    const { runtime, spawned, transcribed, spawnFn } = fakeRuntime();
    const tempDir = await mkdtemp(join(tmpdir(), "agenos-stt-test-"));
    const service = createLocalSpeechService(runtime, { spawnFn, tempDir });

    const pending = service.transcribeOnce();
    await Bun.sleep(10);
    const analyzer = spawned[1];
    await writeFile(analyzer.args[analyzer.args.indexOf("--out") + 1], new Uint8Array([82]));

    service.finish();
    expect(spawned[0].child.killed).toBe(true);
    expect(spawned[0].child.signalCode).toBe("SIGTERM");
    expect(spawned[1].child.killed).toBe(false);

    finishAnalyzer(analyzer.child, 0, '{"event":"done","speech":true,"reason":"eof","durationMs":900,"speechMs":700}');
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(transcribed).toHaveLength(1);
  });

  test("tras cancelar se puede empezar otra captura", async () => {
    const { runtime, spawned, spawnFn } = fakeRuntime();
    const tempDir = await mkdtemp(join(tmpdir(), "agenos-stt-test-"));
    const service = createLocalSpeechService(runtime, { spawnFn, tempDir });

    const first = service.transcribeOnce();
    await Bun.sleep(10);
    service.cancel();
    spawned[1].child.emit("close", null);
    expect((await first).ok).toBe(false);

    const second = service.transcribeOnce();
    await Bun.sleep(10);
    await writeFile(spawned[3].args[spawned[3].args.indexOf("--out") + 1], new Uint8Array([82]));
    finishAnalyzer(spawned[3].child, 0, '{"event":"done","speech":true,"reason":"silence","durationMs":1500,"speechMs":900}');

    expect((await second).ok).toBe(true);
  });

  test("dos transcripciones consecutivas reutilizan el mismo motor", async () => {
    const { runtime, spawned, transcribed, spawnFn } = fakeRuntime();
    const tempDir = await mkdtemp(join(tmpdir(), "agenos-stt-test-"));
    const service = createLocalSpeechService(runtime, { spawnFn, tempDir });

    for (const index of [0, 1]) {
      const pending = service.transcribeOnce();
      await Bun.sleep(10);
      const analyzer = spawned[index * 2 + 1];
      await writeFile(analyzer.args[analyzer.args.indexOf("--out") + 1], new Uint8Array([82]));
      finishAnalyzer(analyzer.child, 0, '{"event":"done","speech":true,"reason":"silence","durationMs":2000,"speechMs":900}');
      expect((await pending).ok).toBe(true);
    }

    // Un unico WhisperEngine ha atendido las dos: el modelo no se recarga.
    expect(transcribed).toHaveLength(2);
  });

  test("no se solapan dos capturas", async () => {
    const { runtime, spawned, spawnFn } = fakeRuntime();
    const service = createLocalSpeechService(runtime, { spawnFn });

    const first = service.transcribeOnce();
    await Bun.sleep(10);
    const second = await service.transcribeOnce();

    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe("capture-failed");
    }

    service.cancel();
    spawned[1].child.emit("close", null);
    await first;
  });

  test("cancelar sin captura viva no revienta", () => {
    const { runtime } = fakeRuntime();
    const service = createLocalSpeechService(runtime);

    expect(() => service.cancel()).not.toThrow();
  });
});
