import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import { INSTALLER_ROUTES } from "../shared/installer-http";
import type {
  ApiMessageResponse,
  InstallerProfilePayload,
  LaunchResponse,
  ValidationResponse,
} from "../shared/installer-types";
import { createInstallerApiHandler } from "./server";

const validProfile: InstallerProfilePayload = {
  schemaVersion: 1,
  locale: "es_ES.UTF-8",
  timezone: "Europe/Madrid",
  keyboardLayout: "es",
  keyboardVariant: "",
  targetDisk: "/dev/sda",
  user: {
    fullName: "Ada Lovelace",
    username: "ada",
    hostname: "agenos",
    password: "secret",
    passwordConfirmation: "secret",
  },
  installMode: "erase-disk",
  rootMode: "same-as-user",
};

function createHandler(overrides: Parameters<typeof createInstallerApiHandler>[0] = {}) {
  const piHarness = {
    getStatus: () => ({
      authState: "connected" as const,
      providerName: "ChatGPT/Codex",
      modelId: "gpt-5.4-mini",
      busy: false,
    }),
    startAuth: async () => ({
      attemptId: "att_123",
      method: "browser" as const,
      url: "https://auth.example",
      instructions: "Completa el login",
      expiresAt: "2026-04-21T00:10:00.000Z",
    }),
    getAuthAttempt: (attemptId: string) => ({
      attemptId,
      method: "browser" as const,
      status: "pending" as const,
      expiresAt: "2026-04-21T00:10:00.000Z",
    }),
    submitManualCode: (attemptId: string) => ({
      attemptId,
      method: "browser" as const,
      status: "pending" as const,
      expiresAt: "2026-04-21T00:10:00.000Z",
    }),
    logout: () => undefined,
    chat: async () => ({
      ok: true,
      reply: "hola",
      provider: "openai-codex" as const,
      modelId: "gpt-5.4-mini",
    }),
  };

  return createInstallerApiHandler({
    getPreflight: () => ({
      firmware: "UEFI",
      isLiveSession: true,
      totalRamBytes: 8,
      installableDiskBytes: 16,
      checks: [],
    }),
    getDisks: () => [
      {
        path: "/dev/sda",
        vendor: "ATA",
        model: "Disk",
        transport: "sata",
        sizeBytes: 64,
        sizeLabel: "64 B",
        systemDisk: false,
      },
    ],
    validateProfile: () => ({
      ok: true,
      errors: {},
    }),
    launchGuided: async () => ({
      ok: true,
      launched: true,
      message: "guided ok",
    }),
    launchClassic: async () => ({
      ok: true,
      launched: true,
      message: "classic ok",
    }),
    switchMode: async () => ({
      ok: true,
      message: "switch ok",
    }),
    runMaintenance: async () => ({
      ok: true,
      message: "maintenance ok",
    }),
    piHarness,
    ...overrides,
  });
}

async function jsonPayload(response: Response): Promise<unknown> {
  return response.json();
}

