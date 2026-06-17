import type { EvalRunResult, ScenarioResult } from "./types";

type FailureCluster = {
  code: string;
  results: ScenarioResult[];
};

export function createProposalReport(result: EvalRunResult): string {
  const failed = result.results.filter((scenario) => !scenario.passed);
  const lines = [
    "# Pi Harness Proposal Notes",
    "",
    "These are deterministic review notes generated from eval failures. They are not applied automatically.",
    "",
    `Source suite: \`${result.suitePath}\``,
    `Source trace: \`${result.tracePath}\``,
    `Model filter: ${result.modelFilter ? `\`${result.modelFilter}\`` : "none"}`,
    "",
  ];

  if (failed.length === 0) {
    lines.push("No proposals generated because all scenarios passed.", "");
    return lines.join("\n");
  }

  for (const cluster of clusterFailures(failed)) {
    lines.push(...clusterProposalLines(cluster), "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function clusterFailures(results: ScenarioResult[]): FailureCluster[] {
  const clusters = new Map<string, ScenarioResult[]>();
  for (const result of results) {
    for (const code of result.failureCodes) {
      clusters.set(code, [...(clusters.get(code) ?? []), result]);
    }
  }
  return Array.from(clusters.entries()).map(([code, value]) => ({ code, results: value }));
}

function clusterProposalLines(cluster: FailureCluster): string[] {
  const scenarios = cluster.results.map((result) => result.scenario);
  const categories = Array.from(new Set(scenarios.map((scenario) => scenario.category))).join(", ");
  const ids = scenarios.map((scenario) => `\`${scenario.id}\``).join(", ");
  const lines = [
    `## ${cluster.code}`,
    "",
    `Affected scenarios: ${ids}`,
    `Categories: ${categories}`,
    "",
    proposalSummary(cluster.code),
    "",
  ];

  const diff = proposalDiff(cluster);
  if (diff) {
    lines.push("Candidate diff for manual review only:", "", "```diff", diff.trimEnd(), "```", "");
  }

  return lines;
}

function proposalSummary(code: string): string {
  switch (code) {
    case "missing_trace":
      return "No harness patch is recommended yet. Run the scenario through Pi and collect a trace first.";
    case "required_tool_missing":
      return "The model answered without using the expected tool. Consider a narrower tool-selection guideline for this task category.";
    case "required_tool_failed":
      return "The expected tool was called but failed. Consider middleware that surfaces the failure and asks the model to recover or report clearly.";
    case "forbidden_tool_used":
      return "A forbidden tool appeared in the trace. For safety scenarios, strengthen refusal/policy guidance before broadening capabilities.";
    case "output_missing":
    case "output_missing_any":
      return "The trace used acceptable mechanics but the final reply missed required user-visible evidence.";
    case "output_forbidden":
      return "The final reply contained forbidden text. Add a focused response-format or safety guard.";
    case "duration_exceeded":
      return "The run exceeded the latency budget. Look for loops or slow tool calls before changing prompts.";
    case "status_mismatch":
      return "The final trace status differed from the scenario expectation. Inspect the trace before proposing a prompt change.";
    default:
      return "Inspect this cluster manually before changing the harness.";
  }
}

function proposalDiff(cluster: FailureCluster): string | null {
  if (cluster.code === "missing_trace") {
    return null;
  }

  if (cluster.code === "forbidden_tool_used") {
    return [
      "diff --git a/components/agent/pi-system-context.md b/components/agent/pi-system-context.md",
      "--- a/components/agent/pi-system-context.md",
      "+++ b/components/agent/pi-system-context.md",
      "@@",
      " ## Safety boundaries",
      "+- For destructive data, disk, partition, or service-disabling requests, refuse or ask for explicit confirmation before any tool use. Do not call bash, write, or edit while clarifying.",
    ].join("\n");
  }

  if (cluster.code === "required_tool_missing") {
    const tools = Array.from(new Set(cluster.results.flatMap((result) => result.scenario.expect.requiredTools ?? [])));
    const toolList = tools.map((tool) => `\`${tool}\``).join(", ");
    return [
      "diff --git a/components/agent/pi-system-context.md b/components/agent/pi-system-context.md",
      "--- a/components/agent/pi-system-context.md",
      "+++ b/components/agent/pi-system-context.md",
      "@@",
      " ## Available local tools",
      `+- When the user request directly matches one of these task types, use the matching tool before answering: ${toolList}.`,
    ].join("\n");
  }

  if (cluster.code === "output_missing" || cluster.code === "output_missing_any") {
    return [
      "diff --git a/components/agent/pi-system-context.md b/components/agent/pi-system-context.md",
      "--- a/components/agent/pi-system-context.md",
      "+++ b/components/agent/pi-system-context.md",
      "@@",
      " ## Response style",
      "+- After a tool succeeds, include the concrete result the user asked for instead of only saying that the action was processed.",
    ].join("\n");
  }

  return null;
}
