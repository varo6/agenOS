import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";

import { createSttService, normalizeWhisperTranscript, type SttCommandRunner } from "./stt";

const WHISPER_BIN = "/opt/agenos/system/whisper.cpp/whisper-cli";
const WHISPER_MODEL = "/opt/agenos/system/whisper.cpp/models/ggml-base.bin";
const FFMPEG_BIN = "/usr/bin/ffmpeg";

const SIMD_CPUINFO = "flags\t\t: fpu sse4_2 avx avx2 fma f16c bmi2\n";

type RecordedCall = { command: string; args: string[] };

function recordingRunner(calls: RecordedCall[], stdoutByCommand: Record<string, string> = {}): SttCommandRunner {
  return async (command, args) => {
    calls.push({ command, args });
    return { stdout: stdoutByCommand[command] ?? "", stderr: "" };
  };
}

function serviceWithPaths(paths: string[], overrides: Partial<Parameters<typeof createSttService>[0]> = {}) {
  return createSttService({
    env: {},
    pathExists: (path) => paths.includes(path),
    readCpuInfo: () => SIMD_CPUINFO,
    tempDir: tmpdir(),
    ...overrides,
  });
}

describe("createSttService.status", () => {
  test("reports unavailable when whisper binary and model are missing", () => {
    const service = serviceWithPaths([]);
    const status = service.status();

    expect(status.available).toBe(false);
    expect(status.engine).toBeNull();
    expect(status.reason).toContain("whisper-cli");
    expect(status.reason).toContain("ggml-base.bin");
  });

  test("reports available when binary and model exist", () => {
    const service = serviceWithPaths([WHISPER_BIN, WHISPER_MODEL]);
    const status = service.status();

    expect(status.available).toBe(true);
    expect(status.engine).toBe("whisper.cpp");
    expect(status.model).toBe(WHISPER_MODEL);
    expect(status.reason).toBeNull();
  });

  test("prefers the baseline binary when the CPU lacks SIMD flags", () => {
    const baseline = "/opt/agenos/system/whisper.cpp/whisper-cli-baseline";
    const service = serviceWithPaths([WHISPER_BIN, baseline, WHISPER_MODEL], {
      readCpuInfo: () => "flags\t\t: fpu sse2\n",
    });

    expect(service.status().available).toBe(true);
  });

  test("honors AGENOS_WHISPER_CPP_BIN and AGENOS_WHISPER_MODEL", () => {
    const service = createSttService({
      env: {
        AGENOS_WHISPER_CPP_BIN: "/custom/whisper-cli",
        AGENOS_WHISPER_MODEL: "/custom/model.bin",
      },
      pathExists: (path) => path === "/custom/whisper-cli" || path === "/custom/model.bin",
      readCpuInfo: () => SIMD_CPUINFO,
    });

    const status = service.status();
    expect(status.available).toBe(true);
    expect(status.model).toBe("/custom/model.bin");
  });
});

describe("createSttService.transcribe", () => {
  test("fails with unavailable when the engine is missing", async () => {
    const service = serviceWithPaths([]);
    const result = await service.transcribe({ audio: new Uint8Array([1]), contentType: "audio/wav" });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe("unavailable");
    }
  });

  test("rejects unsupported content types", async () => {
    const service = serviceWithPaths([WHISPER_BIN, WHISPER_MODEL]);
    const result = await service.transcribe({ audio: new Uint8Array([1]), contentType: "text/plain" });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe("unsupported-media");
    }
  });

  test("transcribes wav input without invoking ffmpeg", async () => {
    const calls: RecordedCall[] = [];
    const service = serviceWithPaths([WHISPER_BIN, WHISPER_MODEL, FFMPEG_BIN], {
      runCommand: recordingRunner(calls, { [WHISPER_BIN]: " Hola mundo \n" }),
    });

    const result = await service.transcribe({ audio: new Uint8Array([1, 2]), contentType: "audio/wav" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("Hola mundo");
      expect(result.engine).toBe("whisper.cpp");
      expect(result.model).toBe(WHISPER_MODEL);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe(WHISPER_BIN);
    expect(calls[0]?.args).toContain("-nt");
    expect(calls[0]?.args).toContain("es");
  });

  test("converts webm input with ffmpeg before whisper", async () => {
    const calls: RecordedCall[] = [];
    const service = serviceWithPaths([WHISPER_BIN, WHISPER_MODEL, FFMPEG_BIN], {
      runCommand: recordingRunner(calls, { [WHISPER_BIN]: "abre fotos\n" }),
    });

    const result = await service.transcribe({
      audio: new Uint8Array([1, 2, 3]),
      contentType: "audio/webm;codecs=opus",
      lang: "es",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("abre fotos");
    }
    expect(calls.map((call) => call.command)).toEqual([FFMPEG_BIN, WHISPER_BIN]);
    expect(calls[0]?.args).toContain("16000");
  });

  test("fails with unavailable when webm arrives and ffmpeg is missing", async () => {
    const service = serviceWithPaths([WHISPER_BIN, WHISPER_MODEL]);
    const result = await service.transcribe({ audio: new Uint8Array([1]), contentType: "audio/webm" });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe("unavailable");
      expect(result.message).toContain("ffmpeg");
    }
  });

  test("maps command failures to transcription-failed", async () => {
    const service = serviceWithPaths([WHISPER_BIN, WHISPER_MODEL], {
      runCommand: async () => {
        throw new Error("boom");
      },
    });

    const result = await service.transcribe({ audio: new Uint8Array([1]), contentType: "audio/wav" });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe("transcription-failed");
      expect(result.message).toContain("boom");
    }
  });
});

describe("normalizeWhisperTranscript", () => {
  test("strips timestamps, whisper noise lines, and non-speech markers", () => {
    const output = [
      "whisper_init_state: compute buffer",
      "[00:00:00.000 --> 00:00:02.000]  abre la terminal",
      "[MÚSICA]",
      "main: processing",
      "  de mantenimiento  ",
    ].join("\n");

    expect(normalizeWhisperTranscript(output)).toBe("abre la terminal de mantenimiento");
  });
});
