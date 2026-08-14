import { useCallback, useState } from "react";

import type { createNetworkClient } from "../../../network/client";

type NetworkClient = ReturnType<typeof createNetworkClient>;

export type NetworkStatusController = {
  /** `null` mientras no se ha comprobado todavía. */
  online: boolean | null;
  refresh: () => Promise<boolean>;
  markOnline: () => void;
};

/**
 * Conectividad del equipo. Es lo primero que condiciona todo lo demás: sin red
 * no hay agente, y la pantalla lo dice antes de dejar intentar nada.
 */
export function useNetworkStatus(client: NetworkClient): NetworkStatusController {
  const [online, setOnline] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      const status = await client.getStatus();
      const isOnline = status.overall === "online";
      setOnline(isOnline);
      return isOnline;
    } catch {
      setOnline(false);
      return false;
    }
  }, [client]);

  const markOnline = useCallback(() => {
    setOnline(true);
  }, []);

  return { online, refresh, markOnline };
}
