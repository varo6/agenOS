import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { evaluateSuite, readEvalSuite } from "./evaluate";
import { createProposalReport } from "./proposals";
import { createMarkdownReport } from "./report";
import type { EvalScenario, HarnessTraceRecord, HarnessTraceToolEvent } from "./types";

type Options = {
  model: string;
  suitePath: string;
  outDir: string;
  cwd: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  limit?: number;
};

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(toolRoot, "..", "..");

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const suite = readEvalSuite(options.suitePath);
  const selectedScenarios = typeof options.limit === "number"
    ? suite.scenarios.slice(0, options.limit)
    : suite.scenarios;
  const traces = selectedScenarios.map((scenario) => runScenario(scenario, options));
  const tracePath = join(options.outDir, "codex-direct.ndjson");

  mkdirSync(options.outDir, { recursive: true });
  writeFileSync(tracePath, `${traces.map((trace) => JSON.stringify(trace)).join("\n")}\n`, "utf8");

  const result = evaluateSuite({
    suite: {
      ...suite,
      scenarios: selectedScenarios,
    },
    suitePath: options.suitePath,
    tracePath,
    traces,
    traceRecordsRead: traces.length,
    modelFilter: options.model,
  });

  writeFileSync(join(options.outDir, "summary.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(join(options.outDir, "report.md"), createMarkdownReport(result), "utf8");
  writeFileSync(join(options.outDir, "proposals.md"), createProposalReport(result), "utf8");

  const passPercent = (result.total.passRate * 100).toFixed(1);
  console.log(`Codex direct baseline (${options.model}): ${result.total.passed}/${result.total.total} passed (${passPercent}%).`);
  console.log(`Trace written to: ${tracePath}`);
  console.log(`Reports written to: ${options.outDir}`);
}

function runScenario(scenario: EvalScenario, options: Options): HarnessTraceRecord {
  const startedAt = Date.now();
  const output = spawnSync("codex", [
    "exec",
    "-m",
    options.model,
    "-s",
    options.sandbox,
    "--ephemeral",
    "--json",
    "-C",
    options.cwd,
    scenario.prompt,
  ], {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const parsed = parseCodexJsonLines(output.stdout);
  const finalText = parsed.finalText || output.stderr.trim() || output.stdout.trim();
  const errorText = output.status === 0 ? undefined : finalText;

  return {
    schemaVersion: 1,
    traceId: `codex_direct_${scenario.id}_${startedAt.toString(36)}`,
    timestamp: new Date(startedAt).toISOString(),
    source: "pi-chat",
    channel: "codex-direct",
    status: output.status === 0 ? "succeeded" : "failed",
    provider: "openai-codex-cli",
    modelId: options.model,
    durationMs: Date.now() - startedAt,
    harness: {
      promptHash: "codex-cli-direct",
      tools: parsed.toolEvents.map((event) => event.toolName),
    },
    input: {
      text: scenario.prompt,
      length: scenario.prompt.length,
      truncated: false,
    },
    output: errorText ? undefined : {
      text: finalText,
      length: finalText.length,
      truncated: false,
    },
    error: errorText,
    toolEvents: parsed.toolEvents,
  };
}

function parseCodexJsonLines(stdout: string): { finalText: string; toolEvents: HarnessTraceToolEvent[] } {
  let finalText = "";
  const toolEvents: HarnessTraceToolEvent[] = [];

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    const event = JSON.parse(trimmed) as {
      type?: string;
      item?: {
        type?: string;
        text?: string;
        command?: string;
        status?: string;
      };
    };

    if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") {
      finalText = event.item.text;
    }

    if (event.type === "item.completed" && event.item?.type && event.item.type !== "agent_message") {
      const toolName = inferToolName(event.item.type, event.item.command);
      toolEvents.push({
        toolName,
        ok: event.item.status !== "failed",
        timestamp: new Date().toISOString(),
        output: event.item.text ? {
          text: event.item.text,
          length: event.item.text.length,
          truncated: false,
        } : undefined,
      });
    }
  }

  return { finalText, toolEvents };
}

function inferToolName(itemType: string, command: string | undefined): string {
  if (itemType.includes("shell") || itemType.includes("command")) {
    return "bash";
  }
  return itemType;
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    model: "gpt-5.5",
    suitePath: join(toolRoot, "scenarios", "pi-smoke.json"),
    outDir: join(toolRoot, ".out", "codex-direct-gpt55"),
    cwd: repoRoot,
    sandbox: "read-only",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--model") {
      options.model = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--suite") {
      options.suitePath = resolve(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--out") {
      options.outDir = resolve(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--cwd") {
      options.cwd = resolve(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--sandbox") {
      const sandbox = requireValue(args, index, arg);
      if (sandbox !== "read-only" && sandbox !== "workspace-write" && sandbox !== "danger-full-access") {
        throw new Error(`Invalid sandbox: ${sandbox}`);
      }
      options.sandbox = sandbox;
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      options.limit = Number(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
