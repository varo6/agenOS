import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AgentHealthChecklist } from "./AgentHealthChecklist";
import type { AgentAdminStatus } from "../lib/system-types";

const setupStatus: AgentAdminStatus = {
  ok: false,
  readiness: "needs_setup",
  setupItems: [{ id: "provider-auth", label: "Configura provider auth", severity: "warning", action: "configure_provider" }],
  worker: {
    mode: "agenos-bun-worker",
    serviceActive: true,
    version: "0.1.0",
    queueDepth: 0,
    degradedReason: "provider auth missing",
    lastHeartbeatAt: null,
    lastError: null,
    lastErrorCorrelationId: null,
  },
  config: {
    mode: "auto",
    provider: "openai",
    model: "gpt-5.4-mini",
    stateDir: "/home/agenos/.agenos/openclaw",
    apiAuth: { type: "env", envVar: "OPENAI_API_KEY", configured: false },
    channels: { email: false, telegram: false, whatsapp: false },
    policyDefaults: { memoryWrite: "confirm", outboundSend: "confirm" },
  },
};

describe("AgentHealthChecklist", () => {
  // Mismas cuatro comprobaciones que antes (servicio, motor, cuenta y soporte),
  // pero nombradas por lo que significan para quien mira la pantalla.
  test("summarizes service, worker, account and support status in plain Spanish", () => {
    render(
      <AgentHealthChecklist
        adminStatus={setupStatus}
        authState="disconnected"
        backendError={null}
        harnessAvailable
      />,
    );

    expect(screen.getByText("Servicio de Pi")).toBeInTheDocument();
    expect(screen.getByText("Funcionando")).toBeInTheDocument();
    expect(screen.getByText("Motor de tareas")).toBeInTheDocument();
    expect(screen.getByText("Falta configurarlo")).toBeInTheDocument();
    expect(screen.getByText("Tu cuenta")).toBeInTheDocument();
    expect(screen.getByText("Conecta ChatGPT")).toBeInTheDocument();
    expect(screen.getByText("Soporte")).toBeInTheDocument();
    expect(screen.getByText("Informe disponible")).toBeInTheDocument();
  });

  // El dato técnico sigue estando: es lo que hace falta para diagnosticar y
  // para defender el trabajo, pero como tercera línea y no como titular.
  test("keeps the technical reading available as the supporting line", () => {
    render(
      <AgentHealthChecklist
        adminStatus={setupStatus}
        authState="disconnected"
        backendError={null}
        harnessAvailable
      />,
    );

    expect(screen.getByText("Configura provider auth")).toBeInTheDocument();
    expect(screen.getByText(/127\.0\.0\.1:4173/)).toBeInTheDocument();
  });
});
