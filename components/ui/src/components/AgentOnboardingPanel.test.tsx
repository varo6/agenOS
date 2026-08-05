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
  test("prioritizes backend recovery when the broker is unavailable", () => {
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

    expect(screen.getByText("Backend no disponible")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refrescar salud" }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir Sistema" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onOpenSystem).toHaveBeenCalledTimes(1);
  });

  test("guides the user to connect Codex after the backend is ready", () => {
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

    expect(screen.getByText("Conecta ChatGPT/Codex")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Conectar ahora" }));

    expect(onConnectCodex).toHaveBeenCalledTimes(1);
  });

  test("prioritizes backend Codex setup items before foreground login", () => {
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

    expect(screen.getByText("Setup del backend")).toBeInTheDocument();
    expect(screen.getByText("Connect backend Codex auth for OpenClaw.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Sistema" }));
    expect(onOpenSystem).toHaveBeenCalledTimes(1);
  });
});
