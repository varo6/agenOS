import { useCallback, useState } from "react";

import type { createAgentAdminClient } from "../lib/agent-admin-client";
import { describeClientError } from "../lib/user-errors";
import type { AgentAdminStatus } from "../lib/system-types";

type AgentAdminClient = ReturnType<typeof createAgentAdminClient>;

export type AgentHealthController = {
  status: AgentAdminStatus | null;
  /** Mensaje crudo del backend; los paneles de salud lo muestran como detalle. */
  error: string | null;
  refresh: () => Promise<AgentAdminStatus | null>;
};

/**
 * Salud del backend del agente (broker y worker). Su fallo no es fatal: la
 * pantalla sigue siendo usable y el error se muestra como estado, no como
 * excepción.
 */
export function useAgentHealth(client: AgentAdminClient): AgentHealthController {
  const [status, setStatus] = useState<AgentAdminStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await client.getStatus();
      setStatus(next);
      setError(null);
      return next;
    } catch (refreshError) {
      setStatus(null);
      setError(describeClientError(refreshError));
      return null;
    }
  }, [client]);

  return { status, error, refresh };
}
