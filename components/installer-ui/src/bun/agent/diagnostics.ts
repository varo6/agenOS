import type { RedactedWorkerConfig } from "./worker/config";
import type { WorkerHealth } from "./worker/types";

export type DiagnosticsBundleInput = {
  workerHealth: Partial<WorkerHealth>;
  config: RedactedWorkerConfig;
  taskEvents?: Array<Record<string, unknown>>;
  memoryEvents?: Array<Record<string, unknown>>;
  brokerErrors?: Array<Record<string, unknown>>;
  policyRules?: Array<Record<string, unknown>>;
  generatedAt?: string;
};

export async function createDiagnosticsBundle(input: DiagnosticsBundleInput) {
  const worker = {
    ...input.workerHealth,
    lastError: redactSecret(input.workerHealth.lastError),
  };
  const correlationIds = collectCorrelationIds([
    worker,
    ...(input.taskEvents ?? []),
    ...(input.memoryEvents ?? []),
    ...(input.brokerErrors ?? []),
  ]);

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    worker,
    config: input.config,
    taskEvents: redactRecords(input.taskEvents ?? []),
    memoryEvents: redactRecords(input.memoryEvents ?? []),
    brokerErrors: redactRecords(input.brokerErrors ?? []),
    policyRules: input.policyRules ?? [],
    correlationIds,
  };
}

function redactRecords(records: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return records.map((record) => {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      redacted[key] = typeof value === "string" ? redactSecret(value) : value;
    }
    return redacted;
  });
}

function redactSecret(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  if (/(sk-[a-z0-9_-]+|api[_-]?key|token|secret)/i.test(value)) {
    return "[redacted]";
  }

  return value;
}

function collectCorrelationIds(records: Array<Record<string, unknown>>): string[] {
  const ids = new Set<string>();
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string" && key.toLowerCase().includes("correlationid")) {
        ids.add(value);
      }
    }
  }
  return Array.from(ids);
}
