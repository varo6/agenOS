import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { useConversation, type UseConversationOptions } from "./useConversation";
import type { UserError } from "../lib/user-errors";
import type { AlertSink } from "./useSystemAlert";

function createAlert(): AlertSink {
  return {
    raise: vi.fn(() => ({}) as unknown as UserError),
    clear: vi.fn(),
    clearIf: vi.fn(),
  };
}

type Harness = {
  alert: AlertSink;
  captureTurn: ReturnType<typeof vi.fn>;
  getCaptureJob: ReturnType<typeof vi.fn>;
  startNewConversation: ReturnType<typeof vi.fn>;
};

/**
 * El hook solo toca estas operaciones al guardar en memoria; el resto de los
 * clientes se deja sin implementar a propósito para que un cambio que empiece
 * a usarlos aquí falle de forma ruidosa.
 */
function setup(
  captureImpl?: () => Promise<unknown>,
  jobImpl?: () => Promise<unknown>,
) {
  const harness: Harness = {
    alert: createAlert(),
    captureTurn: vi.fn(captureImpl ?? (() => Promise.resolve({ ok: true, jobId: "j1", status: "queued", message: "Guardando…" }))),
    getCaptureJob: vi.fn(jobImpl ?? (() => Promise.resolve({ ok: true, job: { jobId: "j1", turnId: "turn_1", status: "succeeded", createdAt: "2026-01-01T00:00:00.000Z" } }))),
    startNewConversation: vi.fn(() => Promise.resolve()),
  };

  const options = {
    piClient: { startNewConversation: harness.startNewConversation },
    agentClient: {},
    improvementsClient: { captureTurn: harness.captureTurn, getCaptureJob: harness.getCaptureJob },
    alert: harness.alert,
    isOffline: () => false,
    isDisconnected: () => false,
    onUnauthorized: vi.fn(),
    onModelId: vi.fn(),
    onSettled: vi.fn(),
  } as unknown as UseConversationOptions;

  return { harness, ...renderHook(() => useConversation(options)) };
}

describe("useConversation: guardar en memoria", () => {
  test("marca el turno cuando el trabajo confirma la escritura", async () => {
    const { harness, result } = setup();

    await act(async () => {
      await result.current.saveToMemory("turn_1");
    });

    expect(harness.captureTurn).toHaveBeenCalledWith("turn_1");
    expect(harness.getCaptureJob).toHaveBeenCalledWith("j1");
    expect(result.current.savedTurnIds.has("turn_1")).toBe(true);
    expect(result.current.savingTurnIds.has("turn_1")).toBe(false);
  });

  test("el 202 mantiene Guardando hasta que el trabajo confirma la escritura", async () => {
    let release = () => {};
    const { result } = setup(undefined, () => new Promise((resolve) => {
      release = () => resolve({
        ok: true,
        job: { jobId: "j1", turnId: "turn_1", status: "succeeded", createdAt: "2026-01-01T00:00:00.000Z" },
      });
    }));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.saveToMemory("turn_1");
    });

    await waitFor(() => {
      expect(result.current.savingTurnIds.has("turn_1")).toBe(true);
    });
    expect(result.current.savedTurnIds.has("turn_1")).toBe(false);

    await act(async () => {
      release();
      await pending;
    });
    expect(result.current.savedTurnIds.has("turn_1")).toBe(true);
  });

  test("dos pulsaciones seguidas no encolan dos capturas", async () => {
    const { harness, result } = setup();

    await act(async () => {
      await Promise.all([
        result.current.saveToMemory("turn_1"),
        result.current.saveToMemory("turn_1"),
      ]);
    });

    expect(harness.captureTurn).toHaveBeenCalledTimes(1);
  });

  test("volver a pulsar un turno ya guardado no repite la llamada", async () => {
    const { harness, result } = setup();

    await act(async () => {
      await result.current.saveToMemory("turn_1");
    });
    await act(async () => {
      await result.current.saveToMemory("turn_1");
    });

    expect(harness.captureTurn).toHaveBeenCalledTimes(1);
  });

  test("un trabajo fallido se indica y deja el botón disponible para reintentar", async () => {
    const { harness, result } = setup(undefined, () => Promise.resolve({
      ok: true,
      job: { jobId: "j1", turnId: "turn_1", status: "failed", createdAt: "2026-01-01T00:00:00.000Z", error: "fallo" },
    }));

    await act(async () => {
      await result.current.saveToMemory("turn_1");
    });

    expect(result.current.savedTurnIds.has("turn_1")).toBe(false);
    expect(result.current.savingTurnIds.has("turn_1")).toBe(false);
    expect(result.current.failedTurnIds.has("turn_1")).toBe(true);

    harness.captureTurn.mockResolvedValueOnce({ ok: true, jobId: "j2", status: "queued", message: "" });
    harness.getCaptureJob.mockResolvedValueOnce({
      ok: true,
      job: { jobId: "j2", turnId: "turn_1", status: "succeeded", createdAt: "2026-01-01T00:00:00.000Z" },
    });
    await act(async () => {
      await result.current.saveToMemory("turn_1");
    });
    expect(result.current.savedTurnIds.has("turn_1")).toBe(true);
    expect(result.current.failedTurnIds.has("turn_1")).toBe(false);
  });

  test("empezar otra conversación borra las marcas de la pantalla", async () => {
    const { harness, result } = setup();

    await act(async () => {
      await result.current.saveToMemory("turn_1");
    });
    expect(result.current.savedTurnIds.has("turn_1")).toBe(true);

    await act(async () => {
      await result.current.startNew();
    });

    expect(result.current.savedTurnIds.size).toBe(0);
    // Y el mismo turno vuelve a poder marcarse: las marcas eran de la vista.
    await act(async () => {
      await result.current.saveToMemory("turn_1");
    });
    expect(harness.captureTurn).toHaveBeenCalledTimes(2);
  });
});
