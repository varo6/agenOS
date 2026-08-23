import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useTtsReplies } from "./useTtsReplies";
import type { PiTurnState } from "../lib/pi-types";

function turn(turnId: string, reply: string, finishedAt = "2026-08-21T00:00:02.000Z"): PiTurnState {
  const timestamp = "2026-08-21T00:00:00.000Z";
  return {
    turnId,
    status: "succeeded",
    source: "text",
    input: "hola",
    startedAt: timestamp,
    finishedAt,
    progress: { startedAt: timestamp, streamedText: "", currentTool: null, completedTools: [] },
    reply,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-21T00:00:01.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTtsReplies", () => {
  test("no lee el historial inicial restaurado", () => {
    const speak = vi.fn(() => Promise.resolve({ ok: true as const, engine: "espeak-ng" as const, voice: "es" }));
    const getBridge = () => ({
      speak,
      stop: vi.fn(),
      status: vi.fn(),
      isAvailable: () => true,
    });

    renderHook(({ turns }) => useTtsReplies({ turns, getBridge }), {
      initialProps: { turns: [turn("old", "respuesta antigua", "2026-08-20T23:59:00.000Z")] },
    });

    expect(speak).not.toHaveBeenCalled();
  });

  test("no lee historial antiguo que restore carga despues del montaje", () => {
    const speak = vi.fn(() => Promise.resolve({ ok: true as const, engine: "espeak-ng" as const, voice: "es" }));
    const getBridge = () => ({
      speak,
      stop: vi.fn(),
      status: vi.fn(),
      isAvailable: () => true,
    });

    const view = renderHook(({ turns }) => useTtsReplies({ turns, getBridge }), {
      initialProps: { turns: [] as PiTurnState[] },
    });

    view.rerender({ turns: [turn("old", "respuesta antigua", "2026-08-20T23:59:00.000Z")] });

    expect(speak).not.toHaveBeenCalled();
  });

  test("lee cada respuesta nueva una sola vez", () => {
    const speak = vi.fn(() => Promise.resolve({ ok: true as const, engine: "espeak-ng" as const, voice: "es" }));
    const getBridge = () => ({
      speak,
      stop: vi.fn(),
      status: vi.fn(),
      isAvailable: () => true,
    });
    const first = turn("first", "primera");
    const second = turn("second", "segunda");

    const view = renderHook(({ turns }) => useTtsReplies({ turns, getBridge }), {
      initialProps: { turns: [] as PiTurnState[] },
    });

    view.rerender({ turns: [first] });
    view.rerender({ turns: [first] });
    view.rerender({ turns: [first, second] });

    expect(speak).toHaveBeenCalledTimes(2);
    expect(speak).toHaveBeenNthCalledWith(1, "primera");
    expect(speak).toHaveBeenNthCalledWith(2, "segunda");
  });
});
