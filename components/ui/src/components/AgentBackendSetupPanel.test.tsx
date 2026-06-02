import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AgentBackendSetupPanel } from "./AgentBackendSetupPanel";

const client = {
  updateConfig: vi.fn(),
  testConnection: vi.fn(),
  rerunSetup: vi.fn(),
  startBackendCodexLogin: vi.fn(),
  configureTelegram: vi.fn(),
  testTelegram: vi.fn(),
  enableTelegram: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AgentBackendSetupPanel", () => {
  test("shows first-run setup actions without requiring file edits", async () => {
    client.testConnection.mockResolvedValue({ ok: false, message: "OPENCLAW_API_KEY no configurada." });

    render(
      <AgentBackendSetupPanel
        client={client}
        readiness="needs_setup"
        setupItems={[{ id: "provider-auth", label: "Configura API auth", severity: "warning", action: "configure_provider" }]}
      />,
    );

    expect(screen.getByText("Configura API auth")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Probar conexion" }));
    await waitFor(() => expect(client.testConnection).toHaveBeenCalledTimes(1));
  });

  test("allows switching to local-simulated through the admin API", async () => {
    client.updateConfig.mockResolvedValue({ ok: true, message: "Modo actualizado." });

    render(<AgentBackendSetupPanel client={client} readiness="needs_setup" setupItems={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Usar modo simulado" }));

    await waitFor(() => expect(client.updateConfig).toHaveBeenCalledWith({ mode: "local-simulated" }));
  });

  test("runs backend Codex and Telegram setup actions", async () => {
    client.rerunSetup.mockResolvedValue({ ok: false, message: "Setup rerun." });
    client.startBackendCodexLogin.mockResolvedValue({ ok: false, message: "Open browser for Codex." });
    client.configureTelegram.mockResolvedValue({ ok: false, message: "Token stored." });
    client.testTelegram.mockResolvedValue({ ok: true, message: "Telegram reachable." });
    client.enableTelegram.mockResolvedValue({ ok: true, message: "Telegram enabled." });

    render(
      <AgentBackendSetupPanel
        client={client}
        readiness="needs_setup"
        setupItems={[
          { id: "backend-codex-auth", label: "Connect backend Codex auth", severity: "warning", action: "connect_backend_codex" },
          { id: "telegram-channel", label: "Configure Telegram bot token", severity: "info", action: "configure_telegram" },
          { id: "telegram-test", label: "Test Telegram", severity: "info", action: "test_telegram" },
          { id: "telegram-enable", label: "Enable Telegram", severity: "info", action: "enable_telegram" },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reejecutar setup" }));
    fireEvent.click(screen.getByRole("button", { name: "Conectar Codex backend" }));
    fireEvent.change(screen.getByLabelText("Telegram bot token"), { target: { value: "123456:secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar Telegram" }));
    fireEvent.click(screen.getByRole("button", { name: "Probar Telegram" }));
    fireEvent.click(screen.getByRole("button", { name: "Activar Telegram" }));

    await waitFor(() => expect(client.rerunSetup).toHaveBeenCalledTimes(1));
    expect(client.startBackendCodexLogin).toHaveBeenCalledTimes(1);
    expect(client.configureTelegram).toHaveBeenCalledWith("123456:secret");
    expect(client.testTelegram).toHaveBeenCalledTimes(1);
    expect(client.enableTelegram).toHaveBeenCalledTimes(1);
  });
});
