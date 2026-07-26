import { describe, expect, test } from "bun:test";

import {
  createAgentTaskModelTool,
  createHttpAgentTaskClient,
  resolveAgentApiBase,
  type AgentTaskClient,
  type AgentTaskEvent,
  type AgentTaskSummary,
} from "../../agent/agent-task-tool";

function createFakeClient(overrides: Partial<AgentTaskClient> = {}): AgentTaskClient {
  return {
    enqueue: async () => ({ ok: true, taskId: "task_1", message: "Tarea enviada a OpenClaw." }),
    status: async () => null,
    events: async () => [],
    list: async () => [],
    health: async () => ({ ok: true, mode: "openclaw-process" }),
    ...overrides,
  };
}

function taskSummary(overrides: Partial<AgentTaskSummary> = {}): AgentTaskSummary {
  return {
    taskId: "task_1",
    status: "running",
    progress: 10,
    message: "investiga precios de vuelos",
    lastError: null,
    ...overrides,
  };
}

describe("agent_task tool", () => {
  test("delegate returns the final result when the task completes within the wait window", async () => {
    const statuses: AgentTaskSummary[] = [
      taskSummary({ status: "queued", progress: 0 }),
      taskSummary({ status: "running", progress: 10 }),
      taskSummary({ status: "succeeded", progress: 100 }),
    ];
    const events: AgentTaskEvent[] = [
      { type: "queued", message: "Tarea encolada en OpenClaw.", timestamp: "2026-04-21T12:00:00.000Z" },
      { type: "completed", message: "Los vuelos mas baratos salen el martes.", timestamp: "2026-04-21T12:00:05.000Z" },
    ];
    const tool = createAgentTaskModelTool(
      createFakeClient({
        status: async () => statuses.shift() ?? taskSummary({ status: "succeeded", progress: 100 }),
        events: async () => events,
      }),
      { sleep: async () => {} },
    );

    const result = await tool.execute("tool_1", { action: "delegate", message: "investiga precios de vuelos" });
    expect(result.content[0]?.text).toContain("task_1");
    expect(result.content[0]?.text).toContain("completada");
    expect(result.content[0]?.text).toContain("Los vuelos mas baratos salen el martes.");
  });

  test("delegate leaves the task in background when it does not finish in time", async () => {
    const tool = createAgentTaskModelTool(
      createFakeClient({
        status: async () => taskSummary({ status: "running", progress: 40 }),
      }),
      { sleep: async () => {} },
    );

    const result = await tool.execute("tool_1", { action: "delegate", message: "descarga el dataset", waitSeconds: 0 });
    expect(result.content[0]?.text).toContain("task_1");
    expect(result.content[0]?.text).toContain("background");
    expect(result.content[0]?.text).toContain("action status");
  });

  test("delegate reports enqueue failures with a foreground fallback hint", async () => {
    const tool = createAgentTaskModelTool(
      createFakeClient({
        enqueue: async () => ({ ok: false, message: "El gateway de OpenClaw no esta disponible." }),
      }),
    );

    const result = await tool.execute("tool_1", { action: "delegate", message: "haz algo" });
    expect(result.content[0]?.text).toContain("No se pudo delegar");
    expect(result.content[0]?.text).toContain("El gateway de OpenClaw no esta disponible.");
  });

  test("delegate requires a message", async () => {
    const tool = createAgentTaskModelTool(createFakeClient());
    const result = await tool.execute("tool_1", { action: "delegate" });
    expect(result.content[0]?.text).toContain("message");
  });

  test("status describes the task and its recent events", async () => {
    const tool = createAgentTaskModelTool(
      createFakeClient({
        status: async (taskId) => taskSummary({ taskId, status: "waiting_confirmation", progress: 50 }),
        events: async () => [
          { type: "tool_request", message: "Necesita confirmar memory.write.", timestamp: "2026-04-21T12:00:03.000Z" },
        ],
      }),
    );

    const result = await tool.execute("tool_1", { action: "status", taskId: "task_9" });
    expect(result.content[0]?.text).toContain("task_9");
    expect(result.content[0]?.text).toContain("esperando confirmacion");
    expect(result.content[0]?.text).toContain("Necesita confirmar memory.write.");
  });

  test("status reports missing tasks", async () => {
    const tool = createAgentTaskModelTool(createFakeClient());
    const result = await tool.execute("tool_1", { action: "status", taskId: "task_missing" });
    expect(result.content[0]?.text).toContain("No existe ninguna tarea");
  });

  test("list shows recent tasks", async () => {
    const tool = createAgentTaskModelTool(
      createFakeClient({
        list: async () => [
          taskSummary({ taskId: "task_a", status: "succeeded" }),
          taskSummary({ taskId: "task_b", status: "running", message: "resumen semanal" }),
        ],
      }),
    );

    const result = await tool.execute("tool_1", { action: "list" });
    expect(result.content[0]?.text).toContain("task_a");
    expect(result.content[0]?.text).toContain("task_b");
    expect(result.content[0]?.text).toContain("resumen semanal");
  });

  test("health describes a degraded worker", async () => {
    const tool = createAgentTaskModelTool(
      createFakeClient({
        health: async () => ({
          ok: false,
          mode: "local-simulated",
          degradedReason: "OpenClaw gateway no disponible.",
        }),
      }),
    );

    const result = await tool.execute("tool_1", { action: "health" });
    expect(result.content[0]?.text).toContain("degradado");
    expect(result.content[0]?.text).toContain("OpenClaw gateway no disponible.");
  });

  test("rejects unknown actions", async () => {
    const tool = createAgentTaskModelTool(createFakeClient());
    const result = await tool.execute("tool_1", { action: "explode" });
    expect(result.content[0]?.text).toContain("accion desconocida");
  });
});

