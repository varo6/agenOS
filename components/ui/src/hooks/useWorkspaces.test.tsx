import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { useWorkspaces, type UseWorkspacesOptions } from "./useWorkspaces";
import { resolveWorkspaceSubscription, type WorkspaceListener } from "../lib/workspace-source";
import type { AgentWorkspaceNumber } from "../lib/system-types";
import type { UserError } from "../lib/user-errors";
import type { AlertSink } from "./useSystemAlert";

const WORKSPACES = [
  { number: 1 as const, name: "1:home", label: "Inicio" },
  { number: 2 as const, name: "2:app", label: "Aplicaciones" },
];

type WorkspaceClient = UseWorkspacesOptions["client"];

function createAlert(): AlertSink {
  return {
    raise: vi.fn(() => ({}) as unknown as UserError),
    clear: vi.fn(),
    clearIf: vi.fn(),
  };
}

/** Cliente mínimo: el hook solo usa estas dos operaciones. */
function createClient(overrides: Partial<Record<"listWorkspaces" | "focusWorkspace", unknown>> = {}) {
  const client = {
    listWorkspaces: vi.fn().mockResolvedValue({
      ok: true,
      workspaces: WORKSPACES,
      activeWorkspace: 1,
    }),
    focusWorkspace: vi.fn().mockResolvedValue({ ok: true, activeWorkspace: 2, workspaces: [] }),
    ...overrides,
  };

  return client as typeof client & WorkspaceClient;
}

describe("useWorkspaces", () => {
  let alert: AlertSink;

  beforeEach(() => {
    alert = createAlert();
  });

  test("arranca con los escritorios por defecto antes de leer nada", () => {
    const { result } = renderHook(() =>
      useWorkspaces({ client: createClient(), alert }),
    );

    expect(result.current.workspaces).toHaveLength(5);
    expect(result.current.activeWorkspace).toBe(1);
    expect(result.current.live).toBe(false);
  });

  test("al refrescar adopta la lista y el escritorio activo del sistema", async () => {
    const client = createClient();
    const { result } = renderHook(() => useWorkspaces({ client, alert }));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.workspaces).toEqual(WORKSPACES);
    expect(result.current.activeWorkspace).toBe(1);
  });

  test("el cambio es optimista y se confirma con la respuesta", async () => {
    const client = createClient();
    const { result } = renderHook(() => useWorkspaces({ client, alert }));

    await act(async () => {
      await result.current.focus(2);
    });

    expect(client.focusWorkspace).toHaveBeenCalledWith(2);
    expect(result.current.activeWorkspace).toBe(2);
  });

  test("si el compositor rechaza el cambio, la barra vuelve al escritorio anterior", async () => {
    const client = createClient({
      focusWorkspace: vi.fn().mockResolvedValue({
        ok: false,
        workspaces: [],
        message: "El escritorio 4 no está disponible.",
      }),
    });
    const { result } = renderHook(() => useWorkspaces({ client, alert }));

    await act(async () => {
      await result.current.focus(4);
    });

    expect(result.current.activeWorkspace).toBe(1);
    expect(alert.raise).toHaveBeenCalledWith("El escritorio 4 no está disponible.");
  });

  test("si la petición falla, también revierte y avisa", async () => {
    const client = createClient({
      focusWorkspace: vi.fn().mockRejectedValue(new Error("sin compositor")),
    });
    const { result } = renderHook(() => useWorkspaces({ client, alert }));

    await act(async () => {
      await result.current.focus(3);
    });

    expect(result.current.activeWorkspace).toBe(1);
    expect(alert.raise).toHaveBeenCalled();
  });

  test("consume el escritorio empujado por el compositor sin pedir nada", async () => {
    const listeners: WorkspaceListener[] = [];
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((listener: WorkspaceListener) => {
      listeners.push(listener);
      return unsubscribe;
    });

    const client = createClient();
    const { result, unmount } = renderHook(() =>
      useWorkspaces({ client, alert, subscribe }),
    );

    expect(result.current.live).toBe(true);

    act(() => {
      listeners[0]?.(4);
    });

    await waitFor(() => {
      expect(result.current.activeWorkspace).toBe(4);
    });
    expect(client.listWorkspaces).not.toHaveBeenCalled();

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("resolveWorkspaceSubscription", () => {
  test("sin puente devuelve null y la interfaz sigue con el sondeo", () => {
    expect(resolveWorkspaceSubscription(undefined)).toBe(null);
    expect(resolveWorkspaceSubscription({} as Window)).toBe(null);
    expect(resolveWorkspaceSubscription({ agenosSystem: {} } as unknown as Window)).toBe(null);
  });

  test("con puente reenvía los escritorios válidos y descarta los que no existen", () => {
    let pushed: WorkspaceListener | null = null;
    const unsubscribe = vi.fn();
    const target = {
      agenosSystem: {
        subscribeWorkspace: (listener: WorkspaceListener) => {
          pushed = listener;
          return unsubscribe;
        },
      },
    } as unknown as Window;

    const subscription = resolveWorkspaceSubscription(target);
    expect(subscription).not.toBe(null);

    const received: AgentWorkspaceNumber[] = [];
    const stop = subscription!((workspace) => received.push(workspace));

    pushed!(3);
    pushed!(9 as AgentWorkspaceNumber);
    pushed!("2" as unknown as AgentWorkspaceNumber);

    expect(received).toEqual([3]);

    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
