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
import type { NetworkStatusResponse } from "../../../network/types";
import { createInstallerApiHandler } from "./server";
import { createConfirmationStore } from "./agent/confirmations";
import { createLearnedMemoryStore } from "./agent/learned-memory";
import { createLocalUiAuth, UI_SESSION_COOKIE } from "./agent/ui-auth";

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

const onlineNetworkStatus: NetworkStatusResponse = {
  ok: true,
  overall: "online",
  checkedAt: "2026-06-08T00:00:00.000Z",
  wifiEnabled: true,
  wirelessHardware: "available",
  activeConnection: {
    id: "AgenOS",
    type: "wifi",
    ssid: "AgenOS",
    strength: 80,
  },
  internet: {
    ok: true,
    captivePortalSuspected: false,
    message: "Internet disponible.",
  },
  providers: {
    codex: "reachable",
    gemini: "reachable",
  },
};

function fakeNetwork() {
  return {
    getStatus: async () => onlineNetworkStatus,
    scanWifi: async () => ({ ok: true as const, message: "scan" }),
    listAccessPoints: async () => ({
      ok: true as const,
      accessPoints: [
        {
          ssid: "AgenOS",
          bssid: "00:11:22:33:44:55",
          strength: 80,
          security: "wpa2" as const,
          frequencyMHz: 2412,
          device: "/dev/wlan0",
        },
      ],
    }),
    connectWifi: async () => ({
      ok: true,
      status: "connected" as const,
      message: "Conexión Wi-Fi lista.",
    }),
    disconnectWifi: async () => ({ ok: true, message: "Wi-Fi desconectado." }),
    setWifiEnabled: async (enabled: boolean) => ({ ok: true, message: enabled ? "Wi-Fi activado." : "Wi-Fi desactivado." }),
  };
}

function fakeSpeech() {
  return {
    status: () => ({
      ok: true as const,
      available: true,
      engine: "whisper.cpp" as const,
      model: "/opt/agenos/system/whisper.cpp/models/ggml-base.bin",
      reason: null,
    }),
    transcribe: async () => ({
      ok: true as const,
      text: "abre fotos",
      durationMs: 850,
      engine: "whisper.cpp" as const,
      model: "/opt/agenos/system/whisper.cpp/models/ggml-base.bin",
    }),
  };
}

const allowUiAuth = {
  authorizeUiRequest: () => ({ ok: true as const }),
  attachSession: (response: Response) => response,
  authorizationHeader: () => "Bearer test-ui-token",
};

