import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import App from "./App";

const mocks = vi.hoisted(() => ({
  agentAdminClient: {
    getStatus: vi.fn(),
    getPolicy: vi.fn(),
    listConfirmations: vi.fn(),
    rerunSetup: vi.fn(),
  },
  agentClient: {
    appendMemory: vi.fn(),
    delegateBackgroundTask: vi.fn(),
    openApp: vi.fn(),
  },
  piClient: {
    getStatus: vi.fn(),
    startAuth: vi.fn(),
    getAuthAttempt: vi.fn(),
    submitManualCode: vi.fn(),
    logout: vi.fn(),
    sendMessage: vi.fn(),
  },
}));

vi.mock("./components/VideoBackground", () => ({
  VideoBackground: () => null,
}));

vi.mock("./lib/pi-client", () => {
  class PiClientError extends Error {
    readonly status: number | undefined;

    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  }

  return {
    PiClientError,
    createPiClient: () => mocks.piClient,
  };
});

vi.mock("./lib/agent-client", () => ({
  createAgentClient: () => mocks.agentClient,
}));

vi.mock("./lib/agent-admin-client", () => ({
  createAgentAdminClient: () => mocks.agentAdminClient,
}));

vi.mock("./lib/speech-recognition", () => ({
  createSpeechRecognitionController: () => ({
    supported: false,
    start: vi.fn(),
    dispose: vi.fn(),
  }),
  isSpeechRecognitionSupported: () => false,
}));

const disconnectedStatus = {
  authState: "disconnected",
  providerName: "ChatGPT/Codex",
  modelId: "gpt-5.4-mini",
  busy: false,
};

const readyAgentStatus = {
  ok: true,
  readiness: "ready",
  setupItems: [],
  worker: {
    mode: "agenos-bun-worker",
    serviceActive: true,
    version: "0.1.0",
    queueDepth: 0,
    degradedReason: null,
    lastHeartbeatAt: null,
    lastError: null,
    lastErrorCorrelationId: null,
  },
  config: {
    mode: "auto",
    provider: "openai",
    model: "gpt-5.4-mini",
    stateDir: "/home/agenos/.agenos/openclaw",
    apiAuth: { type: "env", envVar: "OPENAI_API_KEY", configured: true },
    channels: { email: false, telegram: false, whatsapp: false },
    policyDefaults: { memoryWrite: "confirm", outboundSend: "confirm" },
  },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("App chat recovery", () => {
  test("shows agent onboarding and health checklist on first load", async () => {
    mocks.piClient.getStatus.mockResolvedValue(disconnectedStatus);
    mocks.agentAdminClient.getStatus.mockResolvedValue(readyAgentStatus);

    render(<App />);

    expect(await screen.findByText("Conecta ChatGPT/Codex")).toBeInTheDocument();
    expect(screen.getByText("Broker local disponible")).toBeInTheDocument();
    expect(screen.getByText("Worker listo")).toBeInTheDocument();
    expect(screen.getByText("Conecta ChatGPT")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir navegador" })).not.toBeInTheDocument();
  });

  test("refreshing status clears a stale auth error and returns to the disconnected state", async () => {
    mocks.piClient.getStatus.mockResolvedValue(disconnectedStatus);
    mocks.agentAdminClient.getStatus.mockResolvedValue(readyAgentStatus);
    mocks.piClient.startAuth.mockRejectedValue(new Error("codex login --device-auth termino con codigo 1."));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Conectar ChatGPT con codigo" }));

    await waitFor(() => {
      expect(mocks.piClient.startAuth).toHaveBeenCalledWith("device");
    });
    expect(await screen.findByText("codex login --device-auth termino con codigo 1.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refrescar estado" }));

    await waitFor(() => {
      expect(screen.queryByText("codex login --device-auth termino con codigo 1.")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Conecta ChatGPT para empezar.")).toBeInTheDocument();
  });

  test("sends app launch requests to the foreground model", async () => {
    mocks.piClient.getStatus.mockResolvedValue({
      ...disconnectedStatus,
      authState: "connected",
    });
    mocks.agentAdminClient.getStatus.mockResolvedValue(readyAgentStatus);
    mocks.piClient.sendMessage.mockResolvedValue({
      ok: true,
      reply: "Abriendo Chrome.",
      provider: "openai-codex",
      modelId: "gpt-5.4-mini",
    });

    render(<App />);

    const input = await screen.findByLabelText("Texto");
    fireEvent.change(input, { target: { value: "abre Chrome" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => {
      expect(mocks.piClient.sendMessage).toHaveBeenCalledWith("abre Chrome", "text");
    });
    expect(mocks.agentClient.openApp).not.toHaveBeenCalled();
    expect(await screen.findByText("Abriendo Chrome.")).toBeInTheDocument();
  });

  test("opens backend and explains the next OpenClaw setup step from chat", async () => {
    mocks.piClient.getStatus.mockResolvedValue(disconnectedStatus);
    mocks.agentAdminClient.getPolicy.mockResolvedValue({ rules: [] });
    mocks.agentAdminClient.listConfirmations.mockResolvedValue([]);
    mocks.agentAdminClient.getStatus.mockResolvedValue({
      ...readyAgentStatus,
      ok: false,
      readiness: "needs_setup",
      setupItems: [
        {
          id: "backend-codex-auth",
          label: "Connect backend Codex auth for OpenClaw.",
          severity: "warning",
          action: "connect_backend_codex",
        },
      ],
      setup: {
        phase: "needs_auth",
        message: "Backend Codex auth is not configured.",
        actions: ["codex.login", "telegram.configure"],
      },
    });
    mocks.agentAdminClient.rerunSetup.mockResolvedValue({
      ok: false,
      phase: "needs_auth",
      message: "Backend Codex auth is not configured.",
      actions: ["codex.login", "telegram.configure"],
    });

    render(<App />);

    const input = await screen.findByLabelText("Texto");
    fireEvent.change(input, { target: { value: "haz un setup de openclaw" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(mocks.agentAdminClient.rerunSetup).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("agenos-bun-worker")).toBeInTheDocument();
    expect(screen.getByText(/Siguiente paso: conecta Codex backend/i)).toBeInTheDocument();
  });
});
