import { fireEvent, render, screen } from "@testing-library/react";
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
    finish: vi.fn(),
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
    newConversation: vi.fn(),
    focusWorkspace: vi.fn(),
  };

  const props: HomeViewProps = {
    actions,
    blockedReason: null,
    busy: false,
    conversation: conversation(),
    health: health(),
    session: session(),
    tts: { speaking: false, stop: vi.fn() },
    voice: voiceController(),
    ...overrides,
  };

  render(<HomeView {...props} />);
  return props;
}

const deviceAttempt = {
  attemptId: "att_1",
  method: "device" as const,
  url: "https://auth.openai.com/codex/device",
  instructions: "Abre el enlace y escribe el código.",
  expiresAt: "2026-04-21T00:10:00.000Z",
  userCode: "ABCD-EFGH",
};

describe("HomeView", () => {
  test("con todo listo la pantalla no pide nada: solo hablar", () => {
    renderHome();

    expect(screen.getByText("Hola, soy Pi")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Conecta tu cuenta/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Tu cuenta")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Escribe a Pi")).toBeEnabled();
  });

  // El principio de "un solo camino": mientras falte algo, esa es la pantalla
  // entera. Ni micrófono apagado ni campo de texto apagado al lado.
  test("sin cuenta conectada la pantalla es solo el paso que falta", () => {
    renderHome({ blockedReason: "disconnected", session: session({ authState: "disconnected" }) });

    expect(screen.getByRole("button", { name: "Conectar" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Escribe a Pi")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hablar con Pi" })).not.toBeInTheDocument();
    // El panel de cuenta duplicaría la acción, así que no baja todavía.
    expect(screen.queryByRole("button", { name: "Conectar ChatGPT" })).not.toBeInTheDocument();
  });

  test("el panel de cuenta solo baja cuando hay un código que copiar", () => {
    renderHome({
      blockedReason: "disconnected",
      session: session({ authState: "authorizing", pendingAttempt: deviceAttempt }),
    });

    expect(screen.getByText("Paso 1: abre este enlace")).toBeInTheDocument();
    expect(screen.getByText("ABCD-EFGH")).toBeInTheDocument();
    // En Inicio no se ofrecen las acciones de mantenimiento de la cuenta.
    expect(screen.queryByRole("button", { name: "Cerrar sesión" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actualizar" })).not.toBeInTheDocument();
  });

  test("con el backend caído se explica el fallo sin mandar a otra pantalla", () => {
    renderHome({
      blockedReason: "disconnected",
      health: health({ status: null, error: "Failed to fetch" }),
      session: session({ authState: "disconnected", ready: false }),
    });

    expect(screen.getByText("Pi no está disponible")).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
  });

  test("mientras se lee el backend no se acusa a nadie de estar mal configurado", () => {
    renderHome({ health: health({ status: null }) });

    expect(screen.getByText("Hola, soy Pi")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir Sistema" })).not.toBeInTheDocument();
  });

  // Degradado no es fatal: antes se comía la pantalla principal entera.
  test("con el servicio a medias se puede seguir hablando", () => {
    renderHome({ health: health({ status: { ...readyAdminStatus, readiness: "degraded" } }) });

    expect(screen.getByRole("button", { name: "Hablar con Pi" })).toBeInTheDocument();
    expect(screen.queryByText("Pi funciona a medias")).not.toBeInTheDocument();
  });

  test("un setup pendiente del worker no tapa el Pi foreground ya conectado", () => {
    renderHome({
      health: health({
        status: {
          ...readyAdminStatus,
          readiness: "needs_setup",
          setupItems: [{
            id: "worker-service",
            label: "Servicio de worker inactivo",
            severity: "error",
            action: "view_logs",
          }],
        },
      }),
    });

    expect(screen.getByText("Hola, soy Pi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hablar con Pi" })).toBeInTheDocument();
    expect(screen.getByLabelText("Escribe a Pi")).toBeEnabled();
    expect(screen.queryByText("Falta terminar la configuración")).not.toBeInTheDocument();
  });

  test("el campo de texto dice por qué está apagado", () => {
    renderHome({ blockedReason: "busy", busy: true });

    const input = screen.getByLabelText("Escribe a Pi");
    expect(input).toBeDisabled();

    const hintId = input.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(hintId)?.textContent).toContain("espera");
  });

  test("con conversación el saludo deja sitio, pero la pantalla conserva su título", () => {
    renderHome({ conversation: conversation({ turns: [succeededTurn] }) });

    expect(screen.queryByText("Hola, soy Pi")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Conversación con Pi");
    expect(screen.getAllByText("Abriendo Chrome.").length).toBeGreaterThan(0);
  });

  // Sin conversación el orbe manda: es el gesto principal del sistema.
  test("en reposo el orbe conserva sus dos líneas", () => {
    renderHome();

    expect(screen.getByText("Pulsa para hablar")).toBeInTheDocument();
    expect(screen.getByText("O escríbele aquí abajo.")).toBeInTheDocument();
  });

  // En cuanto hay algo que leer, esos 300px de orbe son la diferencia entre ver
  // la respuesta o tener que buscarla desplazando la página.
  test("con conversación el orbe encoge y suelta la segunda línea", () => {
    renderHome({ conversation: conversation({ turns: [succeededTurn] }) });

    // La fase se sigue diciendo con palabras, no solo con el color del orbe.
    expect(screen.getByText("Pulsa para hablar")).toBeInTheDocument();
    expect(screen.queryByText("O escríbele aquí abajo.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hablar con Pi" })).toBeInTheDocument();
    expect(screen.getByLabelText("Escribe a Pi")).toBeEnabled();
  });

  test("permite parar la voz mientras Pi lee una respuesta", () => {
    const stop = vi.fn();
    renderHome({
      tts: { speaking: true, stop },
    });

    fireEvent.click(screen.getByRole("button", { name: "Parar voz" }));

    expect(stop).toHaveBeenCalledOnce();
  });

  test("oculta la parada cuando Pi no esta hablando", () => {
    renderHome({ conversation: conversation({ turns: [succeededTurn] }) });

    expect(screen.queryByRole("button", { name: "Parar voz" })).not.toBeInTheDocument();
  });

  // Dos líneas seguidas diciendo lo mismo bajo el campo eran ruido, y la del
  // campo es la que un lector de pantalla asocia al input.
  test("con el campo apagado la fase no repite el mismo aviso", () => {
    renderHome({
      blockedReason: "busy",
      busy: true,
      conversation: conversation({ turns: [succeededTurn] }),
    });

    expect(screen.getByText("Pi está respondiendo, espera un momento.")).toBeInTheDocument();
    expect(screen.queryByText("Pi está trabajando")).not.toBeInTheDocument();
  });

  // Sin voz de vuelta hay que leer la respuesta: la última va destacada bajo el
  // campo de escribir, y el historial completo debajo.
  test("la última respuesta se destaca antes del historial", () => {
    renderHome({ conversation: conversation({ turns: [succeededTurn] }) });

    const destacado = screen.getByLabelText("Lo último que ha dicho Pi");
    const historial = screen.getByRole("log");

    expect(destacado).toHaveTextContent("Abriendo Chrome.");
    expect(destacado.compareDocumentPosition(historial)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  // Un panel "Conversación" con un hueco dentro es ruido en la primera pantalla
  // que ve la persona: solo aparece cuando ya hay algo que recordar.
  test("sin conversación todavía no se pinta el historial", () => {
    renderHome();

    expect(screen.queryByRole("heading", { name: "Conversación" })).not.toBeInTheDocument();
    expect(screen.queryByText("Todavía no habéis hablado")).not.toBeInTheDocument();
  });

  // Empezar de cero solo significa algo cuando hay algo que dejar atrás.
  test("el botón de conversación nueva aparece solo con conversación empezada", () => {
    renderHome();
    expect(
      screen.queryByRole("button", { name: "Empezar una conversación nueva" }),
    ).not.toBeInTheDocument();
  });

  test("con conversación se puede empezar otra desde la esquina", () => {
    const props = renderHome({ conversation: conversation({ turns: [succeededTurn] }) });

    fireEvent.click(screen.getByRole("button", { name: "Empezar una conversación nueva" }));
    expect(props.actions.newConversation).toHaveBeenCalledTimes(1);
  });

  test("el contenido principal es un landmark al que se puede saltar", () => {
    renderHome();

    expect(screen.getByRole("main")).toHaveAttribute("id", "contenido");
  });

  test("la pantalla de paso pendiente también tiene título y landmark", () => {
    renderHome({ blockedReason: "disconnected", session: session({ authState: "disconnected" }) });

    expect(screen.getByRole("main")).toHaveAttribute("id", "contenido");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Falta un paso para hablar con Pi",
    );
  });
});
