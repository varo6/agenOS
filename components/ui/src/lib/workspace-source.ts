import type { AgentWorkspaceNumber } from "./system-types";

export const WORKSPACE_NUMBERS: readonly AgentWorkspaceNumber[] = [1, 2, 3, 4, 5];

export function isWorkspaceNumber(value: unknown): value is AgentWorkspaceNumber {
  return typeof value === "number" && WORKSPACE_NUMBERS.includes(value as AgentWorkspaceNumber);
}

export type WorkspaceListener = (activeWorkspace: AgentWorkspaceNumber) => void;

/** Suscripción a los cambios de escritorio. Devuelve la función para cancelarla. */
export type WorkspaceSubscription = (listener: WorkspaceListener) => () => void;

type WorkspaceChangeSource = {
  subscribeWorkspaceChanges?: (
    onChange: (state: { activeWorkspace?: unknown }) => void,
  ) => () => void;
};

/**
 * Empuje del escritorio activo desde el compositor (Sway).
 *
 * El transporte real son los eventos que Sway publica y el broker reenvía por
 * SSE en `/api/agent/workspaces/events`. Aqui solo se adapta la forma del
 * cliente a la que consume el hook, y se devuelve `null` si el cliente no sabe
 * suscribirse, de modo que la interfaz sigue funcionando con la lectura HTTP.
 */
export function resolveWorkspaceSubscription(
  client: WorkspaceChangeSource | undefined,
): WorkspaceSubscription | null {
  if (typeof client?.subscribeWorkspaceChanges !== "function") {
    return null;
  }

  const subscribe = client.subscribeWorkspaceChanges.bind(client);

  return (listener) => {
    // Se filtran los valores fuera de rango: la interfaz nunca debe mostrar un
    // escritorio que no existe aunque el transporte se equivoque.
    const unsubscribe = subscribe((state) => {
      if (isWorkspaceNumber(state?.activeWorkspace)) {
        listener(state.activeWorkspace);
      }
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  };
}