describe("http agent task client", () => {
  test("resolves the broker base url from the environment", () => {
    expect(resolveAgentApiBase({})).toBe("http://127.0.0.1:4173");
    expect(resolveAgentApiBase({ AGENOS_AGENT_API_BASE: "http://127.0.0.1:9999" })).toBe("http://127.0.0.1:9999");
  });

  test("talks to the broker task endpoints", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });

      if (url.endsWith("/api/agent/tasks") && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true, taskId: "task_1" }), { status: 202 });
      }
      if (url.includes("/api/agent/tasks/task_missing")) {
        return new Response(JSON.stringify({ ok: false, message: "Tarea no encontrada." }), { status: 404 });
      }
      if (url.includes("/events")) {
        return new Response(JSON.stringify([{ type: "queued", message: "ok", timestamp: "t" }]), { status: 200 });
      }
      if (url.includes("/api/agent/tasks/task_1")) {
        return new Response(JSON.stringify(taskSummary()), { status: 200 });
      }
      if (url.includes("/api/agent/worker/health")) {
        return new Response(JSON.stringify({ ok: true, mode: "openclaw-process" }), { status: 200 });
      }
      return new Response(JSON.stringify([taskSummary()]), { status: 200 });
    }) as typeof fetch;

    const client = createHttpAgentTaskClient({ baseUrl: "http://127.0.0.1:4173", fetchImpl });

    await expect(client.enqueue("haz algo")).resolves.toEqual({ ok: true, taskId: "task_1" });
    expect(requests[0]?.body).toEqual({ message: "haz algo", source: "ui" });

    await expect(client.status("task_missing")).resolves.toBeNull();
    await expect(client.status("task_1")).resolves.toMatchObject({ taskId: "task_1" });
    await expect(client.events("task_1")).resolves.toHaveLength(1);
    await expect(client.health()).resolves.toMatchObject({ mode: "openclaw-process" });
    await expect(client.list(5)).resolves.toHaveLength(1);
    expect(requests.some((request) => request.url.includes("limit=5"))).toBe(true);
  });
});
