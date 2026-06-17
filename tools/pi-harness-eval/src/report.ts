import type { EvalRunResult, EvalSummaryBucket, ScenarioResult } from "./types";

export function createMarkdownReport(result: EvalRunResult): string {
  const lines = [
    `# ${result.suiteName}`,
    "",
    `Generated: ${result.generatedAt}`,
    `Suite: \`${result.suitePath}\``,
    `Trace: \`${result.tracePath}\``,
    `Model filter: ${result.modelFilter ? `\`${result.modelFilter}\`` : "none"}`,
    `Trace records: ${result.traceRecordsEvaluated}/${result.traceRecordsRead} evaluated`,
    "",
    "## Summary",
    "",
    summaryTable("Total", { total: result.total }),
    "",
    summaryTable("By split", result.bySplit),
    "",
    summaryTable("By category", result.byCategory),
    "",
    "## Failed Scenarios",
    "",
  ];

  const failed = result.results.filter((scenario) => !scenario.passed);
  if (failed.length === 0) {
    lines.push("All scenarios passed.", "");
  } else {
    for (const failure of failed) {
      lines.push(...scenarioFailureLines(failure), "");
    }
  }

  lines.push("## Passed Scenarios", "");
  for (const passed of result.results.filter((scenario) => scenario.passed)) {
    lines.push(`- \`${passed.scenario.id}\` (${passed.scenario.split}/${passed.scenario.category})`, "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function summaryTable(title: string, buckets: Record<string, EvalSummaryBucket>): string {
  const lines = [
    `### ${title}`,
    "",
    "| bucket | passed | failed | total | pass rate |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];

  for (const [bucket, summary] of Object.entries(buckets)) {
    lines.push(`| ${bucket} | ${summary.passed} | ${summary.failed} | ${summary.total} | ${(summary.passRate * 100).toFixed(1)}% |`);
  }

  return lines.join("\n");
}

function scenarioFailureLines(result: ScenarioResult): string[] {
  const lines = [
    `### ${result.scenario.id}`,
    "",
    `Prompt: \`${result.scenario.prompt}\``,
    `Split/category: \`${result.scenario.split}/${result.scenario.category}\``,
    `Trace: ${result.trace ? `\`${result.trace.traceId}\`` : "missing"}`,
    "",
    "| code | message |",
    "| --- | --- |",
  ];

  for (const assertion of result.assertions.filter((item) => !item.ok)) {
    lines.push(`| \`${assertion.code}\` | ${assertion.message} |`);
  }

  return lines;
}
