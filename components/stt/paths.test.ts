import { describe, expect, test } from "bun:test";

import { parseSttManifest, resolveSttPaths } from "./paths";

const SIMD_CPUINFO = "flags\t\t: fpu sse4_2 avx avx2 fma f16c bmi2\n";
const BASELINE_CPUINFO = "flags\t\t: fpu sse2\n";

const ROOT = "/opt/agenos/system/whisper.cpp";

const MANIFEST = [
  "engine=whisper.cpp",
  "ref=v1.7.6",
  "build_profile=static-simd-plus-baseline-x86_64-v2-server-vad",
  "fingerprint=abc123",
  "model=ggml-base-q5_1.bin",
  "vad_model=ggml-silero-v5.1.2.bin",
  "language=es",
  "note=ggml-base-q5_1.bin is multilingual; the .en variants are intentionally not installed.",
].join("\n");

function pathsWith(present: string[], options: Parameters<typeof resolveSttPaths>[0] = {}) {
  return resolveSttPaths({
    env: {},
    pathExists: (path) => present.includes(path),
    readFile: () => MANIFEST,
    readCpuInfo: () => SIMD_CPUINFO,
    platform: "linux",
    arch: "x64",
    ...options,
  });
}

const FULL_INSTALL = [
  ROOT,
  `${ROOT}/stt.env`,
  `${ROOT}/whisper-server`,
  `${ROOT}/whisper-server-baseline`,
  `${ROOT}/agenos-vad-capture`,
  `${ROOT}/agenos-vad-capture-baseline`,
  `${ROOT}/models/ggml-base-q5_1.bin`,
  `${ROOT}/models/ggml-silero-v5.1.2.bin`,
  "/usr/bin/arecord",
  "/usr/bin/ffmpeg",
];

describe("parseSttManifest", () => {
  test("lee los nombres declarados por el build", () => {
    const manifest = parseSttManifest(MANIFEST);

    expect(manifest.model).toBe("ggml-base-q5_1.bin");
    expect(manifest.vadModel).toBe("ggml-silero-v5.1.2.bin");
    expect(manifest.ref).toBe("v1.7.6");
  });

  test("un `note` con `=` dentro no rompe el resto", () => {
    expect(parseSttManifest("model=a.bin\nnote=x=y=z").model).toBe("a.bin");
    expect(parseSttManifest("model=a.bin\nnote=x=y=z").engine).toBeNull();
  });
});

describe("resolveSttPaths", () => {
  test("una instalacion completa no echa nada en falta", () => {
    const paths = pathsWith(FULL_INSTALL);

    expect(paths.missing).toEqual([]);
    expect(paths.server).toBe(`${ROOT}/whisper-server`);
    expect(paths.vadCapture).toBe(`${ROOT}/agenos-vad-capture`);
    expect(paths.model).toBe(`${ROOT}/models/ggml-base-q5_1.bin`);
    expect(paths.vadModel).toBe(`${ROOT}/models/ggml-silero-v5.1.2.bin`);
  });

  test("el runtime busca exactamente el modelo que declara el build", () => {
    // El build dice `ggml-small.bin` pero en disco solo hay el base: no vale.
    const paths = resolveSttPaths({
      env: {},
      pathExists: (path) => FULL_INSTALL.includes(path),
      readFile: () => "model=ggml-small.bin\nvad_model=ggml-silero-v5.1.2.bin",
      readCpuInfo: () => SIMD_CPUINFO,
      platform: "linux",
      arch: "x64",
    });

    expect(paths.model).toBeNull();
    expect(paths.missing).toContain("modelo ggml-small.bin");
  });

  test("sin AVX2 se elige el binario baseline", () => {
    const paths = pathsWith(FULL_INSTALL, { readCpuInfo: () => BASELINE_CPUINFO });

    expect(paths.server).toBe(`${ROOT}/whisper-server-baseline`);
    expect(paths.vadCapture).toBe(`${ROOT}/agenos-vad-capture-baseline`);
  });

  test("AGENOS_STT_FORCE_BASELINE gana a la deteccion de CPU", () => {
    const paths = pathsWith(FULL_INSTALL, { env: { AGENOS_STT_FORCE_BASELINE: "1" } });

    expect(paths.server).toBe(`${ROOT}/whisper-server-baseline`);
  });

  test("faltar el modelo de VAD se reporta aparte del de Whisper", () => {
    const paths = pathsWith(FULL_INSTALL.filter((path) => !path.endsWith("silero-v5.1.2.bin")));

    expect(paths.missing).toEqual(["modelo VAD ggml-silero-v5.1.2.bin"]);
  });

  test("una raiz alternativa (Electron empaquetado) se prefiere a la del sistema", () => {
    const packaged = "/tmp/app/whisper.cpp";
    const paths = resolveSttPaths({
      env: {},
      extraRoots: [packaged],
      pathExists: (path) => [packaged, `${packaged}/whisper-server`].includes(path),
      readFile: () => MANIFEST,
      readCpuInfo: () => SIMD_CPUINFO,
      platform: "linux",
      arch: "x64",
    });

    expect(paths.root).toBe(packaged);
    expect(paths.server).toBe(`${packaged}/whisper-server`);
  });

  test("un binario configurado a mano que no existe no se inventa", () => {
    const paths = pathsWith(FULL_INSTALL, { env: { AGENOS_WHISPER_SERVER_BIN: "/no/existe" } });

    expect(paths.server).toBeNull();
    expect(paths.missing).toContain("whisper-server");
  });
});
