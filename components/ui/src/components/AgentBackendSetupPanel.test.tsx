import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AgentBackendSetupPanel } from "./AgentBackendSetupPanel";

const client = {
  updateConfig: vi.fn(),
  testConnection: vi.fn(),
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
});
