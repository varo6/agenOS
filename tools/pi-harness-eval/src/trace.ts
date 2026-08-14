import { existsSync, readFileSync } from "node:fs";
import type { HarnessTraceRecord } from "./types";

export function readTraceFile(path: string): HarnessTraceRecord[] {
  if (!existsSync(path)) {
    return [];
  }

  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseTraceLine(line, index + 1, path))
    .filter((record): record is HarnessTraceRecord => Boolean(record));
}

function parseTraceLine(line: string, lineNumber: number, path: string): HarnessTraceRecord | null {
  try {
    const parsed = JSON.parse(line) as Partial<HarnessTraceRecord>;
    if (parsed.source !== "pi-chat" || !parsed.input?.text || !parsed.traceId) {
      return null;
    }
    return {
      schemaVersion: parsed.schemaVersion ?? 1,
      traceId: parsed.traceId,
      timestamp: parsed.timestamp ?? "",
      source: "pi-chat",
      channel: parsed.channel ?? "unknown",
      status: parsed.status === "failed" ? "failed" : "succeeded",
      provider: parsed.provider,
      modelId: parsed.modelId,
      durationMs: typeof parsed.durationMs === "number" ? parsed.durationMs : 0,
      harness: parsed.harness,
      input: parsed.input,
      output: parsed.output,
      error: parsed.error,
      toolEvents: Array.isArray(parsed.toolEvents) ? parsed.toolEvents : [],
    };
  } catch (error) {
    throw new Error(`Invalid trace JSON at ${path}:${lineNumber}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function findLatestMatchingTrace(traces: HarnessTraceRecord[], prompt: string): HarnessTraceRecord | undefined {
  const normalizedPrompt = normalizeText(prompt);
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    const trace = traces[index];
    if (normalizeText(trace.input.text) === normalizedPrompt) {
      return trace;
    }
  }
  return undefined;
}

export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
