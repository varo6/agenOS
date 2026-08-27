import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_STT_SETTINGS } from "./config";
import {
  captureUnavailableReason,
  parseVadEvents,
  recorderArgs,
  startVadCapture,
  vadCaptureArgs,
} from "./capture";
import type { SttPaths } from "./paths";

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

type Spawned = { command: string; args: string[]; child: FakeChild };

function fakeSpawner() {
  const spawned: Spawned[] = [];
  const spawnFn = ((command: string, args: string[]) => {
    const child = fakeChild();
    spawned.push({ command, args, child });
    return child;
  }) as unknown as typeof import("node:child_process").spawn;

  return { spawned, spawnFn };
}

/** Cierra el analizador como lo haria el binario real. */
function finishAnalyzer(child: FakeChild, code: number, line?: string) {
  if (line) {
    child.stdout.write(`${line}\n`);
  }
  child.exitCode = code;
  queueMicrotask(() => child.emit("close", code));
}

describe("recorderArgs", () => {
  test("graba PCM crudo a 16 kHz mono, sin duracion fija", () => {
    const args = recorderArgs(DEFAULT_STT_SETTINGS);

    expect(args).toEqual(["-q", "-D", "default", "-t", "raw", "-f", "S16_LE", "-r", "16000", "-c", "1"]);
    // Lo que rompia antes: `-d 4` cortaba la frase a los cuatro segundos.
    expect(args).not.toContain("-d");
  });

  test("el dispositivo de captura es configurable", () => {
    const args = recorderArgs({ ...DEFAULT_STT_SETTINGS, captureDevice: "hw:2,0" });
    expect(args[2]).toBe("hw:2,0");
  });
});

describe("vadCaptureArgs", () => {
  test("traslada silencio, tope y umbral al helper", () => {
    const args = vadCaptureArgs(DEFAULT_STT_SETTINGS, "/models/silero.bin", "/tmp/out.wav");

    expect(args[args.indexOf("--silence-ms") + 1]).toBe("650");
    expect(args[args.indexOf("--max-ms") + 1]).toBe("15000");
    expect(args[args.indexOf("--vad-model") + 1]).toBe("/models/silero.bin");
    expect(args[args.indexOf("--out") + 1]).toBe("/tmp/out.wav");
  });
});

describe("parseVadEvents", () => {
  test("solo entrega lineas completas y guarda el resto", () => {
    const { events, rest } = parseVadEvents('{"event":"listening"}\n{"event":"spe');

    expect(events).toEqual([{ event: "listening" }]);
    expect(rest).toBe('{"event":"spe');
  });

  test("ignora basura que no sea NDJSON", () => {
    expect(parseVadEvents("no json\n").events).toEqual([]);
  });
});

describe("captureUnavailableReason", () => {
  test("nombra lo que falta", () => {
    expect(captureUnavailableReason(PATHS)).toBeNull();
    expect(captureUnavailableReason({ ...PATHS, recorder: null })).toContain("arecord");
    expect(captureUnavailableReason({ ...PATHS, vadModel: null })).toContain("Silero");
  });
});

describe("startVadCapture", () => {
  test("una frase con voz devuelve el wav recortado", async () => {
    const { spawned, spawnFn } = fakeSpawner();
    const phases: string[] = [];
    const tempDir = await mkdtemp(join(tmpdir(), "agenos-capture-test-"));

    const handle = startVadCapture({
      settings: DEFAULT_STT_SETTINGS,
      paths: PATHS,
      spawnFn,
      tempDir,
      onPhase: (phase) => phases.push(phase),
    });

    await Bun.sleep(10);
    const analyzer = spawned[1].child;
    const outPath = spawned[1].args[spawned[1].args.indexOf("--out") + 1];
    await writeFile(outPath, new Uint8Array([82, 73, 70, 70]));

    analyzer.stdout.write('{"event":"listening"}\n{"event":"speech"}\n');
    await Bun.sleep(5);
    finishAnalyzer(analyzer, 0, '{"event":"done","speech":true,"reason":"silence","durationMs":3870,"speechMs":3100}');

    const outcome = await handle.done;

    expect(outcome.status).toBe("speech");
    if (outcome.status === "speech") {
      expect(outcome.reason).toBe("silence");
      expect(outcome.durationMs).toBe(3870);
      expect(Array.from(outcome.wav)).toEqual([82, 73, 70, 70]);
    }
    expect(phases).toEqual(["listening", "speech"]);
    // El grabador no se queda vivo con el microfono abierto.
    expect(spawned[0].child.killed).toBe(true);
  });

  test("silencio o ruido no producen audio que transcribir", async () => {
    const { spawned, spawnFn } = fakeSpawner();
    const handle = startVadCapture({ settings: DEFAULT_STT_SETTINGS, paths: PATHS, spawnFn });

    await Bun.sleep(10);
    finishAnalyzer(spawned[1].child, 4, '{"event":"done","speech":false,"reason":"no-speech","durationMs":8000,"speechMs":0}');

    const outcome = await handle.done;

    expect(outcome.status).toBe("no-speech");
    if (outcome.status === "no-speech") {
      expect(outcome.reason).toBe("no-speech");
    }
  });

  test("el tope de duracion llega como razon de cierre", async () => {
    const { spawned, spawnFn } = fakeSpawner();
    const tempDir = await mkdtemp(join(tmpdir(), "agenos-capture-test-"));
    const handle = startVadCapture({ settings: DEFAULT_STT_SETTINGS, paths: PATHS, spawnFn, tempDir });

    await Bun.sleep(10);
    const outPath = spawned[1].args[spawned[1].args.indexOf("--out") + 1];
    await writeFile(outPath, new Uint8Array([1]));
    finishAnalyzer(spawned[1].child, 0, '{"event":"done","speech":true,"reason":"max-duration","durationMs":15000,"speechMs":14000}');

    const outcome = await handle.done;

    expect(outcome.status).toBe("speech");
    if (outcome.status === "speech") {
      expect(outcome.reason).toBe("max-duration");
      expect(outcome.durationMs).toBe(15000);
    }
  });

  test("cancelar mata grabador y VAD y no deja nada que transcribir", async () => {
    const { spawned, spawnFn } = fakeSpawner();
    const handle = startVadCapture({ settings: DEFAULT_STT_SETTINGS, paths: PATHS, spawnFn });

    await Bun.sleep(10);
    handle.cancel();
    // El proceso real muere por la senal; aqui lo simulamos cerrando.
    spawned[1].child.emit("close", null);

    const outcome = await handle.done;

    expect(outcome.status).toBe("cancelled");
    expect(spawned[0].child.killed).toBe(true);
    expect(spawned[1].child.killed).toBe(true);
  });

  test("sin el helper de VAD la captura falla antes de abrir el microfono", async () => {
    const { spawned, spawnFn } = fakeSpawner();
    const handle = startVadCapture({
      settings: DEFAULT_STT_SETTINGS,
      paths: { ...PATHS, vadCapture: null },
      spawnFn,
    });

    const outcome = await handle.done;

    expect(outcome.status).toBe("failed");
    expect(spawned).toHaveLength(0);
  });
});
