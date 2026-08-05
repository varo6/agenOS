import { useEffect, useState } from "react";

import { useLatest } from "./useLatest";

export type ShellBootSteps = {
  refreshSession: () => Promise<unknown>;
  refreshHealth: () => Promise<unknown>;
  refreshWorkspaces: () => Promise<unknown>;
  restoreConversation: () => Promise<unknown>;
  refreshNetwork: () => Promise<unknown>;
};

/**
 * Arranque del shell.
 *
 * Sesión, salud y escritorios se piden a la vez porque no dependen entre sí;
 * el historial y la red se esperan porque deciden qué pantalla se ve primero.
 * Ninguna de las lecturas es fatal: si algo falla, el shell entra igualmente y
 * lo cuenta como estado.
 *
 * Los pasos se leen desde una ref para que el efecto corra una sola vez pase lo
 * que pase con la identidad de los callbacks: si dependiera de ellos, cada
 * pulsación de tecla reiniciaría el arranque entero.
 */
export function useShellBoot(steps: ShellBootSteps): boolean {
  const [booting, setBooting] = useState(true);
  const latest = useLatest(steps);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const { refreshSession, refreshHealth, refreshWorkspaces, restoreConversation, refreshNetwork } =
        latest.current;

      void Promise.allSettled([refreshSession(), refreshHealth(), refreshWorkspaces()]);
      await restoreConversation();
      await refreshNetwork();

      if (!cancelled) {
        setBooting(false);
      }
    }

    void boot();

    return () => {
      cancelled = true;
    };
  }, [latest]);

  return booting;
}
