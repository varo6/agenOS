import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateSuite, readEvalSuite } from "./evaluate";
import { createProposalReport } from "./proposals";
import { createMarkdownReport } from "./report";
import { readTraceFile } from "./trace";

type CliOptions = {
  command: "run" | "help";
  suitePath: string;
  tracePath: string;
  outDir: string;
  strict: boolean;
};

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help") {
    printHelp();
    return;
  }

  const suite = readEvalSuite(options.suitePath);
  const traces = readTraceFile(options.tracePath);
  const result = evaluateSuite({
    suite,
    suitePath: options.suitePath,
    tracePath: options.tracePath,
    traces,
  });

  mkdirSync(options.outDir, { recursive: true });
  writeFileSync(join(options.outDir, "summary.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(join(options.outDir, "report.md"), createMarkdownReport(result), "utf8");
  writeFileSync(join(options.outDir, "proposals.md"), createProposalReport(result), "utf8");

  const passPercent = (result.total.passRate * 100).toFixed(1);
  console.log(`AgenOS Pi harness eval: ${result.total.passed}/${result.total.total} passed (${passPercent}%).`);
  console.log(`Trace records read: ${traces.length}`);
  console.log(`Reports written to: ${options.outDir}`);

  if (options.strict && result.total.failed > 0) {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const helpRequested = args[0] === "help" || args[0] === "--help" || args[0] === "-h";
  const command = helpRequested
    ? "help"
    : "run";
  const offset = args[0] === "run" || helpRequested ? 1 : 0;
  const defaults = {
    suitePath: join(toolRoot, "scenarios", "pi-smoke.json"),
    tracePath: join(homedir(), ".agenos", "ui-dev", "pi", "traces", "pi-chat.ndjson"),
    outDir: join(toolRoot, ".out", "latest"),
    strict: false,
  };
  const parsed: CliOptions = { command, ...defaults };

  for (let index = offset; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--suite") {
      parsed.suitePath = resolveRequiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--trace") {
      parsed.tracePath = resolveRequiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out") {
      parsed.outDir = resolveRequiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function resolveRequiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return resolve(value);
}

function printHelp() {
  console.log([
    "AgenOS Pi harness eval",
    "",
    "Usage:",
    "  bun run src/cli.ts run [--suite path] [--trace path] [--out dir] [--strict]",
    "",
    "Defaults:",
    `  suite: ${join(toolRoot, "scenarios", "pi-smoke.json")}`,
    `  trace: ${join(homedir(), ".agenos", "ui-dev", "pi", "traces", "pi-chat.ndjson")}`,
    `  out:   ${join(toolRoot, ".out", "latest")}`,
    "",
    "--strict exits non-zero when scenarios fail.",
  ].join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