describe("createInstallerApiHandler", () => {
  test("serves /health", async () => {
    const handler = createHandler();

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.health}`));

    expect(response.status).toBe(200);
    expect(await jsonPayload(response)).toEqual({ ok: true });
  });

  test("serves preflight data", async () => {
    const handler = createHandler();

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.preflight}`));

    expect(response.status).toBe(200);
    expect(await jsonPayload(response)).toEqual({
      firmware: "UEFI",
      isLiveSession: true,
      totalRamBytes: 8,
      installableDiskBytes: 16,
      checks: [],
    });
  });

  test("serves disk summaries", async () => {
    const handler = createHandler();

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.disks}`));

    expect(response.status).toBe(200);
    expect(await jsonPayload(response)).toEqual([
      {
        path: "/dev/sda",
        vendor: "ATA",
        model: "Disk",
        transport: "sata",
        sizeBytes: 64,
        sizeLabel: "64 B",
        systemDisk: false,
      },
    ]);
  });

  test("returns validation responses over HTTP", async () => {
    const validationResponse: ValidationResponse = {
      ok: false,
      errors: {
        username: "El username no es válido.",
      },
    };
    const handler = createHandler({
      validateProfile: () => validationResponse,
    });

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.validateProfile}`, {
      method: "POST",
      body: JSON.stringify(validProfile),
    }));

    expect(response.status).toBe(200);
    expect(await jsonPayload(response)).toEqual(validationResponse);
  });

  test("returns 202 for successful guided launches", async () => {
    const launchResponse: LaunchResponse = {
      ok: true,
      launched: true,
      message: "guided ok",
    };
    const handler = createHandler({
      launchGuided: async () => launchResponse,
    });

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.startGuided}`, {
      method: "POST",
      body: JSON.stringify(validProfile),
    }));

    expect(response.status).toBe(202);
    expect(await jsonPayload(response)).toEqual(launchResponse);
  });

  test("returns 422 for guided validation failures", async () => {
    const launchResponse: LaunchResponse = {
      ok: false,
      errors: {
        username: "El username no es válido.",
      },
    };
    const handler = createHandler({
      launchGuided: async () => launchResponse,
    });

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.startGuided}`, {
      method: "POST",
      body: JSON.stringify(validProfile),
    }));

    expect(response.status).toBe(422);
    expect(await jsonPayload(response)).toEqual(launchResponse);
  });

  test("returns 202 for successful classic launches", async () => {
    const launchResponse: LaunchResponse = {
      ok: true,
      launched: true,
      message: "classic ok",
    };
    const handler = createHandler({
      launchClassic: async () => launchResponse,
    });

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.startClassic}`, {
      method: "POST",
    }));

    expect(response.status).toBe(202);
    expect(await jsonPayload(response)).toEqual(launchResponse);
  });

  test("returns 403 for classic permission failures", async () => {
    const launchResponse: LaunchResponse = {
      ok: false,
      message: "Permission denied",
    };
    const handler = createHandler({
      launchClassic: async () => launchResponse,
    });

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.startClassic}`, {
      method: "POST",
    }));

    expect(response.status).toBe(403);
    expect(await jsonPayload(response)).toEqual(launchResponse);
  });

  test("returns 202 when switching shell mode succeeds", async () => {
    const switchResponse: ApiMessageResponse = {
      ok: true,
      message: "switch ok",
    };
    const handler = createHandler({
      switchMode: async () => switchResponse,
    });

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.switchMode}`, {
      method: "POST",
      body: JSON.stringify({ mode: "system" }),
    }));

    expect(response.status).toBe(202);
    expect(await jsonPayload(response)).toEqual(switchResponse);
  });

  test("returns 202 when maintenance succeeds", async () => {
    const handler = createHandler({
      runMaintenance: async () => ({
        ok: true,
        message: "maintenance ok",
      }),
    });

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.systemMaintenance}`, {
      method: "POST",
      body: JSON.stringify({ action: "terminal" }),
    }));

    expect(response.status).toBe(202);
    expect(await jsonPayload(response)).toEqual({
      ok: true,
      message: "maintenance ok",
    });
  });

  test("returns 400 when maintenance receives an invalid action", async () => {
    const handler = createHandler();

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.systemMaintenance}`, {
      method: "POST",
      body: JSON.stringify({ action: "reload-shell" }),
    }));

    expect(response.status).toBe(400);
    expect(await jsonPayload(response)).toEqual({
      ok: false,
      message: "La acción debe ser terminal.",
    });
  });

  test("returns 500 when maintenance fails", async () => {
    const handler = createHandler({
      runMaintenance: async () => ({
        ok: false,
        message: "helper fallo",
      }),
    });

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.systemMaintenance}`, {
      method: "POST",
      body: JSON.stringify({ action: "terminal" }),
    }));

    expect(response.status).toBe(500);
    expect(await jsonPayload(response)).toEqual({
      ok: false,
      message: "helper fallo",
    });
  });

  test("serves pi status through the packaged API", async () => {
    const handler = createHandler();

    const response = await handler.fetch(new Request("http://localhost/api/pi/status"));

    expect(response.status).toBe(200);
    expect(await jsonPayload(response)).toEqual({
      authState: "connected",
      providerName: "ChatGPT/Codex",
      modelId: "gpt-5.4-mini",
      busy: false,
    });
  });

  test("serves pi chat through the packaged API", async () => {
    const handler = createHandler();

    const response = await handler.fetch(new Request("http://localhost/api/pi/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "hola",
        source: "text",
      }),
    }));

    expect(response.status).toBe(200);
    expect(await jsonPayload(response)).toEqual({
      ok: true,
      reply: "hola",
      provider: "openai-codex",
      modelId: "gpt-5.4-mini",
    });
  });

  test("keeps health available when the default pi harness cannot initialize", async () => {
    const handler = createInstallerApiHandler({
      createPiHarness: () => {
        throw new Error("EACCES: permission denied, mkdir '/home/agenos/.agenos/ui-dev'");
      },
    } as never);

    const health = await handler.fetch(new Request("http://localhost/health"));
    const piStatus = await handler.fetch(new Request("http://localhost/api/pi/status"));
    const startAuth = await handler.fetch(new Request("http://localhost/api/pi/auth/start", {
      method: "POST",
    }));

    expect(health.status).toBe(200);
    expect(piStatus.status).toBe(200);
    expect(await jsonPayload(piStatus)).toMatchObject({
      authState: "error",
      busy: false,
      error: "EACCES: permission denied, mkdir '/home/agenos/.agenos/ui-dev'",
    });
    expect(startAuth.status).toBe(503);
  });

  test("returns 400 when switching shell mode receives an invalid payload", async () => {
    const handler = createHandler();

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.switchMode}`, {
      method: "POST",
      body: JSON.stringify({ mode: "invalid" }),
    }));

    expect(response.status).toBe(400);
    expect(await jsonPayload(response)).toEqual({
      ok: false,
      message: "El modo debe ser installer o system.",
    });
  });

  test("serves the packaged frontend when a dist dir is available", async () => {
    const installerFrontendDir = mkdtempSync(join(tmpdir(), "agenos-installer-ui-"));
    const systemFrontendDir = mkdtempSync(join(tmpdir(), "agenos-ui-"));
    Bun.write(join(installerFrontendDir, "index.html"), "<!doctype html><title>AgenOS Installer</title>");
    Bun.write(join(installerFrontendDir, "logo.svg"), "<svg xmlns='http://www.w3.org/2000/svg' />");
    Bun.write(join(systemFrontendDir, "index.html"), "<!doctype html><title>AgenOS System</title>");
    Bun.write(join(systemFrontendDir, "system.svg"), "<svg xmlns='http://www.w3.org/2000/svg' />");

    const handler = createHandler({
      installerFrontendDistDir: installerFrontendDir,
      systemFrontendDistDir: systemFrontendDir,
    });

    const indexResponse = await handler.fetch(new Request("http://localhost/"));
    const systemAssetResponse = await handler.fetch(new Request("http://localhost/system.svg"));
    const installerIndexResponse = await handler.fetch(new Request("http://localhost/installer/"));
    const installerAssetResponse = await handler.fetch(new Request("http://localhost/installer/logo.svg"));

    expect(indexResponse.status).toBe(200);
    expect(await indexResponse.text()).toContain("AgenOS System");
    expect(systemAssetResponse.status).toBe(200);
    expect(await systemAssetResponse.text()).toContain("<svg");
    expect(installerIndexResponse.status).toBe(200);
    expect(await installerIndexResponse.text()).toContain("AgenOS Installer");
    expect(installerAssetResponse.status).toBe(200);
    expect(await installerAssetResponse.text()).toContain("<svg");
  });

  test("redirects /installer to /installer/ so relative assets resolve correctly", async () => {
    const installerFrontendDir = mkdtempSync(join(tmpdir(), "agenos-installer-ui-"));
    const systemFrontendDir = mkdtempSync(join(tmpdir(), "agenos-ui-"));
    Bun.write(join(installerFrontendDir, "index.html"), "<!doctype html><title>AgenOS Installer</title>");
    Bun.write(join(systemFrontendDir, "index.html"), "<!doctype html><title>AgenOS System</title>");

    const handler = createHandler({
      installerFrontendDistDir: installerFrontendDir,
      systemFrontendDistDir: systemFrontendDir,
    });

    const response = await handler.fetch(new Request("http://localhost/installer"));

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("http://localhost/installer/");
  });

  test("agent memory routes read and append contacts", async () => {
    const memory = {
      read: () => ({ namespace: "contacts", content: "Pablo Lopez: pablo@example.com\n" }),
      append: () => ({ ok: true, message: "Memoria guardada." }),
    };
    const handler = createInstallerApiHandler({ memoryStore: memory as never });

    const readResponse = await handler.fetch(new Request("http://localhost/api/agent/memory/contacts"));
    expect(readResponse.status).toBe(200);
    expect(await jsonPayload(readResponse)).toEqual({
      namespace: "contacts",
      content: "Pablo Lopez: pablo@example.com\n",
    });

    const writeResponse = await handler.fetch(new Request("http://localhost/api/agent/memory/contacts", {
      method: "POST",
      body: JSON.stringify({ content: "Pablo Lopez es mi profesor", source: "ui", explicitUserIntent: true }),
    }));
    expect(writeResponse.status).toBe(202);
  });

  test("background memory writes create confirmation instead of writing immediately", async () => {
    const handler = createInstallerApiHandler();

    const response = await handler.fetch(new Request("http://localhost/api/agent/memory/facts", {
      method: "POST",
      body: JSON.stringify({
        content: "Pablo Lopez es mi profesor",
        source: "openclaw",
        explicitUserIntent: false,
      }),
    }));

    expect(response.status).toBe(409);
    expect(await jsonPayload(response)).toMatchObject({
      ok: false,
      decision: "confirm",
    });
  });

  test("agent memory events route returns redacted audit entries", async () => {
    const memory = {
      read: () => ({ namespace: "facts", content: "" }),
      append: () => ({ ok: true, message: "Memoria guardada." }),
      events: () => [
        {
          schemaVersion: 1,
          timestamp: "2026-05-16T14:00:00.000Z",
          action: "memory.append",
          namespace: "facts",
          source: "openclaw",
          correlationId: "corr_memory_test",
          byteLength: 27,
        },
      ],
    };
    const handler = createInstallerApiHandler({ memoryStore: memory as never });

    const response = await handler.fetch(new Request("http://localhost/api/agent/memory/events"));

    expect(response.status).toBe(200);
    const payload = await jsonPayload(response);
    expect(payload).toEqual([
      {
        schemaVersion: 1,
        timestamp: "2026-05-16T14:00:00.000Z",
        action: "memory.append",
        namespace: "facts",
        source: "openclaw",
        correlationId: "corr_memory_test",
        byteLength: 27,
      },
    ]);
    expect(JSON.stringify(payload)).not.toContain("Pablo Lopez es mi profesor");
  });

  test("agent task route enqueues background work", async () => {
    const taskQueue = {
      enqueue: () => ({ ok: true, taskId: "task_test", message: "Tarea enviada al worker de fondo." }),
      health: () => ({ ok: true, mode: "local-simulated" }),
    };
    const handler = createInstallerApiHandler({ taskQueue: taskQueue as never });

    const response = await handler.fetch(new Request("http://localhost/api/agent/tasks", {
      method: "POST",
      body: JSON.stringify({ message: "prepara un email a Pablo", source: "ui" }),
    }));

    expect(response.status).toBe(202);
    expect(await jsonPayload(response)).toEqual({
      ok: true,
      taskId: "task_test",
      message: "Tarea enviada al worker de fondo.",
    });
  });

  test("agent worker health reports real backend details", async () => {
    const taskQueue = {
      health: async () => ({
        ok: true,
        mode: "agenos-bun-worker",
        serviceActive: true,
        version: "0.1.0",
        stateDir: "/home/agenos/.agenos/openclaw",
        queueDepth: 1,
        lastError: null,
      }),
      enqueue: async () => ({ ok: true, taskId: "task_test", message: "queued" }),
      status: async () => null,
      events: async () => [],
      list: async () => [],
    };
    const handler = createInstallerApiHandler({ taskQueue: taskQueue as never });

    const response = await handler.fetch(new Request("http://localhost/api/agent/worker/health"));

    expect(response.status).toBe(200);
    expect(await jsonPayload(response)).toMatchObject({
      ok: true,
      mode: "agenos-bun-worker",
      serviceActive: true,
    });
  });

  test("agent task status and events are available by task id", async () => {
    const taskQueue = {
      health: async () => ({ ok: true, mode: "local-simulated" }),
      enqueue: async () => ({ ok: true, taskId: "task_test" }),
      status: async () => ({ taskId: "task_test", status: "running", progress: 50, message: "work", lastError: null }),
      events: async () => [{ taskId: "task_test", timestamp: "2026-05-16T12:00:00.000Z", type: "progress", message: "Half done", progress: 50 }],
      list: async () => [],
    };
    const handler = createInstallerApiHandler({ taskQueue: taskQueue as never });

    const status = await handler.fetch(new Request("http://localhost/api/agent/tasks/task_test"));
    const events = await handler.fetch(new Request("http://localhost/api/agent/tasks/task_test/events"));

    expect(status.status).toBe(200);
    expect(await jsonPayload(status)).toMatchObject({ taskId: "task_test", status: "running" });
    expect(events.status).toBe(200);
    expect(await jsonPayload(events)).toEqual([
      { taskId: "task_test", timestamp: "2026-05-16T12:00:00.000Z", type: "progress", message: "Half done", progress: 50 },
    ]);
  });

  test("agent browser route opens normalized urls", async () => {
    const opened: string[] = [];
    const browserTool = {
      openUrl: async (url: string) => {
        opened.push(url);
        return { ok: true, message: "Abriendo https://netflix.com/." };
      },
    };
    const handler = createInstallerApiHandler({ browserTool: browserTool as never });

    const response = await handler.fetch(new Request("http://localhost/api/agent/browser/open-url", {
      method: "POST",
      body: JSON.stringify({ url: "netflix.com" }),
    }));

    expect(response.status).toBe(202);
    expect(opened).toEqual(["netflix.com"]);
  });

  test("agent admin endpoints expose status config and policy", async () => {
    const agentAdmin = {
      status: async () => ({
        ok: true,
        readiness: "ready",
        setupItems: [],
        worker: {
          mode: "agenos-bun-worker",
          serviceActive: true,
          version: "0.1.0",
          queueDepth: 0,
          lastError: null,
        },
        config: {
          mode: "auto",
          provider: "none",
          model: "none",
          stateDir: "/home/agenos/.agenos/openclaw",
          apiAuth: { type: "env", envVar: "AGENOS_OPENCLAW_API_KEY", configured: false },
        },
      }),
      readConfig: async () => ({
        mode: "auto",
        provider: "none",
        model: "none",
        stateDir: "/home/agenos/.agenos/openclaw",
        apiAuth: { type: "env", envVar: "AGENOS_OPENCLAW_API_KEY", configured: false },
      }),
      readPolicy: () => ({ rules: [{ ruleId: "agent.shell.deny", decision: "deny" }] }),
      writeConfig: async () => ({ ok: false, decision: "confirm", confirmationId: "conf_config" }),
      restart: async () => ({ ok: false, decision: "confirm", confirmationId: "conf_restart" }),
      testConnection: async () => ({ ok: false, status: 503, readiness: "needs_setup", message: "Provider/auth is not configured." }),
    };
    const handler = createInstallerApiHandler({ agentAdmin: agentAdmin as never });

    const status = await handler.fetch(new Request("http://localhost/api/agent/admin/status"));
    const config = await handler.fetch(new Request("http://localhost/api/agent/admin/config"));
    const policy = await handler.fetch(new Request("http://localhost/api/agent/admin/policy"));
    const writeConfig = await handler.fetch(new Request("http://localhost/api/agent/admin/config", {
      method: "POST",
      body: JSON.stringify({ mode: "local-simulated", explicitUserIntent: true }),
    }));
    const restart = await handler.fetch(new Request("http://localhost/api/agent/admin/restart", {
      method: "POST",
      body: JSON.stringify({ explicitUserIntent: true }),
    }));
    const testConnection = await handler.fetch(new Request("http://localhost/api/agent/admin/test-connection", {
      method: "POST",
      body: JSON.stringify({ explicitUserIntent: true }),
    }));

    expect(status.status).toBe(200);
    expect(await jsonPayload(status)).toMatchObject({ worker: { serviceActive: true, mode: "agenos-bun-worker" } });
    expect(config.status).toBe(200);
    expect(await jsonPayload(config)).toMatchObject({ apiAuth: { configured: false } });
    expect(policy.status).toBe(200);
    expect(await jsonPayload(policy)).toMatchObject({ rules: [{ ruleId: "agent.shell.deny" }] });
    expect(writeConfig.status).toBe(409);
    expect(restart.status).toBe(409);
    expect(testConnection.status).toBe(503);
  });

  test("serves a production support bundle for diagnostics", async () => {
    const handler = createInstallerApiHandler({
      supportBundle: async () => ({
        schemaVersion: 1,
        generatedAt: "2026-05-16T12:00:00.000Z",
        runtime: { paths: { apiLog: "/home/agenos/.cache/agenos-installer/runtime/api.log" } },
        commands: [
          { command: "journalctl", args: ["-u", "agenos-agent-api.service"], ok: true, stdout: "[redacted]" },
        ],
      }),
    });

    const response = await handler.fetch(new Request("http://localhost/api/diagnostics/support-bundle"));

    expect(response.status).toBe(200);
    expect(await jsonPayload(response)).toMatchObject({
      schemaVersion: 1,
      commands: [{ command: "journalctl", stdout: "[redacted]" }],
    });
  });
});
