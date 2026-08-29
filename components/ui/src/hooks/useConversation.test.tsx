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
  startNewConversation: ReturnType<typeof vi.fn>;
};

/**
 * El hook solo toca estas operaciones al guardar en memoria; el resto de los
 * clientes se deja sin implementar a propósito para que un cambio que empiece
 * a usarlos aquí falle de forma ruidosa.
 */
function setup(captureImpl?: () => Promise<unknown>) {
  const harness: Harness = {
    alert: createAlert(),
    captureTurn: vi.fn(captureImpl ?? (() => Promise.resolve({ ok: true, jobId: "j1", status: "queued", message: "Lo tendré en cuenta." }))),
    startNewConversation: vi.fn(() => Promise.resolve()),
  };

  const options = {
    piClient: { startNewConversation: harness.startNewConversation },
    agentClient: {},
    improvementsClient: { captureTurn: harness.captureTurn },
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
  test("marca el turno cuando el broker acepta la captura", async () => {
    const { harness, result } = setup();

    await act(async () => {
      await result.current.saveToMemory("turn_1");
    });

    expect(harness.captureTurn).toHaveBeenCalledWith("turn_1");
    expect(result.current.savedTurnIds.has("turn_1")).toBe(true);
    expect(result.current.savingTurnIds.has("turn_1")).toBe(false);
  });

  test("mientras vuela, el turno consta como en curso", async () => {
    let release = () => {};
    const { result } = setup(() => new Promise((resolve) => {
      release = () => resolve({ ok: true });
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

  test("un fallo avisa y deja el botón disponible para reintentar", async () => {
    const { harness, result } = setup(() => Promise.reject(new Error("el broker no responde")));

    await act(async () => {
      await result.current.saveToMemory("turn_1");
    });

    expect(harness.alert.raise).toHaveBeenCalled();
    expect(result.current.savedTurnIds.has("turn_1")).toBe(false);
    expect(result.current.savingTurnIds.has("turn_1")).toBe(false);

    harness.captureTurn.mockResolvedValueOnce({ ok: true, jobId: "j2", status: "queued", message: "" });
    await act(async () => {
      await result.current.saveToMemory("turn_1");
    });
    expect(result.current.savedTurnIds.has("turn_1")).toBe(true);
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
