import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createHarnessTraceRecorder,
  hashHarnessPrompt,
  previewHarnessTraceText,
  redactHarnessTraceText,
} from "../../../../agent/harness-trace";

describe("harness trace recorder", () => {
  test("writes redacted ndjson records without storing secrets", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-harness-trace-"));
    const filePath = join(rootDir, "traces", "pi-chat.ndjson");
    const recorder = createHarnessTraceRecorder({ filePath });

    recorder.record({
      schemaVersion: 1,
      traceId: "trace_test",
      timestamp: "2026-06-17T12:00:00.000Z",
      source: "pi-chat",
      channel: "text",
      status: "failed",
      provider: "openai-codex",
      modelId: "gpt-5.4",
      durationMs: 25,
      harness: {
        promptHash: hashHarnessPrompt("system prompt"),
        tools: ["bash"],
      },
      input: previewHarnessTraceText("check service with OPENAI_API_KEY=sk-live-secret"),
      error: "Bearer abc.def sk-live-secret",
      toolEvents: [
        {
          toolName: "bash",
          ok: false,
          timestamp: "2026-06-17T12:00:00.010Z",
          output: previewHarnessTraceText("failed token=secret-value"),
        },
      ],
    });

    const raw = readFileSync(filePath, "utf8");
    expect(raw).not.toContain("sk-live-secret");
    expect(raw).not.toContain("secret-value");
    expect(raw).toContain("[redacted]");
    expect(JSON.parse(raw)).toMatchObject({
      schemaVersion: 1,
      traceId: "trace_test",
      status: "failed",
      input: { text: "check service with OPENAI_API_KEY=[redacted]" },
      error: "Bearer [redacted] [redacted]",
      toolEvents: [{ output: { text: "failed token=[redacted]" } }],
    });
  });

  test("truncates large previews after redaction", () => {
    const preview = previewHarnessTraceText(`abc sk-secret ${"x".repeat(20)}`, 12);

    expect(preview.text).toBe("abc [redacte...[truncated]");
    expect(preview.truncated).toBe(true);
    expect(redactHarnessTraceText("refresh_token=very-secret")).toBe("refresh_token=[redacted]");
  });
});
