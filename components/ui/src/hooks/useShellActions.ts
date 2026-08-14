import { useCallback, useMemo } from "react";

import type { AgentWorkspaceNumber } from "../lib/system-types";
import type { AgentHealthController } from "./useAgentHealth";
import type { Conversation } from "./useConversation";
import type { NetworkStatusController } from "./useNetworkStatus";
import type { PiSession } from "./usePiSession";
import type { AlertSink } from "./useSystemAlert";
import type { VoiceController } from "./useVoice";
import type { WorkspacesController } from "./useWorkspaces";

/** Lo que la persona puede pedirle al shell desde cualquier vista. */
export type ShellActions = {
  /** Conecta la cuenta por código de dispositivo. */
  connect: () => void;
  logout: () => void;
  /** Vuelve a leer sesión, salud y escritorios, y limpia el error anterior. */
  refresh: () => void;
  checkNetwork: () => void;
  openSystem: () => void;
  sendDraft: () => void;
  focusWorkspace: (workspace: AgentWorkspaceNumber) => void;
};

export type UseShellActionsOptions = {
  session: PiSession;
  network: NetworkStatusController;
  health: AgentHealthController;
  workspaces: WorkspacesController;
  conversation: Conversation;
  voice: VoiceController;
  alert: AlertSink;
  openSystem: () => void;
};

/**
 * Acciones del shell.
 *
 * Cada una cruza varios hooks (conectar necesita red, sesión y conversación;
 * cerrar sesión también apaga el micrófono), así que viven juntas y no dentro
 * de un componente de presentación.
 *
 * Los hooks devuelven objetos nuevos en cada render pero sus funciones son
 * estables: las dependencias son siempre las funciones y los valores sueltos,
 * nunca el objeto entero. Si dependieran del objeto, cada pulsación de tecla
 * cambiaría todos los callbacks y tiraría por tierra la memoización de la
 * barra, los paneles y el historial.
 */
export function useShellActions({
  session,
  network,
  health,
  workspaces,
  conversation,
  voice,
  alert,
  openSystem,
}: UseShellActionsOptions): ShellActions {
  const { ready: sessionReady, startAuth, logout: sessionLogout, refresh: refreshSession } = session;
  const { online, refresh: refreshNetwork } = network;
  const { refresh: refreshHealth } = health;
  const { refresh: refreshWorkspaces, focus: focusWorkspaceRequest } = workspaces;
  const { state: conversationState, draft, send, resetError } = conversation;
  const { reset: resetVoice } = voice;

  const refresh = useCallback(() => {
    resetError();
    void Promise.allSettled([refreshSession({ clearErrors: true }), refreshHealth(), refreshWorkspaces()]);
  }, [refreshHealth, refreshSession, refreshWorkspaces, resetError]);

  const connect = useCallback(() => {
    if (online !== true) {
      alert.raise("Sin internet", { kind: "offline" });
      return;
    }

    // Conectar en mitad de un turno lo dejaría a medias.
    if (!sessionReady || conversationState === "processing") {
      return;
    }

    void startAuth("device");
  }, [alert, conversationState, online, sessionReady, startAuth]);

  const logout = useCallback(() => {
    if (!sessionReady) {
      return;
    }

    void sessionLogout();
    resetError();
    resetVoice();
  }, [resetError, resetVoice, sessionLogout, sessionReady]);

  const checkNetwork = useCallback(() => {
    void refreshNetwork();
  }, [refreshNetwork]);

  const sendDraft = useCallback(() => {
    void send(draft, "text");
  }, [draft, send]);

  const focusWorkspace = useCallback(
    (workspace: AgentWorkspaceNumber) => {
      void focusWorkspaceRequest(workspace);
    },
    [focusWorkspaceRequest],
  );

  return useMemo(
    () => ({ connect, logout, refresh, checkNetwork, openSystem, sendDraft, focusWorkspace }),
    [checkNetwork, connect, focusWorkspace, logout, openSystem, refresh, sendDraft],
  );
}
