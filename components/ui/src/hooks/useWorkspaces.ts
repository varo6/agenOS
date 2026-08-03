import { useCallback, useEffect, useState } from "react";

import type { createAgentClient } from "../lib/agent-client";
import type { AgentWorkspace, AgentWorkspaceNumber } from "../lib/system-types";
import type { WorkspaceSubscription } from "../lib/workspace-source";
import { useLatest } from "./useLatest";
import type { AlertSink } from "./useSystemAlert";

type AgentClient = ReturnType<typeof createAgentClient>;

/** Escritorios conocidos por defecto, para pintar la barra antes de la primera lectura. */
export const DEFAULT_WORKSPACES: AgentWorkspace[] = [
  { number: 1, name: "1:home", label: "Inicio" },
  { number: 2, name: "2:app", label: "Aplicaciones" },
  { number: 3, name: "3:web", label: "Web" },
  { number: 4, name: "4:media", label: "Multimedia" },
  { number: 5, name: "5:work", label: "Trabajo" },
];

export type WorkspacesController = {
  workspaces: AgentWorkspace[];
  activeWorkspace: AgentWorkspaceNumber;
  /** El compositor está empujando el escritorio activo en tiempo real. */
  live: boolean;
  refresh: () => Promise<void>;
  focus: (workspace: AgentWorkspaceNumber) => Promise<void>;
};

export type UseWorkspacesOptions = {
  client: AgentClient;
  alert: AlertSink;
  /**
   * Suscripción al empuje del compositor. Si no se pasa, el escritorio activo
   * solo se actualiza al leer o al cambiarlo desde la interfaz.
   */
  subscribe?: WorkspaceSubscription | null;
};

/**
 * Escritorios del sistema. El cambio es optimista (la barra responde al
 * instante) y se revierte si el compositor rechaza la petición.
 */
export function useWorkspaces({
  client,
  alert,
  subscribe = null,
}: UseWorkspacesOptions): WorkspacesController {
  const [workspaces, setWorkspaces] = useState<AgentWorkspace[]>(DEFAULT_WORKSPACES);
  const [activeWorkspace, setActiveWorkspace] = useState<AgentWorkspaceNumber>(1);

  /** Escritorio al que volver si el compositor rechaza el cambio. */
  const activeWorkspaceRef = useLatest(activeWorkspace);

  const refresh = useCallback(async () => {
    try {
      const response = await client.listWorkspaces();
      if (response.workspaces.length > 0) {
        setWorkspaces(response.workspaces);
      }
      if (response.activeWorkspace) {
        setActiveWorkspace(response.activeWorkspace);
      }
    } catch (error) {
      alert.raise(error);
    }
  }, [alert, client]);

  const focus = useCallback(
    async (workspace: AgentWorkspaceNumber) => {
      const previousWorkspace = activeWorkspaceRef.current;
      setActiveWorkspace(workspace);
      alert.clear();

      try {
        const response = await client.focusWorkspace(workspace);

        if (response.workspaces.length > 0) {
          setWorkspaces(response.workspaces);
        }

        if (!response.ok) {
          setActiveWorkspace(previousWorkspace);
          alert.raise(response.message ?? "No se pudo cambiar de escritorio.");
          return;
        }

        setActiveWorkspace(response.activeWorkspace ?? workspace);
      } catch (error) {
        setActiveWorkspace(previousWorkspace);
        alert.raise(error);
      }
    },
    [activeWorkspaceRef, alert, client],
  );

  // El empuje del compositor es la fuente de verdad: pisa cualquier valor
  // optimista sin pedir nada por HTTP.
  useEffect(() => {
    if (!subscribe) {
      return;
    }

    return subscribe((next) => {
      setActiveWorkspace(next);
    });
  }, [subscribe]);

  return { workspaces, activeWorkspace, live: Boolean(subscribe), refresh, focus };
}
