export type HarnessTraceStatus = "succeeded" | "failed";

export type TextPreview = {
  text: string;
  length?: number;
  truncated?: boolean;
};

export type HarnessTraceToolEvent = {
  toolName: string;
  ok: boolean;
  timestamp?: string;
  output?: TextPreview;
};

export type HarnessTraceRecord = {
  schemaVersion: number;
  traceId: string;
  timestamp: string;
  source: "pi-chat";
  channel: string;
  status: HarnessTraceStatus;
  provider?: string;
  modelId?: string;
  durationMs: number;
  harness?: {
    promptHash?: string;
    tools?: string[];
  };
  input: TextPreview;
  output?: TextPreview;
  error?: string;
  toolEvents?: HarnessTraceToolEvent[];
};

export type EvalSplit = "held-in" | "held-out" | "safety";

export type ScenarioExpectation = {
  status?: HarnessTraceStatus;
  requiredTools?: string[];
  forbiddenTools?: string[];
  outputIncludes?: string[];
  outputIncludesAny?: string[];
  outputExcludes?: string[];
  maxDurationMs?: number;
};

export type EvalScenario = {
  id: string;
  split: EvalSplit;
  category: string;
  prompt: string;
  expect: ScenarioExpectation;
};

export type EvalSuite = {
  schemaVersion: number;
  name: string;
  description?: string;
  scenarios: EvalScenario[];
};

export type AssertionResult = {
  ok: boolean;
  code: string;
  message: string;
};

export type ScenarioResult = {
  scenario: EvalScenario;
  passed: boolean;
  trace?: HarnessTraceRecord;
  assertions: AssertionResult[];
  failureCodes: string[];
};

export type EvalSummaryBucket = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
};

export type EvalRunResult = {
  generatedAt: string;
  suiteName: string;
  suitePath: string;
  tracePath: string;
  modelFilter?: string;
  traceRecordsRead: number;
  traceRecordsEvaluated: number;
  total: EvalSummaryBucket;
  bySplit: Record<string, EvalSummaryBucket>;
  byCategory: Record<string, EvalSummaryBucket>;
  results: ScenarioResult[];
};
