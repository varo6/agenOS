import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { HomeView, type HomeViewProps } from "./HomeView";
import { resolveVoiceStatus, voiceButtonLabel } from "../../lib/voice-status";
import type { AgentHealthController } from "../../hooks/useAgentHealth";
import type { Conversation } from "../../hooks/useConversation";
import type { PiSession } from "../../hooks/usePiSession";
import type { ShellActions } from "../../hooks/useShellActions";
import type { VoiceController } from "../../hooks/useVoice";
import type { PiTurnState } from "../../lib/pi-types";
import type { AgentAdminStatus } from "../../lib/system-types";

const readyAdminStatus: AgentAdminStatus = {
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

const succeededTurn: PiTurnState = {
  turnId: "t1",
  status: "succeeded",
  source: "voice",
  input: "abre Chrome",
  startedAt: "2026-07-03T12:00:00.000Z",
  progress: {
    startedAt: "2026-07-03T12:00:00.000Z",
    streamedText: "",
    currentTool: null,
    completedTools: [],
  },
  reply: "Abriendo Chrome.",
};

function voiceController(): VoiceController {
  const status = resolveVoiceStatus({ capture: "idle", turn: "idle" });

  return {
    status,
    buttonLabel: voiceButtonLabel(status),
    engine: null,
    start: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
  };
}

function session(overrides: Partial<PiSession> = {}): PiSession {
  return {
    ready: true,
    authState: "connected",
    providerName: "ChatGPT/Codex",
    modelId: "gpt-5.4-mini",
    busy: false,
    pendingAttempt: null,
    manualCode: "",
    setManualCode: vi.fn(),
    refresh: vi.fn(),
    startAuth: vi.fn(),
    cancelAuth: vi.fn(),
    logout: vi.fn(),
    submitManualCode: vi.fn(),
    markUnauthorized: vi.fn(),
    noteModelId: vi.fn(),
    ...overrides,
  } as PiSession;
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    turns: [],
    activeTurn: null,
    state: "idle",
    draft: "",
    setDraft: vi.fn(),
    send: vi.fn(),
    restore: vi.fn(),
    resetError: vi.fn(),
    ...overrides,
  } as Conversation;
}

function health(overrides: Partial<AgentHealthController> = {}): AgentHealthController {
  return { status: readyAdminStatus, error: null, refresh: vi.fn(), ...overrides } as AgentHealthController;
}

function renderHome(overrides: Partial<HomeViewProps> = {}) {
  const actions: ShellActions = {
    connect: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    checkNetwork: vi.fn(),
    openSystem: vi.fn(),
    sendDraft: vi.fn(),
    focusWorkspace: vi.fn(),
  };

  const props: HomeViewProps = {
    actions,
    blockedReason: null,
    busy: false,
    conversation: conversation(),
    health: health(),
    session: session(),
    voice: voiceController(),
    ...overrides,
  };

  render(<HomeView {...props} />);
  return props;
}

describe("HomeView", () => {
  test("con todo listo la pantalla no pide nada: solo hablar", () => {
    renderHome();

    expect(screen.getByText("Hola, soy Pi")).toBeInTheDocument();
    expect(screen.queryByText("Siguiente paso")).not.toBeInTheDocument();
    expect(screen.queryByText("Tu cuenta")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Escribe a Pi")).toBeEnabled();
  });

  test("sin cuenta conectada ofrece el siguiente paso y el panel para hacerlo", () => {
    renderHome({ blockedReason: "disconnected", session: session({ authState: "disconnected" }) });

    expect(screen.getByText("Conecta ChatGPT/Codex")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conectar ChatGPT" })).toBeInTheDocument();
  });

  test("con el backend caído se explica el fallo sin mandar a otra pantalla", () => {
    renderHome({
      blockedReason: "disconnected",
      health: health({ status: null, error: "Failed to fetch" }),
      session: session({ authState: "disconnected", ready: false }),
    });

    expect(screen.getByText("Backend no disponible")).toBeInTheDocument();
  });

  test("mientras se lee el backend no se acusa a nadie de estar mal configurado", () => {
    renderHome({ health: health({ status: null }) });

    expect(screen.queryByText("Siguiente paso")).not.toBeInTheDocument();
  });

  test("con la cuenta conectada pero el backend a medias no se repite el panel de cuenta", () => {
    renderHome({ health: health({ status: { ...readyAdminStatus, readiness: "degraded" } }) });

    expect(screen.getByText("Backend en modo degradado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reconectar ChatGPT" })).not.toBeInTheDocument();
  });

  test("el campo de texto dice por qué está apagado", () => {
    renderHome({ blockedReason: "offline", session: session({ authState: "disconnected" }) });

    const input = screen.getByLabelText("Escribe a Pi");
    expect(input).toBeDisabled();

    const hintId = input.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(hintId)?.textContent).toContain("Sin internet");
  });

  test("con conversación el saludo deja sitio, pero la pantalla conserva su título", () => {
    renderHome({ conversation: conversation({ turns: [succeededTurn] }) });

    expect(screen.queryByText("Hola, soy Pi")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Conversación con Pi");
    expect(screen.getByText("Abriendo Chrome.")).toBeInTheDocument();
  });

  test("el contenido principal es un landmark al que se puede saltar", () => {
    renderHome();

    expect(screen.getByRole("main")).toHaveAttribute("id", "contenido");
  });
});
