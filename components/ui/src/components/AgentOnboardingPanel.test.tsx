import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { AgentOnboardingPanel } from "./AgentOnboardingPanel";
import type { AgentAdminStatus } from "../lib/system-types";

const readyStatus: AgentAdminStatus = {
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

describe("AgentOnboardingPanel", () => {
  test("prioritizes recovering the service, and says so without naming it", () => {
    const onRefresh = vi.fn();
    const onOpenSystem = vi.fn();

    render(
      <AgentOnboardingPanel
        adminStatus={null}
        authState="disconnected"
        backendError="Failed to fetch"
        harnessAvailable={false}
        onConnectCodex={vi.fn()}
        onOpenSystem={onOpenSystem}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByText("Pi no está disponible")).toBeInTheDocument();
    // El mensaje crudo del servicio no llega a la pantalla principal.
    expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir Sistema" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onOpenSystem).toHaveBeenCalledTimes(1);
  });

  test("guides the user to connect the account once the service is ready", () => {
    const onConnectCodex = vi.fn();

    render(
      <AgentOnboardingPanel
        adminStatus={readyStatus}
        authState="disconnected"
        backendError={null}
        harnessAvailable
        onConnectCodex={onConnectCodex}
        onOpenSystem={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText("Conecta tu cuenta")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));

    expect(onConnectCodex).toHaveBeenCalledTimes(1);
  });

  test("prioritizes pending setup before login, without leaking the raw item", () => {
    const onOpenSystem = vi.fn();
    render(
      <AgentOnboardingPanel
        adminStatus={{
          ...readyStatus,
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
        }}
        authState="disconnected"
        backendError={null}
        harnessAvailable
        onConnectCodex={vi.fn()}
        onOpenSystem={onOpenSystem}
        onRefresh={vi.fn()}
      />,
    );

    // La configuración pendiente gana al login, pero se cuenta en castellano:
    // el texto del `setupItem` viene en inglés y de ingeniería, y vive en Sistema.
    expect(screen.getByText("Falta terminar la configuración")).toBeInTheDocument();
    expect(screen.queryByText("Connect backend Codex auth for OpenClaw.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Conectar" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Abrir Sistema" }));
    expect(onOpenSystem).toHaveBeenCalledTimes(1);
  });
});
