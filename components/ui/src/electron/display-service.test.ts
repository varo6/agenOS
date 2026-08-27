import { describe, expect, test, vi } from "vitest";

import { createDisplayService, parseBrightness } from "./display-service";

describe("display service", () => {
  test("reads the percentage reported by brightnessctl", () => {
    expect(parseBrightness("intel_backlight,backlight,480,960,50%\n")).toEqual({ available: true, brightnessPercent: 50 });
  });

  test("rejects brightness values outside the safe range", async () => {
    const run = vi.fn();
    const service = createDisplayService({ run, spawn: vi.fn() });
    await expect(service.setBrightness(0)).resolves.toMatchObject({ ok: false });
    expect(run).not.toHaveBeenCalled();
  });

  test("uses swayidle so input turns the display back on", async () => {
    const spawn = vi.fn();
    const service = createDisplayService({ run: vi.fn(), spawn });
    await expect(service.turnOff()).resolves.toMatchObject({ ok: true });
    expect(spawn).toHaveBeenCalledWith("swayidle", expect.arrayContaining(["resume", "swaymsg 'output * power on'; kill $PPID"]));
  });
});
