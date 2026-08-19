import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";

import {
  createSttService,
  normalizeWhisperTranscript,
  readWavDurationSeconds,
  resolveAudioContext,
  type SttCommandRunner,
} from "./stt";

const WHISPER_BIN = "/opt/agenos/system/whisper.cpp/whisper-cli";
const WHISPER_MODEL = "/opt/agenos/system/whisper.cpp/models/ggml-small.bin";
const FFMPEG_BIN = "/usr/bin/ffmpeg";

const SIMD_CPUINFO = "flags\t\t: fpu sse4_2 avx avx2 fma f16c bmi2\n";

type RecordedCall = { command: string; args: string[] };

/** WAV real de 16 kHz mono s16, para que el servicio pueda medir su duracion. */
function wavOfSeconds(seconds: number): Uint8Array {
  const sampleRate = 16_000;
  const dataBytes = Math.round(seconds * sampleRate) * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  return new Uint8Array(buffer);
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

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
    expect(status.reason).toContain("ggml-small.bin");
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

describe("createSttService.transcribe idioma y ventana", () => {
  function transcribeWith(input: { lang?: string; seconds?: number }, env: Record<string, string> = {}) {
    const calls: RecordedCall[] = [];
    const service = serviceWithPaths([WHISPER_BIN, WHISPER_MODEL], {
      env,
      runCommand: recordingRunner(calls),
    });

    return service
      .transcribe({
        audio: wavOfSeconds(input.seconds ?? 4),
        contentType: "audio/wav",
        lang: input.lang,
      })
      .then(() => calls.find((call) => call.command === WHISPER_BIN)?.args ?? []);
  }

  test("transcribe en espanol cuando no se pide idioma", async () => {
    expect(flagValue(await transcribeWith({}), "-l")).toBe("es");
  });

  test("ignora la autodeteccion y vuelve a espanol", async () => {
    expect(flagValue(await transcribeWith({ lang: "auto" }), "-l")).toBe("es");
    expect(flagValue(await transcribeWith({ lang: "   " }), "-l")).toBe("es");
  });

  test("reduce una etiqueta regional a su idioma base", async () => {
    expect(flagValue(await transcribeWith({ lang: "es-ES" }), "-l")).toBe("es");
  });

  test("respeta un idioma explicito distinto", async () => {
    expect(flagValue(await transcribeWith({ lang: "en" }), "-l")).toBe("en");
  });

  test("AGENOS_STT_LANGUAGE cambia el idioma por defecto", async () => {
    expect(flagValue(await transcribeWith({}, { AGENOS_STT_LANGUAGE: "gl" }), "-l")).toBe("gl");
  });

  test("recorta la ventana de audio a la duracion grabada", async () => {
    expect(flagValue(await transcribeWith({ seconds: 4 }), "-ac")).toBe("384");
  });

  test("no recorta cuando el audio ocupa casi la ventana entera", async () => {
    expect(await transcribeWith({ seconds: 25 })).not.toContain("-ac");
  });
});

describe("resolveAudioContext", () => {
  test("recorta la ventana para las frases cortas que graba AgenOS", () => {
    // 4 s de audio necesitan 200 tokens; con holgura caben en 384 en vez de 1500.
    expect(resolveAudioContext(4)).toBe(384);
    expect(resolveAudioContext(5)).toBe(448);
  });

  test("nunca baja de un suelo prudente", () => {
    expect(resolveAudioContext(0.5)).toBe(256);
  });

  test("usa la ventana entera cuando el audio ya no cabe recortado", () => {
    expect(resolveAudioContext(30)).toBe(0);
    expect(resolveAudioContext(20)).toBe(0);
  });

  test("una duracion desconocida cae en ventana entera", () => {
    expect(resolveAudioContext(0)).toBe(0);
    expect(resolveAudioContext(Number.NaN)).toBe(0);
  });
});

describe("readWavDurationSeconds", () => {
  test("lee la duracion de una cabecera WAV", () => {
    expect(readWavDurationSeconds(wavOfSeconds(4))).toBeCloseTo(4, 3);
  });

  test("devuelve 0 ante datos que no son WAV", () => {
    expect(readWavDurationSeconds(new Uint8Array(64))).toBe(0);
    expect(readWavDurationSeconds(new Uint8Array([1, 2, 3]))).toBe(0);
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

  test("descarta marcadores no verbales fuera de la lista conocida", () => {
    // Sobre ruido puro `small` emite cosas como [Pausa], que antes se colaban
    // en el transcript como si fueran una orden del usuario.
    expect(normalizeWhisperTranscript("[Pausa]")).toBe("");
    expect(normalizeWhisperTranscript("[BLANK_AUDIO]")).toBe("");
    expect(normalizeWhisperTranscript("(ruido de fondo)")).toBe("");
  });
});
