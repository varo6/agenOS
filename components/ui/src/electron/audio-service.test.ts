import { describe, expect, test, vi } from "vitest";

import { createAudioService, parseAudioStatus } from "./audio-service";

describe("audio service", () => {
  test("reads volume and mute state reported by wpctl", () => {
    expect(parseAudioStatus("Volume: 0.42 [MUTED]\n")).toEqual({
      available: true,
      volumePercent: 42,
      muted: true,
    });
  });

  test("rejects volume values outside the supported range", async () => {
    const run = vi.fn();
    const service = createAudioService({ run });

    await expect(service.setVolume(101)).resolves.toMatchObject({ ok: false });
    expect(run).not.toHaveBeenCalled();
  });

  test("sets the default PipeWire output volume", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "" });
    const service = createAudioService({ run });

    await expect(service.setVolume(65)).resolves.toMatchObject({ ok: true });
    expect(run).toHaveBeenCalledWith("wpctl", [
      "set-volume",
      "-l",
      "1.0",
      "@DEFAULT_AUDIO_SINK@",
      "65%",
    ]);
  });

  test("mutes and unmutes the default PipeWire output", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "" });
    const service = createAudioService({ run });

    await service.setMuted(true);
    await service.setMuted(false);

    expect(run).toHaveBeenNthCalledWith(1, "wpctl", ["set-mute", "@DEFAULT_AUDIO_SINK@", "1"]);
    expect(run).toHaveBeenNthCalledWith(2, "wpctl", ["set-mute", "@DEFAULT_AUDIO_SINK@", "0"]);
  });
});
