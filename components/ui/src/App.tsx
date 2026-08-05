import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  Clipboard,
  ExternalLink,
  LoaderCircle,
  LogOut,
  MessageSquareText,
  Mic,
  RefreshCcw,
  ShieldCheck,
  ShieldX,
  XCircle,
} from "lucide-react";

import { AgentDiagnosticsButton } from "./components/AgentDiagnosticsButton";
import { AgentAdminPanel } from "./components/AgentAdminPanel";
import { AgentHealthChecklist } from "./components/AgentHealthChecklist";
import { AgentOnboardingPanel } from "./components/AgentOnboardingPanel";
import { VideoBackground } from "./components/VideoBackground";
import { BootScreen } from "./components/shell/BootScreen";
import { Composer } from "./components/shell/Composer";
import { ConnectionPanel } from "./components/shell/ConnectionPanel";
import { ConversationPanel } from "./components/shell/ConversationPanel";
import { SystemAlertBanner } from "./components/shell/SystemAlertBanner";
import { TopBar, type ShellSection } from "./components/shell/TopBar";
import { VoiceConsole } from "./components/voice/VoiceConsole";
import { Button } from "./components/ui";
import { NetworkConnectionPanel } from "../../network/react/NetworkConnectionPanel";
import { createNetworkClient } from "../../network/client";
import { createAgentAdminClient } from "./lib/agent-admin-client";
import { createAgentClient } from "./lib/agent-client";
import { createPiClient } from "./lib/pi-client";
import { describeTurnActivity } from "./lib/agent-activity";
import {
  describeComposerBlock,
  isAgentBusy,
  resolveAgentState,
  resolveBlockedReason,
} from "./lib/shell-state";
import { resolveWorkspaceSubscription } from "./lib/workspace-source";
import { useAgentHealth } from "./hooks/useAgentHealth";
import { useConversation } from "./hooks/useConversation";
import { useNetworkStatus } from "./hooks/useNetworkStatus";
import { usePiSession } from "./hooks/usePiSession";
import { useSystemAlert } from "./hooks/useSystemAlert";
import { useVoice } from "./hooks/useVoice";
import { useWorkspaces } from "./hooks/useWorkspaces";
import type { PiAuthState } from "./lib/pi-types";
import type { AgentWorkspaceNumber } from "./lib/system-types";

const piClient = createPiClient();
const agentClient = createAgentClient();
const agentAdminClient = createAgentAdminClient();
const networkClient = createNetworkClient();

/*
 * Empuje del escritorio activo desde el compositor. Se resuelve una sola vez:
 * si el puente aún no existe, la barra sigue funcionando con la lectura HTTP.
 */
const workspaceSubscription = resolveWorkspaceSubscription(agentClient);

/*
 * El botón de diagnóstico no recibe props: se crea una sola vez para que la
 * barra de sistema siga siendo memoizable.
 */
