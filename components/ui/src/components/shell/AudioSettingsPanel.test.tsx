import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { AgenosSystemBridge } from "../../lib/system-bridge";
import { AudioSettingsPanel } from "./AudioSettingsPanel";

afterEach(() => {
  delete window.agenosSystem;
});

function installBridge(overrides: Partial<AgenosSystemBridge> = {}) {
  const bridge = {
    isAvailable: () => true,
    getAudioStatus: vi.fn().mockResolvedValue({ available: true, volumePercent: 40, muted: false }),
    setVolume: vi.fn().mockResolvedValue({ ok: true, message: "Volumen ajustado al 65 %." }),
    setMuted: vi.fn().mockResolvedValue({ ok: true, message: "Sonido silenciado." }),
    ...overrides,
  } as unknown as AgenosSystemBridge;
  window.agenosSystem = bridge;
  return bridge;
}

describe("AudioSettingsPanel", () => {
  test("changes the volume through the system bridge", async () => {
    const bridge = installBridge();
    render(<AudioSettingsPanel />);

    const slider = await screen.findByRole("slider", { name: "Volumen de los altavoces" });
    expect(slider).toHaveValue("40");

    fireEvent.change(slider, { target: { value: "65" } });
    fireEvent.pointerUp(slider);

    await waitFor(() => expect(bridge.setVolume).toHaveBeenCalledWith(65));
    expect(await screen.findByText("Volumen ajustado al 65 %.")).toBeInTheDocument();
  });

  test("mutes the default output", async () => {
    const bridge = installBridge();
    render(<AudioSettingsPanel />);

    const mute = await screen.findByRole("button", { name: "Silenciar" });
    fireEvent.click(mute);

    await waitFor(() => expect(bridge.setMuted).toHaveBeenCalledWith(true));
    expect(screen.getByRole("button", { name: "Activar sonido" })).toBeInTheDocument();
  });

  test("saves the value shown after a keyboard adjustment", async () => {
    const bridge = installBridge();
    render(<AudioSettingsPanel />);

    const slider = await screen.findByRole("slider", { name: "Volumen de los altavoces" });
    fireEvent.change(slider, { target: { value: "45" } });
    fireEvent.keyUp(slider, { key: "ArrowRight" });

    await waitFor(() => expect(bridge.setVolume).toHaveBeenCalledWith(45));
  });
});
