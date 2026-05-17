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
  test("summarizes backend, worker, codex auth and support status", () => {
    render(
      <AgentHealthChecklist
        adminStatus={setupStatus}
        authState="disconnected"
        backendError={null}
        harnessAvailable
      />,
    );

    expect(screen.getByText("Backend")).toBeInTheDocument();
    expect(screen.getByText("Broker local disponible")).toBeInTheDocument();
    expect(screen.getByText("Worker")).toBeInTheDocument();
    expect(screen.getByText("Setup requerido")).toBeInTheDocument();
    expect(screen.getByText("Codex/Auth")).toBeInTheDocument();
    expect(screen.getByText("Conecta ChatGPT")).toBeInTheDocument();
    expect(screen.getByText("Soporte")).toBeInTheDocument();
    expect(screen.getByText("Diagnostico listo")).toBeInTheDocument();
  });
});
