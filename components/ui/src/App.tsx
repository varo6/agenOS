import { useCallback, useState } from "react";

import { VideoBackground } from "./components/VideoBackground";
import {
  BootScreen,
  HomeView,
  SystemAlertBanner,
  SystemView,
  TopBar,
  type ShellSection,
} from "./components/shell";
import { NetworkConnectionPanel } from "../../network/react/NetworkConnectionPanel";
import {
  agentAdminClient,
  agentClient,
  networkClient,
  piClient,
  workspaceSubscription,
} from "./lib/clients";
import {
  isAgentBusy,
  needsSystemAttention,
  resolveAgentState,
  resolveBlockedReason,
} from "./lib/shell-state";
import { useAgentHealth } from "./hooks/useAgentHealth";
import { useConversation } from "./hooks/useConversation";
import { useNetworkStatus } from "./hooks/useNetworkStatus";
import { usePiSession } from "./hooks/usePiSession";
import { useShellActions } from "./hooks/useShellActions";
import { useShellBoot } from "./hooks/useShellBoot";
import { useSystemAlert } from "./hooks/useSystemAlert";
import { useVoice } from "./hooks/useVoice";
import { useWorkspaces } from "./hooks/useWorkspaces";

/**
 * Shell de AgenOS.
 *
 * Aquí no se pinta nada: se conectan los hooks de estado (red, sesión, salud,
 * conversación, voz) con las acciones y con las dos vistas que las muestran.
 * La presentación vive en `components/shell` y las reglas, en `lib/shell-state`.
 */
export default function App() {
  const [section, setSection] = useState<ShellSection>("home");
  const openSystem = useCallback(() => setSection("system"), []);

  const { alert, sink } = useSystemAlert();
  const network = useNetworkStatus(networkClient);
  const health = useAgentHealth(agentAdminClient);
  const session = usePiSession({ client: piClient, alert: sink });
  const workspaces = useWorkspaces({ client: agentClient, alert: sink, subscribe: workspaceSubscription });

  const isOffline = useCallback(() => network.online !== true, [network.online]);
  const isDisconnected = useCallback(() => session.authState !== "connected", [session.authState]);

  const handleTurnSettled = useCallback(() => {
    // Un turno puede haber abierto una app o cambiado de escritorio.
    void Promise.allSettled([session.refresh(), workspaces.refresh()]);
  }, [session.refresh, workspaces.refresh]);

  const conversation = useConversation({
    piClient,
    agentClient,
    alert: sink,
    isOffline,
    isDisconnected,
    onUnauthorized: session.markUnauthorized,
    onModelId: session.noteModelId,
    onSettled: handleTurnSettled,
  });

  const handleTranscript = useCallback(
    (transcript: string) => {
      void conversation.send(transcript, "voice");
    },
    [conversation.send],
  );

  const currentTool = conversation.activeTurn?.progress.currentTool ?? null;
  const activity = { conversationState: conversation.state, sessionBusy: session.busy, currentTool };
  const busy = isAgentBusy(activity);
  const blockedReason = resolveBlockedReason({
    online: network.online,
    authState: session.authState,
    busy,
  });

  const voice = useVoice({
    onTranscript: handleTranscript,
    agentState: resolveAgentState(activity),
    currentTool,
    blockedReason,
    agentIssue: alert?.hint ?? null,
  });

  const actions = useShellActions({
    session,
    network,
    health,
    workspaces,
    conversation,
    voice,
    alert: sink,
    openSystem,
  });

  const booting = useShellBoot({
    refreshSession: session.refresh,
    refreshHealth: health.refresh,
    refreshWorkspaces: workspaces.refresh,
    restoreConversation: conversation.restore,
    refreshNetwork: network.refresh,
  });

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-canvas text-ink">
      <VideoBackground />
      {/* Primer tabulador de la pantalla: saltarse la barra fija. */}
      <a
        className="sr-only z-50 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:rounded-control focus:bg-surface-strong focus:px-4 focus:py-2 focus:text-sm"
        href="#contenido"
      >
        Saltar al contenido
      </a>

      <TopBar
        needsAttention={needsSystemAttention({
          harnessAvailable: session.ready,
          backendError: health.error,
          adminStatus: health.status,
          authState: session.authState,
        })}
        onChangeSection={setSection}
        section={section}
      />

      {alert ? (
        <SystemAlertBanner
          alert={alert}
          onCheckNetwork={actions.checkNetwork}
          onDismiss={sink.clear}
          onOpenSystem={openSystem}
          onReconnect={actions.connect}
          onRetry={actions.refresh}
        />
      ) : null}

      {booting ? (
        <BootScreen />
      ) : network.online !== true ? (
        <NetworkConnectionPanel
          client={networkClient}
          onOnline={() => {
            network.markOnline();
            actions.refresh();
          }}
        />
      ) : section === "system" ? (
        <SystemView
          actions={actions}
          activeWorkspace={workspaces.activeWorkspace}
          adminClient={agentAdminClient}
          busy={busy}
          health={health}
          session={session}
          workspaces={workspaces.workspaces}
          workspacesLive={workspaces.live}
        />
      ) : (
        <HomeView
          actions={actions}
          blockedReason={blockedReason}
          busy={busy}
          conversation={conversation}
          health={health}
          session={session}
          voice={voice}
        />
      )}
    </div>
  );
}
