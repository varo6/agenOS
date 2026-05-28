import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AgentAdminPanel } from "./AgentAdminPanel";

const adminClient = {
  getStatus: vi.fn(),
  getConfig: vi.fn(),
  getPolicy: vi.fn(),
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
  listConfirmations: vi.fn(),
  confirm: vi.fn(),
  deny: vi.fn(),
  executeShell: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  adminClient.getStatus.mockResolvedValue({
    ok: true,
    readiness: "needs_setup",
    setupItems: [{ id: "provider-auth", label: "Configura API auth", severity: "warning", action: "configure_provider" }],
    worker: {
      mode: "agenos-bun-worker",
      serviceActive: true,
      version: "0.1.0",
      queueDepth: 2,
      degradedReason: "provider auth missing",
      lastHeartbeatAt: "2026-05-16T12:00:00.000Z",
      lastError: null,
      lastErrorCorrelationId: null,
    },
    config: {
      mode: "auto",
      provider: "openai",
      model: "gpt-5.4-mini",
      stateDir: "/home/agenos/.agenos/openclaw",
      apiAuth: { type: "env", envVar: "OPENCLAW_API_KEY", configured: false },
      channels: { email: false, telegram: false, whatsapp: false },
      policyDefaults: { memoryWrite: "confirm", outboundSend: "confirm" },
    },
  });
  adminClient.listConfirmations.mockResolvedValue([]);
  adminClient.executeShell.mockResolvedValue({
    ok: true,
    command: "pwd && id",
    cwd: "/home/agenos",
    exitCode: 0,
    signal: null,
    stdout: "/home/agenos\nuid=1000\n",
    stderr: "",
    timedOut: false,
    message: "Comando completado.",
  });
  adminClient.getPolicy.mockResolvedValue([
    { ruleId: "agent.memory.background.confirm", tool: "memory.write", source: "openclaw", decision: "confirm", reason: "Guardar memoria requiere confirmacion." },
  ]);
});

describe("AgentAdminPanel", () => {
  test("shows health, mode, config, and safe actions", async () => {
    render(<AgentAdminPanel client={adminClient} />);

    expect(await screen.findByText("agenos-bun-worker")).toBeInTheDocument();
    expect(screen.getByText("Configura API auth")).toBeInTheDocument();
    expect(screen.getByText("Servicio activo")).toBeInTheDocument();
    expect(screen.getByDisplayValue("/home/agenos/.agenos/openclaw")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reiniciar servicio" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Probar conexion" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar diagnostico" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ejecutar comando shell" })).toBeInTheDocument();
  });

  test("tests connection through the admin API", async () => {
    adminClient.testConnection.mockResolvedValue({ ok: true, message: "Conexion correcta." });

    render(<AgentAdminPanel client={adminClient} />);
    fireEvent.click(await screen.findByRole("button", { name: "Probar conexion" }));

    await waitFor(() => expect(adminClient.testConnection).toHaveBeenCalledTimes(1));
  });

  test("executes shell commands through the admin API", async () => {
    render(<AgentAdminPanel client={adminClient} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ejecutar comando shell" }));

    await waitFor(() => expect(adminClient.executeShell).toHaveBeenCalledWith("pwd && id"));
    expect(await screen.findByText(/uid=1000/)).toBeInTheDocument();
  });
});
