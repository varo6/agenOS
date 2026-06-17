import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const HARNESS_TRACE_SCHEMA_VERSION = 1;

export type HarnessTraceStatus = "succeeded" | "failed";

export type HarnessTraceTextPreview = {
  text: string;
  length: number;
  truncated: boolean;
};

export type HarnessTraceToolEvent = {
  toolName: string;
  ok: boolean;
  timestamp: string;
  output?: HarnessTraceTextPreview;
};

export type HarnessTraceRecord = {
  schemaVersion: typeof HARNESS_TRACE_SCHEMA_VERSION;
  traceId: string;
  timestamp: string;
  source: "pi-chat";
  channel: string;
  status: HarnessTraceStatus;
  provider?: string;
  modelId?: string;
  durationMs: number;
  harness: {
    promptHash: string;
    tools: string[];
  };
  input: HarnessTraceTextPreview;
  output?: HarnessTraceTextPreview;
  error?: string;
  toolEvents: HarnessTraceToolEvent[];
};

export type HarnessTraceRecorder = {
  record(record: HarnessTraceRecord): void;
};

const DEFAULT_PREVIEW_LIMIT = 1_500;

export function createHarnessTraceRecorder(options: { filePath: string }): HarnessTraceRecorder {
  return {
    record(record) {
      mkdirSync(dirname(options.filePath), { recursive: true });
      appendFileSync(options.filePath, `${JSON.stringify(sanitizeHarnessTraceRecord(record))}\n`, "utf8");
    },
  };
}

export function createNullHarnessTraceRecorder(): HarnessTraceRecorder {
  return {
    record() {},
  };
}

export function createHarnessTraceId(now: () => number = Date.now, random: () => number = Math.random): string {
  return `trace_${now().toString(36)}_${random().toString(36).slice(2, 10)}`;
}

export function hashHarnessPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

export function previewHarnessTraceText(value: unknown, limit = DEFAULT_PREVIEW_LIMIT): HarnessTraceTextPreview {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const text = redactHarnessTraceText(raw ?? "");
  const truncated = text.length > limit;

  return {
    text: truncated ? `${text.slice(0, limit)}...[truncated]` : text,
    length: raw?.length ?? 0,
    truncated,
  };
}

export function redactHarnessTraceText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(
      /\b(api[_-]?key|token|secret|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*["']?[^"'\s,;]+/gi,
      "$1=[redacted]",
    );
}

export function sanitizeHarnessTraceRecord(record: HarnessTraceRecord): HarnessTraceRecord {
  return {
    ...record,
    input: sanitizeHarnessTracePreview(record.input),
    output: record.output ? sanitizeHarnessTracePreview(record.output) : undefined,
    error: record.error ? redactHarnessTraceText(record.error) : undefined,
    toolEvents: record.toolEvents.map((event) => ({
      ...event,
      output: event.output ? sanitizeHarnessTracePreview(event.output) : undefined,
    })),
  };
}

function sanitizeHarnessTracePreview(preview: HarnessTraceTextPreview): HarnessTraceTextPreview {
  const text = redactHarnessTraceText(preview.text);
  const truncated = preview.truncated || text.length > DEFAULT_PREVIEW_LIMIT;

  return {
    ...preview,
    text: text.length > DEFAULT_PREVIEW_LIMIT ? `${text.slice(0, DEFAULT_PREVIEW_LIMIT)}...[truncated]` : text,
    truncated,
  };
}
