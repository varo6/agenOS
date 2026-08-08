import { createAgentTaskModelTool, type AgentTaskClient } from "../../../../agent/agent-task-tool";
import { createOpenBrowserModelTool } from "../../../../agent/browser-open-tool";
import { createOpenFileModelTool } from "../../../../agent/file-open-tool";
import {
  createLearningMemoryModelTool,
  type LearningMemoryClient,
} from "../../../../agent/learning-memory-tool";
import type { HarnessTraceRecord } from "../../../../agent/harness-trace";
import {
  createOpenAppModelTool,
  type PiCustomToolLike,
} from "../../../../ui/dev/pi-harness";
import { createOpenClawSetupModelTool, type OpenClawSetupToolService } from "./openclaw-setup-tool";
import type { createToolRunner, ToolRunResult } from "./tool-runner";

type ToolRunner = ReturnType<typeof createToolRunner>;

export type BrokerPiToolsOptions = {
  toolRunner: ToolRunner;
  captureTrace: (trace: HarnessTraceRecord) => Promise<void>;
};

function policyFailure(result: ToolRunResult): Error {
  const error = new Error(result.message ?? `El broker ${result.decision} la accion.`) as Error & {
    decision?: string;
    confirmationId?: string;
  };
  error.decision = result.decision;
  error.confirmationId = result.confirmationId;
  return error;
}

export function createBrokerPiTools(options: BrokerPiToolsOptions) {
  async function output<T>(tool: string, input: unknown, explicitUserIntent = false): Promise<T> {
    const result = await options.toolRunner.run({
      source: "ui",
      tool,
      input,
      explicitUserIntent,
    });
    if (result.decision !== "allow") {
      throw policyFailure(result);
    }
    return result.output as T;
  }

  const agentTaskClient: AgentTaskClient = {
    async enqueue(message) {
      const result = await options.toolRunner.run({ source: "ui", tool: "tasks.enqueue", input: { message } });
      return result.decision === "allow"
        ? result.output as Awaited<ReturnType<AgentTaskClient["enqueue"]>>
        : { ok: false, message: result.message };
    },
    status: (taskId) => output("tasks.read", { action: "status", taskId }),
    events: (taskId) => output("tasks.read", { action: "events", taskId }),
    list: (limit) => output("tasks.read", { action: "list", limit }),
    health: () => output("tasks.read", { action: "health" }),
  };

  const learningMemoryClient: LearningMemoryClient = {
    list: (includeDeleted) => output("memory.read", { action: "list", includeDeleted }),
    correct: (itemId, statement) => output("memory.write", { action: "correct", itemId, statement }, true),
    forget: (itemId) => output("memory.delete", { itemId }, true),
    context: (query, tokenBudget) => output("memory.read", { action: "context", query, tokenBudget }),
    captureTrace: options.captureTrace,
  };

  const setupService: OpenClawSetupToolService = {
    status: () => output("setup.status", {}),
    run: () => output("setup.run", {}),
    startCodexLogin: () => output("auth.codex.start", {}),
    codexLoginStatus: () => output("setup.status", {}),
    configureTelegram: (token) => output("telegram.configure", { token }),
    testTelegram: () => output("telegram.test", {}),
    enableTelegram: () => output("telegram.enable", {}),
  };

  const customTools: PiCustomToolLike[] = [
    createOpenBrowserModelTool(async (url, launcherOptions) => output("browser.open_url", {
      url,
      workspace: launcherOptions?.workspace,
      focus: launcherOptions?.focus,
    })),
    createOpenAppModelTool({
      openApp: (input) => output("apps.open", input),
    }),
    createOpenFileModelTool({
      openPath: (input) => output("files.open", input),
    }),
    createOpenClawSetupModelTool(setupService),
    createAgentTaskModelTool(agentTaskClient),
    createLearningMemoryModelTool(learningMemoryClient),
  ];

  return {
    modelTools: customTools.map((tool) => tool.name),
    customTools,
    agentTaskClient,
    learningMemoryClient,
  };
}
