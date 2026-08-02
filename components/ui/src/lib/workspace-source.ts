import type { AgentWorkspaceNumber } from "./system-types";

export const WORKSPACE_NUMBERS: readonly AgentWorkspaceNumber[] = [1, 2, 3, 4, 5];

export function isWorkspaceNumber(value: unknown): value is AgentWorkspaceNumber {
  return typeof value === "number" && WORKSPACE_NUMBERS.includes(value as AgentWorkspaceNumber);
}

export type WorkspaceListener = (activeWorkspace: AgentWorkspaceNumber) => void;

/** Suscripción a los cambios de escritorio. Devuelve la función para cancelarla. */
export type WorkspaceSubscription = (listener: WorkspaceListener) => () => void;

type WorkspaceBridgeCandidate = {
  subscribeWorkspace?: unknown;
};

/**
 * Hueco para el empuje del escritorio activo desde el compositor (Sway).
 *
 * El transporte lo implementa otro frente; aquí solo se declara la forma que
 * consumimos y se degrada a `null` mientras no exista, de modo que la interfaz
 * sigue funcionando con el sondeo HTTP actual. Este es el único punto que hay
 * que tocar cuando el puente aterrice, y el hook acepta la suscripción por
 * parámetro para poder simularla en tests.
 */
export function resolveWorkspaceSubscription(
  target: Window | undefined = globalThis.window,
): WorkspaceSubscription | null {
  const bridge = target?.agenosSystem as WorkspaceBridgeCandidate | undefined;
  if (!bridge || typeof bridge.subscribeWorkspace !== "function") {
    return null;
  }

  const subscribe = bridge.subscribeWorkspace as (listener: WorkspaceListener) => unknown;

  return (listener) => {
    // Se filtran los valores fuera de rango: la interfaz nunca debe mostrar un
    // escritorio que no existe aunque el puente se equivoque.
    const unsubscribe = subscribe((activeWorkspace) => {
      if (isWorkspaceNumber(activeWorkspace)) {
        listener(activeWorkspace);
      }
    });

    return () => {
      if (typeof unsubscribe === "function") {
        (unsubscribe as () => void)();
      }
    };
  };
}
