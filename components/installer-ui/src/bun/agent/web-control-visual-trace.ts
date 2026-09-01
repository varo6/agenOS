import { appendFile, chmod, mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import type { WebActionResult, WebController } from "../../../../agent/web-control";
import { previewHarnessTraceText, redactHarnessTraceText } from "../../../../agent/harness-trace";

export const WEB_CONTROL_VISUAL_TRACE_SCHEMA_VERSION = 1;
export const DEFAULT_WEB_CONTROL_TRACE_DIR = join(homedir(), ".agenos", "broker", "traces", "web-control");

export type WebControlVisualTraceMode = "off" | "failures" | "visual";

export type WebControlVisualTraceRecord = {
  schemaVersion: typeof WEB_CONTROL_VISUAL_TRACE_SCHEMA_VERSION;
  stepId: string;
  correlationId?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  action: string;
  input: {
    url?: string;
    ref?: string;
    key?: string;
    modifiers?: string[];
    textLength?: number;
    selectorLength?: number;
    timeoutMs?: number;
    maxChars?: number;
  };
  result: {
    ok: boolean;
    message?: string;
    url?: string;
    title?: string;
    elapsedMs?: number;
  };
  screenshot: {
    requested: boolean;
    reason?: "failure" | "visual";
    status: "not-requested" | "saved" | "failed";
    path?: string;
    error?: string;
    bytes?: number;
    width?: number;
    height?: number;
  };
};

export type WebControlVisualTracer = {
  run<T>(
    input: Record<string, unknown>,
    context: { correlationId?: string },
    operation: () => T | Promise<T>,
  ): Promise<T>;
  flush(): Promise<void>;
};

type TraceOptions = {
  controller: Pick<WebController, "screenshot">;
  mode?: WebControlVisualTraceMode;
  traceDir?: string;
  maxScreenshots?: number;
  maxTraceBytes?: number;
  now?: () => number;
  createStepId?: (startedAtMs: number) => string;
};

const VISUAL_ACTIONS = new Set(["open", "click", "type", "pressKey", "waitFor", "back", "reload"]);
const DEFAULT_MAX_SCREENSHOTS = 20;
const DEFAULT_MAX_TRACE_BYTES = 2 * 1024 * 1024;
const TRACE_FILE_NAME = "steps.ndjson";
const ROTATED_TRACE_FILE_NAME = "steps.ndjson.1";

export function parseWebControlVisualTraceMode(value: string | undefined): WebControlVisualTraceMode {
  switch (value?.trim().toLowerCase()) {
    case "off":
      return "off";
    case "visual":
    case "steps":
      return "visual";
    default:
      return "failures";
  }
}

export function createWebControlVisualTracer(options: TraceOptions): WebControlVisualTracer {
  const mode = options.mode ?? parseWebControlVisualTraceMode(process.env.AGENOS_WEB_CONTROL_TRACE);
  const traceDir = options.traceDir
    ?? (process.env.AGENOS_WEB_CONTROL_TRACE_DIR?.trim() || DEFAULT_WEB_CONTROL_TRACE_DIR);
  const configuredMaximum = process.env.AGENOS_WEB_CONTROL_TRACE_MAX_SCREENSHOTS;
  const maxScreenshots = normalizeMaxScreenshots(
    options.maxScreenshots ?? (configuredMaximum ? Number(configuredMaximum) : undefined),
  );
  const configuredTraceBytes = process.env.AGENOS_WEB_CONTROL_TRACE_MAX_BYTES;
  const maxTraceBytes = normalizeMaxTraceBytes(
    options.maxTraceBytes ?? (configuredTraceBytes ? Number(configuredTraceBytes) : undefined),
  );
  const now = options.now ?? Date.now;
  const pending = new Set<Promise<void>>();
  // Las capturas van en paralelo, pero el NDJSON se escribe en fila: así las
  // líneas quedan en orden y la rotación ve siempre el tamaño real del fichero.
  let writeChain: Promise<void> = Promise.resolve();
  let sequence = 0;

  return {
    async run<T>(input, context, operation) {
      const startedAtMs = now();
      const action = normalizeAction(input.action);
      const stepId = options.createStepId?.(startedAtMs)
        ?? `web_step_${startedAtMs.toString(36)}_${(sequence++).toString(36)}`;

      try {
        const result = await operation();
        const finishedAtMs = now();
        enqueue(buildTraceTask({
          action,
          context,
          finishedAtMs,
          input,
          result,
          startedAtMs,
          stepId,
        }));
        return result;
      } catch (error) {
        const finishedAtMs = now();
        enqueue(buildTraceTask({
          action,
          context,
          error,
          finishedAtMs,
          input,
          startedAtMs,
          stepId,
        }));
        throw error;
      }
    },
    async flush() {
      while (pending.size > 0) {
        await Promise.allSettled([...pending]);
      }
    },
  };

  function enqueue(task: Promise<void>): void {
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }

  async function buildTraceTask(input: {
    action: string;
    context: { correlationId?: string };
    input: Record<string, unknown>;
    result?: unknown;
    error?: unknown;
    finishedAtMs: number;
    startedAtMs: number;
    stepId: string;
  }): Promise<void> {
    if (mode === "off") {
      return;
    }

    try {
      const result = resultMetadata(input.result, input.error);
      const reason = captureReason(mode, input.action, result.ok);
      const screenshot = reason
        ? await captureScreenshot(input.stepId, reason)
        : { requested: false, status: "not-requested" as const };
      const record: WebControlVisualTraceRecord = {
        schemaVersion: WEB_CONTROL_VISUAL_TRACE_SCHEMA_VERSION,
        stepId: input.stepId,
        ...(input.context.correlationId ? { correlationId: input.context.correlationId } : {}),
        startedAt: new Date(input.startedAtMs).toISOString(),
        finishedAt: new Date(input.finishedAtMs).toISOString(),
        durationMs: Math.max(0, input.finishedAtMs - input.startedAtMs),
        action: input.action,
        input: inputMetadata(input.input),
        result,
        screenshot,
      };

      await appendRecord(record);
    } catch {
      // Tracing is best-effort and must never affect a broker tool result.
    }
  }

  function appendRecord(record: WebControlVisualTraceRecord): Promise<void> {
    const line = `${JSON.stringify(record)}\n`;
    writeChain = writeChain.then(async () => {
      await mkdir(traceDir, { recursive: true, mode: 0o700 });
      const tracePath = join(traceDir, TRACE_FILE_NAME);
      await rotateTrace(tracePath, Buffer.byteLength(line));
      await appendFile(tracePath, line, { encoding: "utf8", mode: 0o600 });
      await chmod(tracePath, 0o600);
    }).catch(() => undefined);
    return writeChain;
  }

  // Retención acotada: el NDJSON rota a `.1` al pasar del límite, así que la
  // traza nunca ocupa más de dos ficheros en el disco del usuario.
  async function rotateTrace(tracePath: string, incomingBytes: number): Promise<void> {
    let currentBytes = 0;
    try {
      currentBytes = (await stat(tracePath)).size;
    } catch {
      return;
    }
    if (currentBytes + incomingBytes <= maxTraceBytes) {
      return;
    }
    await rename(tracePath, join(traceDir, ROTATED_TRACE_FILE_NAME));
  }

  async function captureScreenshot(
    stepId: string,
    reason: "failure" | "visual",
  ): Promise<WebControlVisualTraceRecord["screenshot"]> {
    const imageDir = join(traceDir, "screenshots");
    const path = join(imageDir, `${safeFilePart(stepId)}.png`);
    try {
      await mkdir(imageDir, { recursive: true, mode: 0o700 });
      const result = await options.controller.screenshot(path);
      if (!result.ok || !result.path) {
        return {
          requested: true,
          reason,
          status: "failed",
          error: safeMessage(result.message),
        };
      }
      const image = await inspectPng(result.path);
      await chmod(result.path, 0o600);
      await pruneScreenshots(imageDir, maxScreenshots);
      return {
        requested: true,
        reason,
        status: "saved",
        path: result.path,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
      };
    } catch (error) {
      return {
        requested: true,
        reason,
        status: "failed",
        error: safeMessage(error instanceof Error ? error.message : String(error)),
      };
    }
  }
}

function normalizeAction(value: unknown): string {
  const action = typeof value === "string" ? value.trim() : "";
  return action || "snapshot";
}

function captureReason(
  mode: WebControlVisualTraceMode,
  action: string,
  ok: boolean,
): "failure" | "visual" | undefined {
  if (!ok && action !== "screenshot" && action !== "status") {
    return "failure";
  }
  if (mode === "visual" && ok && VISUAL_ACTIONS.has(action)) {
    return "visual";
  }
  return undefined;
}

function inputMetadata(input: Record<string, unknown>): WebControlVisualTraceRecord["input"] {
  const text = typeof input.text === "string" ? input.text : undefined;
  const selector = typeof input.selector === "string" ? input.selector : undefined;
  return {
    ...(typeof input.url === "string" ? { url: safeUrl(input.url) } : {}),
    ...(typeof input.ref === "string" ? { ref: input.ref.slice(0, 80) } : {}),
    ...(typeof input.key === "string" ? { key: input.key.slice(0, 40) } : {}),
    ...(Array.isArray(input.modifiers)
      ? { modifiers: input.modifiers.filter((value): value is string => typeof value === "string").slice(0, 8) }
      : {}),
    ...(text !== undefined ? { textLength: text.length } : {}),
    ...(selector !== undefined ? { selectorLength: selector.length } : {}),
    ...(typeof input.timeoutMs === "number" ? { timeoutMs: input.timeoutMs } : {}),
    ...(typeof input.maxChars === "number" ? { maxChars: input.maxChars } : {}),
  };
}

function resultMetadata(result: unknown, error: unknown): WebControlVisualTraceRecord["result"] {
  if (error !== undefined) {
    return {
      ok: false,
      message: safeMessage(error instanceof Error ? error.message : String(error)),
    };
  }
  const value = result && typeof result === "object" ? result as Partial<WebActionResult> : {};
  return {
    ok: value.ok !== false,
    ...(typeof value.message === "string" ? { message: safeMessage(value.message) } : {}),
    ...(typeof value.url === "string" ? { url: safeUrl(value.url) } : {}),
    ...(typeof value.title === "string" ? { title: safeMessage(value.title) } : {}),
    ...(typeof value.elapsedMs === "number" ? { elapsedMs: value.elapsedMs } : {}),
  };
}

function safeMessage(value: string): string {
  const withoutUrlSecrets = value.replace(/\bhttps?:\/\/[^\s<>"']+/gi, (rawUrl) => {
    const match = rawUrl.match(/^(.*?)([),.;!?]*)$/);
    return `${safeUrl(match?.[1] ?? rawUrl)}${match?.[2] ?? ""}`;
  });
  return previewHarnessTraceText(redactHarnessTraceText(withoutUrlSecrets), 300).text;
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return `[invalid-url length=${value.length}]`;
  }
}

function safeFilePart(value: string): string {
  return basename(value).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "web-step";
}

function normalizeMaxTraceBytes(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_TRACE_BYTES;
  }
  return Math.max(4 * 1024, Math.min(64 * 1024 * 1024, Math.floor(value as number)));
}

function normalizeMaxScreenshots(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_SCREENSHOTS;
  }
  return Math.max(1, Math.min(200, Math.floor(value as number)));
}

async function pruneScreenshots(directory: string, maximum: number): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".png"))
    .map(async (entry) => {
      const path = join(directory, entry.name);
      return { path, modifiedAt: (await stat(path)).mtimeMs };
    }));
  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
  await Promise.all(candidates.slice(maximum).map((entry) => unlink(entry.path)));
}

async function inspectPng(path: string): Promise<{ bytes: number; width: number; height: number }> {
  const file = await open(path, "r");
  const header = Buffer.alloc(24);
  try {
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (bytesRead < header.length || header.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
      throw new Error("La captura no es un PNG válido.");
    }
  } finally {
    await file.close();
  }

  const details = await stat(path);
  return {
    bytes: details.size,
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20),
  };
}
