import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { NetworkConnectionPanel } from "../../../../network/react/NetworkConnectionPanel";

function createClient(overrides: Record<string, unknown> = {}) {
  return {
    getStatus: vi.fn().mockResolvedValue({
      ok: true,
      overall: "offline",
      checkedAt: "2026-06-08T00:00:00.000Z",
      wifiEnabled: true,
      wirelessHardware: "available",
      internet: {
        ok: false,
        captivePortalSuspected: false,
        message: "Sin conexión a internet.",
      },
      providers: { codex: "unknown", gemini: "unknown" },
    }),
    scanWifi: vi.fn().mockResolvedValue({ ok: true }),
    listAccessPoints: vi.fn().mockResolvedValue({ ok: true, accessPoints: [] }),
    connectWifi: vi.fn().mockResolvedValue({ ok: true, status: "connected", message: "Conexión Wi-Fi lista." }),
    disconnectWifi: vi.fn().mockResolvedValue({ ok: true }),
    setWifiEnabled: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

describe("NetworkConnectionPanel", () => {
  test("shows the captive portal action when a portal is suspected", async () => {
    const client = createClient({
      getStatus: vi.fn().mockResolvedValue({
        ok: true,
        overall: "portal",
        checkedAt: "2026-06-08T00:00:00.000Z",
        wifiEnabled: true,
        wirelessHardware: "available",
        internet: {
          ok: false,
          captivePortalSuspected: true,
          message: "Puede haber un portal cautivo pendiente.",
        },
        providers: { codex: "unknown", gemini: "unknown" },
      }),
    });

    render(<NetworkConnectionPanel client={client} />);

    expect(await screen.findByRole("button", { name: "Abrir portal de acceso" })).toBeInTheDocument();
  });

  test("clears the password dialog after a Wi-Fi connection attempt", async () => {
    const client = createClient({
      listAccessPoints: vi.fn().mockResolvedValue({
        ok: true,
        accessPoints: [
          {
            ssid: "AgenOS",
            bssid: "00:11:22:33:44:55",
            strength: 80,
            security: "wpa2",
            frequencyMHz: 2412,
            device: "/dev/wlan0",
          },
        ],
      }),
    });

    render(<NetworkConnectionPanel client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: /AgenOS/ }));
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "secret-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));

    await waitFor(() => {
      expect(client.connectWifi).toHaveBeenCalledWith(expect.objectContaining({ password: "secret-password" }));
    });
    await waitFor(() => {
      expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();
    });
  });
});
