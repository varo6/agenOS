import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import App from "./App";

const mocks = vi.hoisted(() => ({
  agentAdminClient: {
    getStatus: vi.fn(),
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
  createAgentClient: () => ({
    appendMemory: vi.fn(),
    delegateBackgroundTask: vi.fn(),
  }),
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
});
