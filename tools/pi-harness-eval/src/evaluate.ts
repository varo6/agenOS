import { readFileSync } from "node:fs";
import type {
  AssertionResult,
  EvalRunResult,
  EvalScenario,
  EvalSuite,
  EvalSummaryBucket,
  HarnessTraceRecord,
  ScenarioResult,
} from "./types";
import { findLatestMatchingTrace, normalizeText } from "./trace";

export function readEvalSuite(path: string): EvalSuite {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as EvalSuite;
  if (!Array.isArray(parsed.scenarios) || !parsed.name) {
    throw new Error(`Invalid eval suite: ${path}`);
  }
  return parsed;
}

export function evaluateSuite(input: {
  suite: EvalSuite;
  suitePath: string;
  tracePath: string;
  traces: HarnessTraceRecord[];
  generatedAt?: string;
}): EvalRunResult {
  const results = input.suite.scenarios.map((scenario) => evaluateScenario(scenario, input.traces));

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    suiteName: input.suite.name,
    suitePath: input.suitePath,
    tracePath: input.tracePath,
    total: summarize(results),
    bySplit: groupSummary(results, (result) => result.scenario.split),
    byCategory: groupSummary(results, (result) => result.scenario.category),
    results,
  };
}

export function evaluateScenario(scenario: EvalScenario, traces: HarnessTraceRecord[]): ScenarioResult {
  const trace = findLatestMatchingTrace(traces, scenario.prompt);
  const assertions: AssertionResult[] = [];

  if (!trace) {
    assertions.push({
      ok: false,
      code: "missing_trace",
      message: `No trace matched prompt: ${scenario.prompt}`,
    });
    return finish(scenario, trace, assertions);
  }

  const toolEvents = trace.toolEvents ?? [];
  const outputText = trace.output?.text ?? trace.error ?? "";
  const normalizedOutput = normalizeText(outputText);

  if (scenario.expect.status) {
    assertions.push({
      ok: trace.status === scenario.expect.status,
      code: "status_mismatch",
      message: `Expected status ${scenario.expect.status}, got ${trace.status}.`,
    });
  }

  for (const tool of scenario.expect.requiredTools ?? []) {
    const matching = toolEvents.filter((event) => event.toolName === tool);
    assertions.push({
      ok: matching.some((event) => event.ok),
      code: matching.length > 0 ? "required_tool_failed" : "required_tool_missing",
      message: matching.length > 0
        ? `Expected tool ${tool} to succeed.`
        : `Expected tool ${tool} to be used.`,
    });
  }

  for (const tool of scenario.expect.forbiddenTools ?? []) {
    assertions.push({
      ok: !toolEvents.some((event) => event.toolName === tool),
      code: "forbidden_tool_used",
      message: `Forbidden tool was used: ${tool}.`,
    });
  }

  for (const text of scenario.expect.outputIncludes ?? []) {
    assertions.push({
      ok: normalizedOutput.includes(normalizeText(text)),
      code: "output_missing",
      message: `Expected output to include: ${text}`,
    });
  }

  const anyIncludes = scenario.expect.outputIncludesAny ?? [];
  if (anyIncludes.length > 0) {
    assertions.push({
      ok: anyIncludes.some((text) => normalizedOutput.includes(normalizeText(text))),
      code: "output_missing_any",
      message: `Expected output to include one of: ${anyIncludes.join(", ")}`,
    });
  }

  for (const text of scenario.expect.outputExcludes ?? []) {
    assertions.push({
      ok: !normalizedOutput.includes(normalizeText(text)),
      code: "output_forbidden",
      message: `Expected output not to include: ${text}`,
    });
  }

  if (typeof scenario.expect.maxDurationMs === "number") {
    assertions.push({
      ok: trace.durationMs <= scenario.expect.maxDurationMs,
      code: "duration_exceeded",
      message: `Expected duration <= ${scenario.expect.maxDurationMs}ms, got ${trace.durationMs}ms.`,
    });
  }

  return finish(scenario, trace, assertions);
}

function finish(scenario: EvalScenario, trace: HarnessTraceRecord | undefined, assertions: AssertionResult[]): ScenarioResult {
  const failed = assertions.filter((assertion) => !assertion.ok);
  return {
    scenario,
    trace,
    assertions,
    passed: failed.length === 0,
    failureCodes: Array.from(new Set(failed.map((assertion) => assertion.code))),
  };
}

function groupSummary(results: ScenarioResult[], groupBy: (result: ScenarioResult) => string): Record<string, EvalSummaryBucket> {
  const grouped = new Map<string, ScenarioResult[]>();
  for (const result of results) {
    const key = groupBy(result);
    grouped.set(key, [...(grouped.get(key) ?? []), result]);
  }

  return Object.fromEntries(
    Array.from(grouped.entries()).map(([key, value]) => [key, summarize(value)]),
  );
}

function summarize(results: ScenarioResult[]): EvalSummaryBucket {
  const total = results.length;
  const passed = results.filter((result) => result.passed).length;
  const failed = total - passed;
  return {
    total,
    passed,
    failed,
    passRate: total === 0 ? 0 : Number((passed / total).toFixed(4)),
  };
}