function createAuthenticatedHandler(overrides: Parameters<typeof createInstallerApiHandler>[0] = {}) {
  return createInstallerApiHandler({
    uiAuth: allowUiAuth,
    ...overrides,
  });
}

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
    cancelAuth: () => null,
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
    startChat: () => ({
      turnId: "turn_abc",
      status: "processing" as const,
      source: "text" as const,
      input: "hola",
      startedAt: "2026-07-03T12:00:00.000Z",
      progress: {
        startedAt: "2026-07-03T12:00:00.000Z",
        streamedText: "",
        currentTool: null,
        completedTools: [],
      },
    }),
    getTurn: (turnId: string) => ({
      turnId,
      status: "succeeded" as const,
      source: "text" as const,
      input: "hola",
      startedAt: "2026-07-03T12:00:00.000Z",
      finishedAt: "2026-07-03T12:00:05.000Z",
      progress: {
        startedAt: "2026-07-03T12:00:00.000Z",
        streamedText: "hecho",
        currentTool: null,
        completedTools: ["openclaw_setup"],
      },
      reply: "hecho",
      modelId: "gpt-5.4-mini",
    }),
    getLatestTurn: () => null,
    listTurns: () => [
      {
        turnId: "turn_abc",
        status: "succeeded" as const,
        source: "text" as const,
        input: "hola",
        startedAt: "2026-07-03T12:00:00.000Z",
        finishedAt: "2026-07-03T12:00:05.000Z",
        progress: {
          startedAt: "2026-07-03T12:00:00.000Z",
          streamedText: "hecho",
          currentTool: null,
          completedTools: [],
        },
        reply: "hecho",
        modelId: "gpt-5.4-mini",
      },
    ],
  };

  return createAuthenticatedHandler({
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
    network: fakeNetwork(),
    speech: fakeSpeech(),
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

  test("serves network status", async () => {
    const handler = createHandler();

    const response = await handler.fetch(new Request("http://localhost/api/network/status"));

    expect(response.status).toBe(200);
    expect(await jsonPayload(response)).toEqual(onlineNetworkStatus);
  });

  test("connects to Wi-Fi without echoing the password", async () => {
    const handler = createHandler({
      network: {
        ...fakeNetwork(),
        connectWifi: async (request: { password?: string }) => ({
          ok: request.password === "secret-password",
          status: request.password === "secret-password" ? "connected" as const : "failed" as const,
          message: "Conexión Wi-Fi lista.",
        }),
      },
    });

    const response = await handler.fetch(new Request("http://localhost/api/network/wifi/connect", {
      method: "POST",
      body: JSON.stringify({
        ssid: "AgenOS",
        password: "secret-password",
      }),
    }));

    const payload = await jsonPayload(response);
    expect(response.status).toBe(202);
    expect(JSON.stringify(payload)).not.toContain("secret-password");
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

  test("starts an async pi turn through the packaged API", async () => {
    const handler = createHandler();

    const response = await handler.fetch(new Request("http://localhost/api/pi/turns", {
      method: "POST",
      body: JSON.stringify({
        message: "hola",
        source: "text",
      }),
    }));

    expect(response.status).toBe(202);
    expect(await jsonPayload(response)).toMatchObject({
      turnId: "turn_abc",
      status: "processing",
      input: "hola",
    });
  });

  test("rejects async pi turns with an invalid source", async () => {
    const handler = createHandler();

    const response = await handler.fetch(new Request("http://localhost/api/pi/turns", {
      method: "POST",
      body: JSON.stringify({
        message: "hola",
        source: "invalid",
      }),
    }));

    expect(response.status).toBe(400);
  });

  test("lists pi turn history through the packaged API", async () => {
    const handler = createHandler();

    const response = await handler.fetch(new Request("http://localhost/api/pi/turns?limit=10"));

    expect(response.status).toBe(200);
    const payload = await jsonPayload(response) as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({ turnId: "turn_abc", status: "succeeded", reply: "hecho" });
  });

  test("serves pi turn state and latest turn through the packaged API", async () => {
    const handler = createHandler();

    const turn = await handler.fetch(new Request("http://localhost/api/pi/turns/turn_abc"));
    const latest = await handler.fetch(new Request("http://localhost/api/pi/turns/latest"));

    expect(turn.status).toBe(200);
    expect(await jsonPayload(turn)).toMatchObject({
      turnId: "turn_abc",
      status: "succeeded",
      reply: "hecho",
    });
    expect(latest.status).toBe(200);
    expect(await jsonPayload(latest)).toBeNull();
  });

  test("keeps health available when the default pi harness cannot initialize", async () => {
    const handler = createAuthenticatedHandler({
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
    const handler = createAuthenticatedHandler({ memoryStore: memory as never });

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

  test("public memory routes cannot spoof the OpenClaw source", async () => {
    const confirmationRoot = mkdtempSync(join(tmpdir(), "agenos-confirmations-"));
    const handler = createAuthenticatedHandler({
      confirmations: createConfirmationStore({ rootDir: confirmationRoot }),
    });

    const response = await handler.fetch(new Request("http://localhost/api/agent/memory/facts", {
      method: "POST",
      body: JSON.stringify({
        content: "Pablo Lopez es mi profesor",
        source: "openclaw",
        explicitUserIntent: false,
      }),
    }));

    expect(response.status).toBe(403);
    expect(await jsonPayload(response)).toMatchObject({
      ok: false,
      decision: "deny",
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
    const handler = createAuthenticatedHandler({ memoryStore: memory as never });

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

  test("learning proposals require confirmation and remain user-correctable and deletable", async () => {
    const root = mkdtempSync(join(tmpdir(), "agenos-learning-api-"));
    const confirmations = createConfirmationStore({
      rootDir: join(root, "confirmations"),
      idFactory: () => "conf_learning",
      now: () => new Date("2026-08-13T10:00:00.000Z"),
    });
    const learnedMemory = createLearnedMemoryStore({
      rootDir: join(root, "memory"),
      itemIdFactory: () => "learn_1",
      now: () => new Date("2026-08-13T10:00:00.000Z"),
    });
    const handler = createAuthenticatedHandler({ confirmations, learnedMemory });
    const trace = {
      schemaVersion: 1,
      traceId: "trace_learning",
      timestamp: "2026-08-13T10:00:00.000Z",
      source: "pi-chat",
      channel: "text",
      status: "succeeded",
      durationMs: 20,
      harness: { promptHash: "hash", tools: [] },
      input: { text: "Prefiero respuestas en tres viñetas", length: 35, truncated: false },
      output: { text: "Entendido", length: 9, truncated: false },
      toolEvents: [],
    };

    const capture = await handler.fetch(new Request("http://localhost/api/agent/learning/signals/harness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(trace),
    }));
    expect(capture.status).toBe(202);
    expect(await jsonPayload(capture)).toMatchObject({ ok: true, proposals: 1 });

    expect(await jsonPayload(await handler.fetch(new Request("http://localhost/api/agent/learning/memories")))).toEqual([]);
    expect(confirmations.get("conf_learning")).toMatchObject({
      status: "pending",
      source: "system",
      tool: "memory.write",
      input: { learned: { statement: "Prefiero respuestas en tres viñetas" } },
    });

    const confirmed = await handler.fetch(new Request("http://localhost/api/agent/confirmations/conf_learning/confirm", { method: "POST" }));
    expect(confirmed.status).toBe(202);
    const active = await jsonPayload(await handler.fetch(new Request("http://localhost/api/agent/learning/memories")));
    expect(active).toEqual([expect.objectContaining({ itemId: "learn_1", statement: "Prefiero respuestas en tres viñetas", confirmationId: "conf_learning" })]);

    const context = await jsonPayload(await handler.fetch(new Request("http://localhost/api/agent/learning/context?query=respuestas&tokenBudget=160")));
    expect(context).toMatchObject({ itemIds: ["learn_1"], tokenBudget: 160 });

    const corrected = await handler.fetch(new Request("http://localhost/api/agent/learning/memories/learn_1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statement: "Prefiero respuestas en dos viñetas", explicitUserIntent: true }),
    }));
    expect(corrected.status).toBe(202);
    expect(await jsonPayload(corrected)).toMatchObject({ statement: "Prefiero respuestas en dos viñetas", userEdited: true });

    const forgotten = await handler.fetch(new Request("http://localhost/api/agent/learning/memories/learn_1", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ explicitUserIntent: true }),
    }));
    expect(forgotten.status).toBe(202);
    expect(await jsonPayload(await handler.fetch(new Request("http://localhost/api/agent/learning/memories")))).toEqual([]);
  });

  test("agent task route enqueues background work", async () => {
    const taskQueue = {
      enqueue: () => ({ ok: true, taskId: "task_test", message: "Tarea enviada al worker de fondo." }),
      health: () => ({ ok: true, mode: "local-simulated" }),
    };
    const handler = createAuthenticatedHandler({ taskQueue: taskQueue as never });

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
    const handler = createAuthenticatedHandler({ taskQueue: taskQueue as never });

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
    const handler = createAuthenticatedHandler({ taskQueue: taskQueue as never });

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
    const handler = createAuthenticatedHandler({ browserTool: browserTool as never });

    const response = await handler.fetch(new Request("http://localhost/api/agent/browser/open-url", {
      method: "POST",
      body: JSON.stringify({ url: "netflix.com" }),
    }));

    expect(response.status).toBe(202);
    expect(opened).toEqual(["netflix.com"]);
  });

  test("agent apps route opens allowlisted apps", async () => {
    const opened: unknown[] = [];
    const appTool = {
      openApp: async (input: unknown) => {
        opened.push(input);
        return { ok: true, appId: "browser", message: "Abriendo Chrome." };
      },
    };
    const handler = createAuthenticatedHandler({ appTool: appTool as never });

    const response = await handler.fetch(new Request("http://localhost/api/agent/apps/open", {
      method: "POST",
      body: JSON.stringify({ app: "Chrome", workspace: 3, focus: true }),
    }));

    expect(response.status).toBe(202);
    expect(opened).toEqual([{ app: "Chrome", workspace: 3, focus: true }]);
  });

  test("agent files route opens paths through the broker runner", async () => {
    const opened: unknown[] = [];
    const handler = createAuthenticatedHandler({
      fileTool: {
        openPath: async (input: unknown) => {
          opened.push(input);
          return { ok: true, path: "/home/agenos/Fotos/a.png", message: "Foto abierta." };
        },
      } as never,
    });

    const response = await handler.fetch(new Request("http://localhost/api/agent/files/open", {
      method: "POST",
      body: JSON.stringify({ path: "~/Fotos/a.png", workspace: 4, focus: true }),
    }));

    expect(response.status).toBe(202);
    expect(opened).toEqual([{ path: "~/Fotos/a.png", workspace: 4, focus: true }]);
  });

  test("agent workspace routes list and focus known workspaces", async () => {
    const focused: unknown[] = [];
    const workspaceService = {
      listWorkspaces: () => ({
        ok: true,
        activeWorkspace: 1,
        workspaces: [{ number: 1, name: "1:home", label: "Home" }],
      }),
      focusWorkspace: async (input: unknown) => {
        focused.push(input);
        return {
          ok: true,
          activeWorkspace: 2,
          workspaces: [{ number: 2, name: "2:app", label: "Apps" }],
        };
      },
    };
    const handler = createHandler({ workspaceService: workspaceService as never });

    const list = await handler.fetch(new Request("http://localhost/api/agent/workspaces"));
    expect(list.status).toBe(200);
    expect(await jsonPayload(list)).toMatchObject({ activeWorkspace: 1 });

    const response = await handler.fetch(new Request("http://localhost/api/agent/workspaces/focus", {
      method: "POST",
      body: JSON.stringify({ workspace: 2, source: "ui" }),
    }));
    expect(response.status).toBe(202);
    expect(focused).toEqual([{ workspace: 2, source: "ui" }]);
  });

  test("agent workspace event route streams real state changes", async () => {
    let listener: ((state: unknown) => void) | undefined;
    let unsubscribed = false;
    const workspaceService = {
      listWorkspaces: () => ({ ok: true, activeWorkspace: 1, workspaces: [] }),
      focusWorkspace: async () => ({ ok: true, activeWorkspace: 1, workspaces: [] }),
      subscribeWorkspaceChanges: (next: (state: unknown) => void) => {
        listener = next;
        return () => {
          unsubscribed = true;
        };
      },
    };
    const handler = createHandler({ workspaceService: workspaceService as never });
    const response = await handler.fetch(new Request("http://localhost/api/agent/workspaces/events"));
    const reader = response.body?.getReader();

    listener?.({ ok: true, activeWorkspace: 4, workspaces: [] });
    const chunk = await reader?.read();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(new TextDecoder().decode(chunk?.value)).toBe(
      'data: {"ok":true,"activeWorkspace":4,"workspaces":[]}\n\n',
    );
    await reader?.cancel();
    expect(unsubscribed).toBe(true);
  });

  test("agent shell route executes explicit frontend commands", async () => {
    const commands: string[] = [];
    const shellTool = async (input: { command: string; cwd?: string; timeoutMs?: number }) => {
      commands.push(input.command);
      return {
        ok: true,
        command: input.command,
        cwd: input.cwd ?? "/home/agenos",
        exitCode: 0,
        signal: null,
        stdout: "uid=1000\n",
        stderr: "",
        timedOut: false,
        message: "Comando completado.",
      };
    };
    const handler = createAuthenticatedHandler({ shellTool: shellTool as never });

    const response = await handler.fetch(new Request("http://localhost/api/agent/shell/exec", {
      method: "POST",
      body: JSON.stringify({ command: "id" }),
    }));

    expect(response.status).toBe(202);
    expect(await jsonPayload(response)).toMatchObject({ ok: true, stdout: "uid=1000\n" });
    expect(commands).toEqual(["id"]);
  });

  test("agent shell rejects unauthenticated and foreign-origin requests before execution", async () => {
    const commands: string[] = [];
    const uiAuth = createLocalUiAuth({
      tokenPath: join(mkdtempSync(join(tmpdir(), "agenos-server-auth-")), "ui-token"),
      tokenFactory: () => "server_ui_secret",
    });
    const handler = createInstallerApiHandler({
      uiAuth,
      shellTool: (async (input: { command: string }) => {
        commands.push(input.command);
        return { ok: true, message: "ok" };
      }) as never,
    });

    const unauthenticated = await handler.fetch(new Request("http://127.0.0.1:4173/api/agent/shell/exec", {
      method: "POST",
      headers: { Origin: "http://127.0.0.1:4173", "Content-Type": "application/json" },
      body: JSON.stringify({ command: "id" }),
    }));
    const foreignOrigin = await handler.fetch(new Request("http://127.0.0.1:4173/api/agent/shell/exec", {
      method: "POST",
      headers: {
        Authorization: "Bearer server_ui_secret",
        Origin: "https://attacker.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: "id" }),
    }));
    const authenticated = await handler.fetch(new Request("http://127.0.0.1:4173/api/agent/shell/exec", {
      method: "POST",
      headers: {
        Cookie: `${UI_SESSION_COOKIE}=server_ui_secret`,
        Origin: "http://127.0.0.1:4173",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: "id" }),
    }));

    expect(unauthenticated.status).toBe(401);
    expect(foreignOrigin.status).toBe(403);
    expect(foreignOrigin.headers.get("access-control-allow-origin")).toBeNull();
    expect(authenticated.status).toBe(202);
    expect(commands).toEqual(["id"]);
  });

  test("destructive UI shell creates a pending confirmation and does not execute", async () => {
    const commands: string[] = [];
    const confirmations = createConfirmationStore({
      rootDir: mkdtempSync(join(tmpdir(), "agenos-shell-confirm-")),
      idFactory: () => "conf_destructive_shell",
    });
    const handler = createAuthenticatedHandler({
      confirmations,
      shellTool: (async (input: { command: string }) => {
        commands.push(input.command);
        return { ok: true, message: "unexpected" };
      }) as never,
    });

    const response = await handler.fetch(new Request("http://localhost/api/agent/shell/exec", {
      method: "POST",
      body: JSON.stringify({ command: "rm -rf ~/Documentos" }),
    }));

    expect(response.status).toBe(409);
    expect(await jsonPayload(response)).toMatchObject({
      decision: "confirm",
      confirmationId: "conf_destructive_shell",
    });
    expect(confirmations.get("conf_destructive_shell")).toMatchObject({
      status: "pending",
      tool: "shell.exec",
    });
    expect(commands).toEqual([]);
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
    const handler = createAuthenticatedHandler({ agentAdmin: agentAdmin as never });

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

  test("agent setup endpoints expose rerun Codex and Telegram actions", async () => {
    const calls: string[] = [];
    const setup = {
      status: async () => ({ ok: false, phase: "needs_auth", actions: ["codex.login"], message: "login required" }),
      run: async () => {
        calls.push("run");
        return { ok: false, phase: "needs_auth", actions: ["codex.login"], message: "login required" };
      },
      startCodexLogin: async () => {
        calls.push("codex");
        return {
          ok: false,
          phase: "needs_auth",
          actions: ["codex.login"],
          message: "Run backend Codex login.",
          command: ["/usr/bin/openclaw", "models", "auth", "login", "--provider", "openai-codex"],
        };
      },
      configureTelegram: async (token: string) => {
        calls.push(`telegram:${token}`);
        return { ok: false, phase: "needs_channel", actions: ["telegram.test"], telegram: { tokenConfigured: true } };
      },
      testTelegram: async () => {
        calls.push("telegram-test");
        return { ok: true, phase: "ready", actions: ["telegram.enable"], telegram: { lastTestOk: true } };
      },
      enableTelegram: async () => {
        calls.push("telegram-enable");
        return { ok: true, phase: "ready", actions: [], telegram: { enabled: true } };
      },
    };
    const handler = createAuthenticatedHandler({ setup: setup as never });

    const status = await handler.fetch(new Request("http://localhost/api/agent/setup/status"));
    const rerun = await handler.fetch(new Request("http://localhost/api/agent/setup/run", { method: "POST" }));
    const codex = await handler.fetch(new Request("http://localhost/api/agent/auth/codex/start", { method: "POST" }));
    const configureTelegram = await handler.fetch(new Request("http://localhost/api/agent/channels/telegram/configure", {
      method: "POST",
      body: JSON.stringify({ token: "123456:secret" }),
    }));
    const testTelegram = await handler.fetch(new Request("http://localhost/api/agent/channels/telegram/test", { method: "POST" }));
    const enableTelegram = await handler.fetch(new Request("http://localhost/api/agent/channels/telegram/enable", { method: "POST" }));

    expect(status.status).toBe(200);
    expect(await jsonPayload(status)).toMatchObject({ phase: "needs_auth" });
    expect(rerun.status).toBe(202);
    expect(codex.status).toBe(202);
    expect(await jsonPayload(codex)).toMatchObject({ command: ["/usr/bin/openclaw", "models", "auth", "login", "--provider", "openai-codex"] });
    expect(configureTelegram.status).toBe(202);
    expect(testTelegram.status).toBe(202);
    expect(enableTelegram.status).toBe(202);
    expect(calls).toEqual(["run", "codex", "telegram:123456:secret", "telegram-test", "telegram-enable"]);
  });

  test("serves a production support bundle for diagnostics", async () => {
    const handler = createAuthenticatedHandler({
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

  test("serves /api/speech/status", async () => {
    const handler = createHandler();

    const response = await handler.fetch(new Request("http://localhost/api/speech/status"));

    expect(response.status).toBe(200);
    expect(await jsonPayload(response)).toMatchObject({
      ok: true,
      available: true,
      engine: "whisper.cpp",
    });
  });

  test("transcribes audio through /api/speech/transcribe", async () => {
    const handler = createHandler();

    const response = await handler.fetch(new Request("http://localhost/api/speech/transcribe?lang=es", {
      method: "POST",
      headers: { "content-type": "audio/webm" },
      body: new Uint8Array([1, 2, 3]),
    }));

    expect(response.status).toBe(200);
    expect(await jsonPayload(response)).toMatchObject({
      ok: true,
      text: "abre fotos",
      engine: "whisper.cpp",
    });
  });

  test("rejects empty audio bodies on /api/speech/transcribe", async () => {
    const handler = createHandler();

    const response = await handler.fetch(new Request("http://localhost/api/speech/transcribe", {
      method: "POST",
      headers: { "content-type": "audio/webm" },
    }));

    expect(response.status).toBe(400);
  });

  test("maps speech engine unavailability to 503", async () => {
    const handler = createHandler({
      speech: {
        status: () => ({ ok: true, available: false, engine: null, model: null, reason: "falta whisper-cli" }),
        transcribe: async () => ({ ok: false, code: "unavailable", message: "falta whisper-cli" }),
      },
    });

    const response = await handler.fetch(new Request("http://localhost/api/speech/transcribe", {
      method: "POST",
      headers: { "content-type": "audio/webm" },
      body: new Uint8Array([1, 2, 3]),
    }));

    expect(response.status).toBe(503);
    expect(await jsonPayload(response)).toMatchObject({ ok: false, message: "falta whisper-cli" });
  });
});
