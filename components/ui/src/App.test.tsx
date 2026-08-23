import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
    listWorkspaces: vi.fn(),
    focusWorkspace: vi.fn(),
    subscribeWorkspaceChanges: vi.fn(),
  },
  piClient: {
    getStatus: vi.fn(),
    startAuth: vi.fn(),
    cancelAuth: vi.fn(),
    getAuthAttempt: vi.fn(),
    submitManualCode: vi.fn(),
    logout: vi.fn(),
    sendMessage: vi.fn(),
    startTurn: vi.fn(),
    getTurn: vi.fn(),
    getLatestTurn: vi.fn(),
    listTurns: vi.fn(),
  },
  networkClient: {
    getStatus: vi.fn(),
    scanWifi: vi.fn(),
    listAccessPoints: vi.fn(),
    connectWifi: vi.fn(),
    disconnectWifi: vi.fn(),
    setWifiEnabled: vi.fn(),
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

vi.mock("../../network/client", () => ({
  createNetworkClient: () => mocks.networkClient,
}));

vi.mock("./lib/speech-recognition", () => ({
  createSpeechRecognitionController: () => ({
    supported: false,
    start: vi.fn(),
    dispose: vi.fn(),
  }),
  createPreferredSpeechRecognitionController: async () => ({
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

const onlineNetworkStatus = {
  ok: true,
  overall: "online",
  checkedAt: "2026-06-08T00:00:00.000Z",
  wifiEnabled: true,
  wirelessHardware: "available",
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

const offlineNetworkStatus = {
  ...onlineNetworkStatus,
  overall: "offline",
  internet: {
    ok: false,
    captivePortalSuspected: false,
    message: "Sin conexión a internet.",
  },
  providers: {
    codex: "unknown",
    gemini: "unknown",
  },
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
  vi.resetAllMocks();
});

beforeEach(() => {
  mocks.piClient.getLatestTurn.mockResolvedValue(null);
  mocks.piClient.listTurns.mockResolvedValue([]);
  mocks.networkClient.getStatus.mockResolvedValue(onlineNetworkStatus);
  mocks.networkClient.listAccessPoints.mockResolvedValue({ ok: true, accessPoints: [] });
  mocks.networkClient.scanWifi.mockResolvedValue({ ok: true });
  mocks.networkClient.connectWifi.mockResolvedValue({ ok: true, status: "connected" });
  mocks.networkClient.disconnectWifi.mockResolvedValue({ ok: true });
  mocks.networkClient.setWifiEnabled.mockResolvedValue({ ok: true });
  mocks.agentClient.listWorkspaces.mockResolvedValue({
    ok: true,
    activeWorkspace: 1,
    workspaces: [
      { number: 1, name: "1:home", label: "Home" },
      { number: 2, name: "2:app", label: "Apps" },
      { number: 3, name: "3:web", label: "Web" },
      { number: 4, name: "4:media", label: "Media" },
      { number: 5, name: "5:work", label: "Work" },
    ],
  });
});

describe("App chat recovery", () => {
  test("checks network without waiting for conversation history", async () => {
    let releaseHistory!: (turns: never[]) => void;
    mocks.piClient.listTurns.mockReturnValue(new Promise((resolve) => {
      releaseHistory = resolve;
    }));
    mocks.piClient.getStatus.mockResolvedValue(disconnectedStatus);
    mocks.agentAdminClient.getStatus.mockResolvedValue(readyAgentStatus);

    render(<App />);

    await waitFor(() => {
      expect(mocks.piClient.listTurns).toHaveBeenCalledWith(20);
      expect(mocks.networkClient.getStatus).toHaveBeenCalledOnce();
    });
    expect(screen.getByText("Preparando AgenOS")).toBeInTheDocument();

    releaseHistory([]);
    expect(await screen.findByText("Conecta tu cuenta")).toBeInTheDocument();
  });

  test("shows the network panel and blocks ChatGPT login while offline", async () => {
    mocks.networkClient.getStatus.mockResolvedValue(offlineNetworkStatus);
    mocks.piClient.getStatus.mockResolvedValue(disconnectedStatus);
    mocks.agentAdminClient.getStatus.mockResolvedValue(readyAgentStatus);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Conéctate a internet" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Conectar ChatGPT" })).not.toBeInTheDocument();
  });

  test("shows agent onboarding and health checklist on first load", async () => {
    mocks.piClient.getStatus.mockResolvedValue(disconnectedStatus);
    mocks.agentAdminClient.getStatus.mockResolvedValue(readyAgentStatus);

    render(<App />);

    expect(await screen.findByText("Conecta tu cuenta")).toBeInTheDocument();

    // La checklist técnica vive en Sistema: Inicio solo enseña el siguiente paso.
    fireEvent.click(screen.getByRole("button", { name: /^Sistema/ }));

    expect(screen.getByText("Servicio de Pi")).toBeInTheDocument();
    expect(screen.getByText("Motor de tareas")).toBeInTheDocument();
    expect(screen.getByText("Conecta ChatGPT")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir navegador" })).not.toBeInTheDocument();
  });

  test("refreshing status clears a stale auth error and returns to the disconnected state", async () => {
    mocks.piClient.getStatus.mockResolvedValue(disconnectedStatus);
    mocks.agentAdminClient.getStatus.mockResolvedValue(readyAgentStatus);
    mocks.piClient.startAuth.mockRejectedValue(new Error("codex login --device-auth termino con codigo 1."));

    render(<App />);

    // En Inicio solo hay un camino: el botón del paso que falta.
    fireEvent.click(await screen.findByRole("button", { name: "Conectar" }));

    await waitFor(() => {
      expect(mocks.piClient.startAuth).toHaveBeenCalledWith("device");
    });
    expect(await screen.findByText("codex login --device-auth termino con codigo 1.")).toBeInTheDocument();

    // Refrescar el estado es mantenimiento: vive en Sistema, con la cuenta.
    fireEvent.click(screen.getByRole("button", { name: /^Sistema/ }));
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));

    await waitFor(() => {
      expect(screen.queryByText("codex login --device-auth termino con codigo 1.")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Conecta ChatGPT para empezar.")).toBeInTheDocument();
  });

  test("can cancel a pending auth attempt and start over", async () => {
    const pendingStatus = {
      ...disconnectedStatus,
      authState: "authorizing",
      pendingAttempt: {
        attemptId: "att_123",
        method: "device",
        url: "https://auth.openai.com/codex/device",
        instructions: "Abre el enlace",
        expiresAt: "2026-04-21T00:10:00.000Z",
        userCode: "ABCD-EFGH",
      },
    };

    mocks.piClient.getStatus
      .mockResolvedValue(pendingStatus);
    mocks.agentAdminClient.getStatus.mockResolvedValue(readyAgentStatus);
    mocks.piClient.getAuthAttempt.mockResolvedValue({
      attemptId: "att_123",
      method: "device",
      status: "pending",
      expiresAt: "2026-04-21T00:10:00.000Z",
    });
    mocks.piClient.cancelAuth.mockImplementation(async () => {
      mocks.piClient.getStatus.mockResolvedValue(disconnectedStatus);
    });

    render(<App />);

    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(mocks.piClient.cancelAuth).toHaveBeenCalledWith("att_123");
    });
    await waitFor(() => {
      expect(screen.queryByText("ABCD-EFGH")).not.toBeInTheDocument();
    });
    // Cancelado el intento, vuelve a haber un único botón para empezar de nuevo.
    expect(screen.getByRole("button", { name: "Conectar" })).not.toBeDisabled();
  });

  test("sends app launch requests to the foreground model as async turns", async () => {
    const baseTurn = {
      turnId: "turn_1",
      source: "text" as const,
      input: "abre Chrome",
      startedAt: "2026-07-03T12:00:00.000Z",
      progress: {
        startedAt: "2026-07-03T12:00:00.000Z",
        streamedText: "",
        currentTool: null,
        completedTools: [],
      },
    };

    mocks.piClient.getStatus.mockResolvedValue({
      ...disconnectedStatus,
      authState: "connected",
    });
    mocks.agentAdminClient.getStatus.mockResolvedValue(readyAgentStatus);
    mocks.piClient.startTurn.mockResolvedValue({ ...baseTurn, status: "processing" });
    mocks.piClient.getTurn.mockResolvedValue({
      ...baseTurn,
      status: "succeeded",
      finishedAt: "2026-07-03T12:00:05.000Z",
      reply: "Abriendo Chrome.",
      modelId: "gpt-5.4-mini",
    });

    render(<App />);

    const input = await screen.findByLabelText("Escribe a Pi");
    fireEvent.change(input, { target: { value: "abre Chrome" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => {
      expect(mocks.piClient.startTurn).toHaveBeenCalledWith("abre Chrome", "text");
    });
    await waitFor(() => {
      expect(mocks.piClient.getTurn).toHaveBeenCalledWith("turn_1");
    });
    expect(mocks.agentClient.openApp).not.toHaveBeenCalled();
    // Sale dos veces a propósito: destacada bajo el campo y en el historial.
    expect(await screen.findAllByText("Abriendo Chrome.")).not.toHaveLength(0);
  });

  test("resumes a processing turn after the renderer reloads", async () => {
    const processingTurn = {
      turnId: "turn_resume",
      status: "processing" as const,
      source: "text" as const,
      input: "configura openclaw",
      startedAt: "2026-07-03T12:00:00.000Z",
      progress: {
        startedAt: "2026-07-03T12:00:00.000Z",
        streamedText: "Voy a configurar OpenClaw.",
        currentTool: "openclaw_setup",
        completedTools: [],
      },
    };

    mocks.piClient.getStatus.mockResolvedValue({
      ...disconnectedStatus,
      authState: "connected",
    });
    mocks.agentAdminClient.getStatus.mockResolvedValue(readyAgentStatus);
    mocks.piClient.listTurns.mockResolvedValue([processingTurn]);
    mocks.piClient.getTurn.mockResolvedValue(processingTurn);

    render(<App />);

    await waitFor(() => {
      expect(mocks.piClient.getTurn).toHaveBeenCalledWith("turn_resume");
    });
    expect(await screen.findAllByText("Voy a configurar OpenClaw.")).not.toHaveLength(0);
    expect(screen.getByText("configura openclaw")).toBeInTheDocument();
  });

  test("escribir no vuelve a arrancar el shell ni a recargar el estado", async () => {
    mocks.piClient.getStatus.mockResolvedValue({
      ...disconnectedStatus,
      authState: "connected",
    });
    mocks.agentAdminClient.getStatus.mockResolvedValue(readyAgentStatus);

    render(<App />);

    const input = await screen.findByLabelText("Escribe a Pi");
    await waitFor(() => {
      expect(mocks.piClient.listTurns).toHaveBeenCalled();
    });

    const statusCalls = mocks.piClient.getStatus.mock.calls.length;
    const historyCalls = mocks.piClient.listTurns.mock.calls.length;

    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.change(input, { target: { value: "hola Pi" } });

    // El arranque solo debe ocurrir una vez: si los efectos dependieran del
    // objeto de conversación, cada tecla relanzaría el bootstrap completo.
    expect(mocks.piClient.listTurns.mock.calls.length).toBe(historyCalls);
    expect(mocks.piClient.getStatus.mock.calls.length).toBe(statusCalls);
  });

  // Los escritorios son cosa del gestor de ventanas, así que ya no ocupan la
  // esquina de la pantalla: se cambian desde Sistema (o hablando con Pi).
  test("shows the workspace switcher in Sistema and focuses workspace clicks", async () => {
    mocks.piClient.getStatus.mockResolvedValue(disconnectedStatus);
    mocks.agentAdminClient.getStatus.mockResolvedValue(readyAgentStatus);
    mocks.agentClient.focusWorkspace.mockResolvedValue({
      ok: true,
      activeWorkspace: 2,
      workspaces: [],
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /^Sistema/ }));

    const target = await screen.findByRole("button", { name: "Escritorio 2: Apps" });
    expect(target).not.toHaveAttribute("aria-current");

    fireEvent.click(target);

    await waitFor(() => {
      expect(mocks.agentClient.focusWorkspace).toHaveBeenCalledWith(2);
    });
    // El escritorio activo se marca de forma programática, no solo por color.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Escritorio 2: Apps" })).toHaveAttribute(
        "aria-current",
        "true",
      );
    });
  });

  // Regresion del sintoma original: la barra mostraba un escritorio distinto del
  // real porque nadie escuchaba a Sway. Un cambio por teclado (Ctrl+Alt+N) o
  // hecho por Pi llega por el stream y tiene que reflejarse igual que un click.
  test("sigue los cambios de escritorio que llegan del stream de Sway", async () => {
    mocks.piClient.getStatus.mockResolvedValue(disconnectedStatus);
    mocks.agentAdminClient.getStatus.mockResolvedValue(readyAgentStatus);
    const unsubscribe = vi.fn();
    mocks.agentClient.subscribeWorkspaceChanges.mockReturnValue(unsubscribe);

    const view = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^Sistema/ }));
    await screen.findByRole("button", { name: /^Escritorio 1:/ });

    const listener = mocks.agentClient.subscribeWorkspaceChanges.mock.calls[0]?.[0];
    expect(listener).toBeTypeOf("function");

    act(() => {
      listener?.({ ok: true, activeWorkspace: 4, workspaces: [] });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Escritorio 4: Media" })).toHaveAttribute(
        "aria-current",
        "true",
      );
    });

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

});
