import { describe, expect, test } from "bun:test";

import { resolveElectronGpuState, shouldTrackGpuFallback } from "./runtime";

describe("resolveElectronGpuState", () => {
  test("keeps installer mode in GPU off", () => {
    expect(resolveElectronGpuState({
      appKind: "installer",
      requestedMode: "on",
      persistedState: "on",
    })).toBe("off");
  });

  test("uses persisted off state when system mode runs in auto", () => {
    expect(resolveElectronGpuState({
      appKind: "system",
      requestedMode: "auto",
      persistedState: "off",
    })).toBe("off");
  });

  test("defaults system mode auto to GPU on on a clean start", () => {
    expect(resolveElectronGpuState({
      appKind: "system",
      requestedMode: "auto",
      persistedState: null,
    })).toBe("on");
  });
});

describe("shouldTrackGpuFallback", () => {
  test("tracks only the system shell in auto mode when GPU starts enabled", () => {
    expect(shouldTrackGpuFallback({
      appKind: "system",
      requestedMode: "auto",
      effectiveState: "on",
    })).toBe(true);
  });

  test("does not track installer mode", () => {
    expect(shouldTrackGpuFallback({
      appKind: "installer",
      requestedMode: "auto",
      effectiveState: "on",
    })).toBe(false);
  });
});
