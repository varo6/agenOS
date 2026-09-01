import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { afterEach, describe, expect, test } from "bun:test";

import {
  createWebControlVisualTracer,
  parseWebControlVisualTraceMode,
  type WebControlVisualTraceRecord,
} from "./web-control-visual-trace";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryTraceDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "agenos-web-trace-"));
  temporaryDirectories.push(directory);
  return directory;
}

function readRecords(directory: string): WebControlVisualTraceRecord[] {
  return readFileSync(join(directory, "steps.ndjson"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as WebControlVisualTraceRecord);
}

function savingController(calls: string[]) {
  return {
    async screenshot(path: string) {
      calls.push(path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, pngHeader(1280, 720));
      return { ok: true, message: "Captura guardada.", path };
    },
  };
}

function pngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(header);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

describe("web control visual trace", () => {
  test("uses failure-only tracing by default and accepts the steps alias", () => {
    expect(parseWebControlVisualTraceMode(undefined)).toBe("failures");
    expect(parseWebControlVisualTraceMode("off")).toBe("off");
    expect(parseWebControlVisualTraceMode("visual")).toBe("visual");
    expect(parseWebControlVisualTraceMode("steps")).toBe("visual");
    expect(parseWebControlVisualTraceMode("unknown")).toBe("failures");
  });

  test("records cheap metadata for every step but captures only a failure", async () => {
    const traceDir = temporaryTraceDir();
    const screenshots: string[] = [];
    let time = Date.parse("2026-08-27T10:00:00.000Z");
    const tracer = createWebControlVisualTracer({
      controller: savingController(screenshots),
      mode: "failures",
      traceDir,
      now: () => time++,
      createStepId: (startedAt) => `step-${startedAt}`,
    });

    await tracer.run(
      { action: "type", ref: "e12", text: "correo@example.test", url: "https://example.test/form?token=secret#field" },
      { correlationId: "corr_ok" },
      async () => ({
        ok: true,
        message: "Escrito en https://example.test/form?token=secret#field.",
        url: "https://example.test/form?token=secret",
      }),
    );
    await tracer.run(
      { action: "click", ref: "e20" },
      { correlationId: "corr_failed" },
      async () => ({ ok: false, message: "Falló token=sk-secret" }),
    );
    await tracer.flush();

    const records = readRecords(traceDir);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      correlationId: "corr_ok",
      action: "type",
      input: {
        ref: "e12",
        textLength: 19,
        url: "https://example.test/form",
      },
      result: {
        ok: true,
        message: "Escrito en https://example.test/form.",
        url: "https://example.test/form",
      },
      screenshot: { requested: false, status: "not-requested" },
    });
    expect(records[1]).toMatchObject({
      correlationId: "corr_failed",
      action: "click",
      result: { ok: false, message: "Falló token=[redacted]" },
      screenshot: {
        requested: true,
        reason: "failure",
        status: "saved",
        bytes: 24,
        width: 1280,
        height: 720,
      },
    });
    expect(JSON.stringify(records)).not.toContain("correo@example.test");
    expect(JSON.stringify(records)).not.toContain("sk-secret");
    expect(JSON.stringify(records)).not.toContain("?token=secret");
    expect(screenshots).toHaveLength(1);
  });

  test("does not hold up the broker result while a screenshot is pending", async () => {
    const traceDir = temporaryTraceDir();
    let finishScreenshot: (() => void) | undefined;
    const screenshotFinished = new Promise<void>((resolve) => {
      finishScreenshot = resolve;
    });
    const tracer = createWebControlVisualTracer({
      controller: {
        async screenshot(path) {
          await screenshotFinished;
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, pngHeader(800, 600));
          return { ok: true, message: "ok", path };
        },
      },
      mode: "visual",
      traceDir,
    });

    const result = await tracer.run(
      { action: "open", url: "https://example.test" },
      {},
      async () => ({ ok: true, message: "Abierta." }),
    );

    expect(result).toEqual({ ok: true, message: "Abierta." });
    expect(existsSync(join(traceDir, "steps.ndjson"))).toBe(false);
    finishScreenshot?.();
    await tracer.flush();
    expect(readRecords(traceDir)[0]?.screenshot).toMatchObject({
      reason: "visual",
      status: "saved",
    });
  });

  test("visual mode skips read-only snapshots and reports screenshot failures", async () => {
    const traceDir = temporaryTraceDir();
    const calls: string[] = [];
    const tracer = createWebControlVisualTracer({
      controller: {
        async screenshot(path) {
          calls.push(path);
          return { ok: false, message: "Chromium no devolvió imagen." };
        },
      },
      mode: "visual",
      traceDir,
    });

    await tracer.run({ action: "snapshot" }, {}, () => ({ ok: true, message: "ok" }));
    await tracer.run({ action: "reload" }, {}, () => ({ ok: true, message: "ok" }));
    await tracer.flush();

    const records = readRecords(traceDir);
    expect(records[0]?.screenshot).toEqual({ requested: false, status: "not-requested" });
    expect(records[1]?.screenshot).toEqual({
      requested: true,
      reason: "visual",
      status: "failed",
      error: "Chromium no devolvió imagen.",
    });
    expect(calls).toHaveLength(1);
  });

  test("rotates the ndjson once it grows past its byte budget", async () => {
    const traceDir = temporaryTraceDir();
    const writing = createWebControlVisualTracer({
      controller: savingController([]),
      mode: "failures",
      traceDir,
      maxTraceBytes: 4 * 1024,
    });

    for (let index = 0; index < 40; index += 1) {
      await writing.run({ action: "snapshot", ref: `e${index}` }, {}, () => ({ ok: true, message: "ok" }));
    }
    await writing.flush();

    const current = statSync(join(traceDir, "steps.ndjson"));
    expect(current.size).toBeLessThanOrEqual(4 * 1024);
    expect(existsSync(join(traceDir, "steps.ndjson.1"))).toBe(true);
    expect(readdirSync(traceDir).filter((name) => name.startsWith("steps.ndjson"))).toHaveLength(2);
    expect(readRecords(traceDir).length).toBeGreaterThan(0);
  });

  test("off mode writes nothing", async () => {
    const traceDir = temporaryTraceDir();
    const tracer = createWebControlVisualTracer({
      controller: savingController([]),
      mode: "off",
      traceDir,
    });

    await tracer.run({ action: "open" }, {}, () => ({ ok: false, message: "failed" }));
    await tracer.flush();

    expect(existsSync(join(traceDir, "steps.ndjson"))).toBe(false);
  });
});
