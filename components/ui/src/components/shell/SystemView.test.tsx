import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { SystemView, type SystemViewProps } from "./SystemView";
import type { AgentHealthController } from "../../hooks/useAgentHealth";
import type { PiSession } from "../../hooks/usePiSession";
import type { ShellActions } from "../../hooks/useShellActions";
import type { AgentAdminStatus, AgentWorkspace } from "../../lib/system-types";

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

const workspaces: AgentWorkspace[] = [
  { number: 1, name: "1:home", label: "Inicio" },
  { number: 2, name: "2:app", label: "Apps" },
];

// El panel de administración pide su estado al montarse; aquí solo importa que
// siga colgando de esta vista, así que se le da un cliente que no responde.
const adminClient = {
  getStatus: vi.fn().mockResolvedValue(readyAdminStatus),
  getConfig: vi.fn(),
  getPolicy: vi.fn().mockResolvedValue([]),
  updateConfig: vi.fn(),
  restart: vi.fn(),
  testConnection: vi.fn(),
  getSetupStatus: vi.fn(),
  rerunSetup: vi.fn(),
  startBackendCodexLogin: vi.fn(),
  configureTelegram: vi.fn(),
  testTelegram: vi.fn(),
  enableTelegram: vi.fn(),
  retryTask: vi.fn(),
  clearTask: vi.fn(),
  exportDiagnostics: vi.fn(),
  listConfirmations: vi.fn().mockResolvedValue([]),
  confirm: vi.fn(),
  deny: vi.fn(),
  executeShell: vi.fn(),
};

function renderSystem(overrides: Partial<SystemViewProps> = {}) {
  const session = {
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
  } as unknown as PiSession;

  const actions: ShellActions = {
    connect: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    checkNetwork: vi.fn(),
    openSystem: vi.fn(),
    sendDraft: vi.fn(),
    newConversation: vi.fn(),
    focusWorkspace: vi.fn(),
  };

  const props: SystemViewProps = {
    actions,
    activeWorkspace: 1,
    adminClient: adminClient as unknown as SystemViewProps["adminClient"],
    busy: false,
    health: { status: readyAdminStatus, error: null, refresh: vi.fn() } as AgentHealthController,
    session,
    workspaces,
    workspacesLive: false,
    ...overrides,
  };

  render(<SystemView {...props} />);
  return props;
}

describe("SystemView", () => {
  test("lo primero es la cuenta, y su estado se dice en palabras", () => {
    renderSystem();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sistema");
    expect(screen.getByRole("heading", { name: "Tu cuenta" })).toBeInTheDocument();
    expect(screen.getByText("Ya puedes hablar con Pi.")).toBeInTheDocument();
  });

  test("cuando la cuenta no está conectada lo dice igual de claro", () => {
    const session = {
      ready: true,
      authState: "disconnected",
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
    } as unknown as PiSession;

    renderSystem({ session });

    expect(screen.getByText("Conecta ChatGPT para empezar.")).toBeInTheDocument();
  });

  // Los escritorios se fueron de la barra fija, pero siguen aquí y con nombre.
  test("los escritorios se cambian desde aquí y llevan su nombre escrito", () => {
    renderSystem();

    expect(screen.getByRole("button", { name: "Escritorio 2: Apps" })).toBeInTheDocument();
    expect(screen.getByText("Apps")).toBeInTheDocument();
  });

  // Lo técnico no desaparece (hace falta para defender el proyecto): se pliega.
  test("lo técnico queda agrupado bajo un desplegable, no borrado", () => {
    renderSystem();

    const disclosure = screen.getByText("Detalles técnicos");
    expect(disclosure.tagName).toBe("SUMMARY");
    expect(disclosure.closest("details")).not.toHaveAttribute("open");

    // Sigue montado y alcanzable: checklist, informe de soporte y administración.
    expect(screen.getByRole("heading", { name: "Estado del sistema" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver informe técnico" })).toBeInTheDocument();
  });
});