const diagnosticsAction = <AgentDiagnosticsButton />;

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [section, setSection] = useState<ShellSection>("home");

  const { alert, sink } = useSystemAlert();
  const network = useNetworkStatus(networkClient);
  const health = useAgentHealth(agentAdminClient);
  const session = usePiSession({ client: piClient, alert: sink });

  const workspaces = useWorkspaces({
    client: agentClient,
    alert: sink,
    subscribe: workspaceSubscription,
  });

  const isOffline = useCallback(() => network.online !== true, [network.online]);
  const isDisconnected = useCallback(() => session.authState !== "connected", [session.authState]);

  /*
   * Los hooks devuelven objetos nuevos en cada render, pero sus funciones son
   * estables. Los efectos y callbacks dependen solo de las funciones: si
   * dependieran del objeto entero, cada pulsación de tecla reiniciaría el
   * arranque, el micrófono y los sondeos.
   */
  const sessionRefresh = session.refresh;
  const startAuth = session.startAuth;
  const sessionLogout = session.logout;
  const healthRefresh = health.refresh;
  const networkRefresh = network.refresh;
  const refreshWorkspaces = workspaces.refresh;
  const workspaceFocus = workspaces.focus;

  const handleTurnSettled = useCallback(() => {
    void Promise.allSettled([sessionRefresh(), refreshWorkspaces()]);
  }, [refreshWorkspaces, sessionRefresh]);

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

  const sendMessage = conversation.send;
  const restoreConversation = conversation.restore;
  const resetConversationError = conversation.resetError;

  const handleTranscript = useCallback(
    (transcript: string) => {
      void sendMessage(transcript, "voice");
    },
    [sendMessage],
  );

  const currentTool = conversation.activeTurn?.progress.currentTool ?? null;
  const activity = { conversationState: conversation.state, sessionBusy: session.busy, currentTool };
  const isProcessing = isAgentBusy(activity);

  const blockedReason = resolveBlockedReason({
    online: network.online,
    authState: session.authState,
    busy: isProcessing,
  });

  const voice = useVoice({
    onTranscript: handleTranscript,
    agentState: resolveAgentState(activity),
    currentTool,
    blockedReason,
    agentIssue: alert?.hint ?? null,
  });

  const resetVoice = voice.reset;

  // Arranque del shell: micrófono, estado del sistema, historial y red.
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      void Promise.allSettled([sessionRefresh(), healthRefresh(), refreshWorkspaces()]);
      await restoreConversation();
      await networkRefresh();

      if (!cancelled) {
        setIsLoading(false);
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [healthRefresh, networkRefresh, refreshWorkspaces, restoreConversation, sessionRefresh]);

  const focusWorkspace = useCallback(
    (workspace: AgentWorkspaceNumber) => {
      void workspaceFocus(workspace);
    },
    [workspaceFocus],
  );

  const openSystemSection = useCallback(() => setSection("system"), []);

  const refreshAgentExperience = useCallback(() => {
    resetConversationError();
    void Promise.allSettled([
      sessionRefresh({ clearErrors: true }),
      healthRefresh(),
      refreshWorkspaces(),
    ]);
  }, [healthRefresh, refreshWorkspaces, resetConversationError, sessionRefresh]);

  const connect = useCallback(() => {
    if (network.online !== true) {
      sink.raise("Sin conexión a internet.", { kind: "offline" });
      return;
    }

    if (!session.ready || conversation.state === "processing") {
      return;
    }

    void startAuth("device");
  }, [conversation.state, network.online, session.ready, sink, startAuth]);

  const checkNetwork = useCallback(() => {
    void networkRefresh();
  }, [networkRefresh]);

  const logout = useCallback(() => {
    if (!session.ready) {
      return;
    }

    void sessionLogout();
    resetConversationError();
    resetVoice();
  }, [resetConversationError, resetVoice, session.ready, sessionLogout]);

  const draft = conversation.draft;

  const sendDraft = useCallback(() => {
    void sendMessage(draft, "text");
  }, [draft, sendMessage]);

  const textDisabled = !session.ready || blockedReason !== null || session.authState === "authorizing";
  const composerBlock = describeComposerBlock(blockedReason, session.ready);

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-canvas text-ink">
      <VideoBackground />
      <TopBar
        actions={diagnosticsAction}
        activeWorkspace={workspaces.activeWorkspace}
        authState={session.authState}
        modelId={session.modelId}
        onChangeSection={setSection}
        onFocusWorkspace={focusWorkspace}
        section={section}
        workspaces={workspaces.workspaces}
        workspacesLive={workspaces.live}
      />

      {alert ? (
        <SystemAlertBanner
          alert={alert}
          onCheckNetwork={checkNetwork}
          onDismiss={sink.clear}
          onOpenSystem={openSystemSection}
          onReconnect={connect}
          onRetry={refreshAgentExperience}
        />
      ) : null}

      {isLoading ? (
        <BootScreen />
      ) : network.online !== true ? (
        <NetworkConnectionPanel
          client={networkClient}
          onOnline={() => {
            network.markOnline();
            refreshAgentExperience();
          }}
        />
      ) : (
        <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col items-center justify-center px-6 pb-20 pt-28 sm:pb-28 sm:pt-32">
          {section === "system" ? (
            <div className="grid w-full gap-4">
              <AgentAdminPanel client={agentAdminClient} />
            </div>
          ) : (
            <div className="flex w-full flex-col items-center gap-12 text-center">
              <div className="space-y-6">
                <div className="inline-flex items-center gap-2 rounded-pill border border-line bg-surface px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-ink-faint backdrop-blur-md">
                  <span
                    className={[
                      "h-1.5 w-1.5 rounded-pill",
                      session.authState === "connected"
                        ? "bg-accent"
                        : session.authState === "error"
                          ? "bg-danger"
                          : "bg-ink-faint",
                    ].join(" ")}
                  />
                  {session.ready ? "Sistema listo" : "Sistema sin respuesta"}
                </div>

                <h1 className="font-display text-5xl font-medium tracking-tight text-ink sm:text-7xl lg:text-8xl">
                  AgenOS
                </h1>

                <p className="mx-auto max-w-xl text-base text-ink-muted sm:text-lg">
                  Habla con Pi para abrir aplicaciones, buscar archivos y organizar tu equipo.
                </p>
              </div>

              <VoiceConsole
                buttonLabel={voice.buttonLabel}
                onActivate={voice.start}
                onCancel={voice.cancel}
                status={voice.status}
              />

              <div className="grid w-full gap-4 text-left lg:grid-cols-[1.1fr_0.9fr]">
                <div className="grid gap-4 lg:col-span-2">
                  <AgentHealthChecklist
                    adminStatus={health.status}
                    authState={session.authState}
                    backendError={health.error}
                    harnessAvailable={session.ready}
                  />
                  <AgentOnboardingPanel
                    adminStatus={health.status}
                    authState={session.authState}
                    backendError={health.error}
                    harnessAvailable={session.ready}
                    onConnectCodex={connect}
                    onOpenBackend={openSystemSection}
                    onRefresh={refreshAgentExperience}
                  />
                </div>

                <ConnectionPanel
                  authState={session.authState}
                  busy={isProcessing}
                  manualCode={session.manualCode}
                  modelId={session.modelId}
                  onCancelAuth={session.cancelAuth}
                  onConnect={connect}
                  onLogout={logout}
                  onManualCodeChange={session.setManualCode}
                  onRefresh={refreshAgentExperience}
                  onSubmitManualCode={session.submitManualCode}
                  pendingAttempt={session.pendingAttempt}
                  providerName={session.providerName}
                  ready={session.ready}
                />

                <Composer
                  busy={isProcessing}
                  disabled={textDisabled}
                  disabledReason={textDisabled ? composerBlock : null}
                  onChange={conversation.setDraft}
                  onSubmit={sendDraft}
                  value={conversation.draft}
                />

                <ConversationPanel turns={conversation.turns} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
