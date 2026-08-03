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
import { WorkspaceSwitcher } from "./components/shell/WorkspaceSwitcher";
import { VoiceConsole } from "./components/voice/VoiceConsole";
import { Alert, Button } from "./components/ui";
import { NetworkConnectionPanel } from "../../network/react/NetworkConnectionPanel";
import { createNetworkClient } from "../../network/client";
import { createAgentAdminClient } from "./lib/agent-admin-client";
import { createAgentClient } from "./lib/agent-client";
import { createPiClient } from "./lib/pi-client";
import { describeTurnActivity } from "./lib/agent-activity";
import { resolveWorkspaceSubscription } from "./lib/workspace-source";
import { useAgentHealth } from "./hooks/useAgentHealth";
import { useConversation } from "./hooks/useConversation";
import { useNetworkStatus } from "./hooks/useNetworkStatus";
import { usePiSession } from "./hooks/usePiSession";
import { useSystemAlert } from "./hooks/useSystemAlert";
import { useVoice, type VoiceAgentState } from "./hooks/useVoice";
import { useWorkspaces } from "./hooks/useWorkspaces";
import type { VoiceBlockedReason } from "./lib/voice-status";
import type { PiAuthState } from "./lib/pi-types";

const piClient = createPiClient();
const agentClient = createAgentClient();
const agentAdminClient = createAgentAdminClient();
const networkClient = createNetworkClient();

/*
 * Empuje del escritorio activo desde el compositor. Se resuelve una sola vez:
 * si el puente aún no existe, la barra sigue funcionando con la lectura HTTP.
 */
const workspaceSubscription = resolveWorkspaceSubscription(agentClient);

function describeAuthState(authState: PiAuthState): string {
  switch (authState) {
    case "connected":
      return "Conexion local lista para ChatGPT/Codex.";
    case "authorizing":
      return "Esperando a que termine el login del navegador.";
    case "error":
      return "La autenticacion necesita atencion.";
    default:
      return "Conecta ChatGPT para empezar.";
  }
}

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"chat" | "backend">("chat");

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
  const healthRefresh = health.refresh;
  const networkRefresh = network.refresh;
  const refreshWorkspaces = workspaces.refresh;

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

  const isProcessing = conversation.state === "processing" || session.busy;

  // Estado del agente traducido al ciclo de voz.
  const agentState: VoiceAgentState = isProcessing
    ? conversation.activeTurn?.progress.currentTool
      ? "working"
      : "thinking"
    : conversation.state === "error"
      ? "error"
      : "idle";

  const blockedReason: VoiceBlockedReason | null =
    network.online !== true
      ? "offline"
      : session.authState !== "connected"
        ? "disconnected"
        : isProcessing
          ? "busy"
          : null;

  const voice = useVoice({
    onTranscript: handleTranscript,
    agentState,
    currentTool: conversation.activeTurn?.progress.currentTool ?? null,
    blockedReason,
    agentIssue: alert?.hint ?? null,
  });

  // Arranque del shell: micrófono, estado del sistema, historial y red.
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      void Promise.allSettled([sessionRefresh(), healthRefresh(), refreshWorkspaces()]);
      await Promise.allSettled([restoreConversation(), networkRefresh()]);

      if (!cancelled) {
        setIsLoading(false);
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [healthRefresh, networkRefresh, refreshWorkspaces, restoreConversation, sessionRefresh]);

  const refreshAgentExperience = useCallback(() => {
    resetConversationError();
    void Promise.allSettled([
      sessionRefresh({ clearErrors: true }),
      healthRefresh(),
      refreshWorkspaces(),
    ]);
  }, [healthRefresh, refreshWorkspaces, resetConversationError, sessionRefresh]);

  function handleStartAuth(method: "device" | "browser" = "device") {
    if (network.online !== true) {
      sink.raise("Sin conexión a internet.", { kind: "offline" });
      return;
    }

    if (!session.ready || conversation.state === "processing") {
      return;
    }

    void session.startAuth(method);
  }

  function handleLogout() {
    if (!session.ready) {
      return;
    }

    void session.logout();
    resetConversationError();
    voice.reset();
  }

  function handleManualCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void session.submitManualCode();
  }

  function handleTextSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isProcessing) {
      return;
    }

    void sendMessage(conversation.draft, "text");
  }

  const agentsBlockedByNetwork = network.online !== true;
  const textDisabled =
    !session.ready
    || agentsBlockedByNetwork
    || isProcessing
    || session.authState === "authorizing";
  const connectLabel = session.authState === "disconnected" ? "Conectar ChatGPT" : "Reconectar";
  const authHint = session.pendingAttempt
    ? session.pendingAttempt.instructions
    : describeAuthState(session.authState);

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-canvas text-ink">
      <VideoBackground />
      <header className="fixed left-0 right-0 top-0 z-40 border-b border-line bg-black/55 backdrop-blur-xl">
        <div className="mx-auto grid h-12 w-full max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:px-6">
          <div className="font-display text-sm font-medium text-ink">AgenOS</div>
          <WorkspaceSwitcher
            activeWorkspace={workspaces.activeWorkspace}
            live={workspaces.live}
            onFocus={(workspace) => {
              void workspaces.focus(workspace);
            }}
            workspaces={workspaces.workspaces}
          />
          <div className="min-w-0 text-right font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
            <span className="hidden sm:inline">
              {session.authState === "connected" ? session.modelId : session.authState}
            </span>
            <span className="sm:hidden">{workspaces.activeWorkspace}</span>
          </div>
        </div>
      </header>
      <AgentDiagnosticsButton />

      {alert ? (
        <div className="fixed left-1/2 top-16 z-50 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2">
          <Alert
            details={alert.details}
            onDismiss={sink.clear}
            title={alert.title}
            tone={alert.tone}
          >
            {alert.hint}
          </Alert>
        </div>
      ) : null}

      {isLoading ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-6 backdrop-blur-sm">
          <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
            <LoaderCircle className="h-6 w-6 animate-spin text-ink-faint" />
            <p className="font-mono text-sm uppercase tracking-widest text-ink-faint">
              Iniciando AgenOS
            </p>
          </div>
        </div>
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
          <div className="mb-8 inline-flex rounded-control border border-line bg-black/25 p-1">
            <button
              className={[
                "rounded px-4 py-2 text-sm transition-colors",
                activeTab === "chat" ? "bg-white text-black" : "text-ink-muted hover:text-ink",
              ].join(" ")}
              onClick={() => setActiveTab("chat")}
              type="button"
            >
              Chat
            </button>
            <button
              className={[
                "rounded px-4 py-2 text-sm transition-colors",
                activeTab === "backend" ? "bg-white text-black" : "text-ink-muted hover:text-ink",
              ].join(" ")}
              onClick={() => setActiveTab("backend")}
              type="button"
            >
              Backend
            </button>
          </div>
          {activeTab === "backend" ? (
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
                    onConnectCodex={() => handleStartAuth("device")}
                    onOpenBackend={() => setActiveTab("backend")}
                    onRefresh={refreshAgentExperience}
                  />
                </div>

                <div className="glass-panel flex flex-col gap-6 p-7 sm:p-8">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="eyebrow">Estado de conexion</p>
                      <h2 className="mt-3 text-2xl font-medium text-ink">{session.providerName}</h2>
                      <p className="mt-2 text-sm text-ink-muted">{authHint}</p>
                    </div>
                    <div className="rounded-pill border border-line bg-black/20 px-3 py-1 font-mono text-[11px] text-ink-muted">
                      {session.modelId}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      disabled={!session.ready || session.authState === "authorizing" || isProcessing}
                      icon={<ArrowUpRight className="h-4 w-4" />}
                      loading={session.authState === "authorizing"}
                      onClick={() => handleStartAuth("device")}
                      variant="primary"
                    >
                      {connectLabel} con codigo
                    </Button>

                    <Button
                      disabled={!session.ready || session.authState === "authorizing"}
                      icon={<LogOut className="h-4 w-4" />}
                      onClick={handleLogout}
                    >
                      Logout
                    </Button>

                    {session.pendingAttempt ? (
                      <Button
                        disabled={!session.ready}
                        icon={<XCircle className="h-4 w-4" />}
                        onClick={() => {
                          void session.cancelAuth();
                        }}
                      >
                        Cancelar login
                      </Button>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="panel-inset p-4">
                      <div className="flex items-center gap-2 text-sm text-ink-muted">
                        {session.authState === "connected" ? (
                          <ShieldCheck className="h-4 w-4 text-positive" />
                        ) : (
                          <ShieldX className="h-4 w-4 text-danger" />
                        )}
                        Cuenta
                      </div>
                      <p className="mt-2 font-mono text-xs uppercase tracking-[0.24em] text-ink-faint">
                        {session.authState}
                      </p>
                    </div>

                    <div className="panel-inset p-4">
                      <div className="flex items-center gap-2 text-sm text-ink-muted">
                        <MessageSquareText className="h-4 w-4 text-ink-muted" />
                        Turno
                      </div>
                      <p className="mt-2 font-mono text-xs uppercase tracking-[0.24em] text-ink-faint">
                        {isProcessing ? "processing" : conversation.state}
                      </p>
                    </div>
                  </div>

                  {session.pendingAttempt ? (
                    session.pendingAttempt.method === "device" ? (
                      <div className="panel-inset grid gap-3 p-4">
                        <div>
                          <p className="eyebrow">Device auth</p>
                          <a
                            className="mt-2 inline-flex min-w-0 items-center gap-2 break-all text-sm text-accent-light hover:text-ink"
                            href={session.pendingAttempt.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {session.pendingAttempt.url}
                            <ExternalLink className="h-4 w-4 shrink-0" />
                          </a>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <code className="rounded-control border border-line bg-black/30 px-3 py-2 font-mono text-lg tracking-[0.18em] text-ink">
                            {session.pendingAttempt.userCode ?? "Esperando codigo..."}
                          </code>
                          <Button
                            disabled={!session.pendingAttempt.userCode}
                            icon={<Clipboard className="h-4 w-4" />}
                            onClick={() => {
                              const code = session.pendingAttempt?.userCode;
                              if (code) {
                                void navigator.clipboard?.writeText(code);
                              }
                            }}
                          >
                            Copiar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <form className="flex flex-col gap-3" onSubmit={handleManualCodeSubmit}>
                        <div>
                          <label className="eyebrow" htmlFor="manual-code">
                            Pegar URL o Codigo Manual
                          </label>
                          <input
                            className="glass-input mt-3"
                            id="manual-code"
                            onChange={(event) => session.setManualCode(event.target.value)}
                            placeholder="http://localhost:1455/auth/callback?... o el code"
                            value={session.manualCode}
                          />
                        </div>

                        <Button className="self-start" type="submit">
                          Enviar fallback manual
                        </Button>
                      </form>
                    )
                  ) : null}

                  <form className="flex flex-col gap-3" onSubmit={handleTextSubmit}>
                    <div>
                      <label className="eyebrow" htmlFor="message">
                        Texto
                      </label>
                      <input
                        className="glass-input mt-3"
                        disabled={textDisabled}
                        id="message"
                        onChange={(event) => conversation.setDraft(event.target.value)}
                        placeholder="Escribe una frase corta en espanol"
                        value={conversation.draft}
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <Button disabled={textDisabled} type="submit" variant="primary">
                        {isProcessing ? "Procesando..." : "Enviar"}
                      </Button>

                      <Button
                        disabled={!session.ready}
                        icon={<RefreshCcw className="h-4 w-4" />}
                        onClick={refreshAgentExperience}
                      >
                        Refrescar estado
                      </Button>
                    </div>
                  </form>
                </div>

                <div className="glass-panel flex flex-col gap-6 p-7 sm:p-8">
                  <div>
                    <p className="eyebrow">Conversacion</p>
                    <h2 className="mt-3 text-2xl font-medium text-ink">Historial con Pi</h2>
                    <p className="mt-2 text-sm text-ink-muted">
                      Los turnos se guardan en este equipo y sobreviven reinicios del shell.
                    </p>
                  </div>

                  <div className="flex max-h-[30rem] flex-col gap-3 overflow-y-auto pr-1">
                    {conversation.turns.length === 0 ? (
                      <div className="panel-inset p-5 text-sm text-ink-muted">
                        Todavia no hay conversacion. Escribe o usa el microfono para hablar con Pi.
                      </div>
                    ) : (
                      conversation.turns.map((turn) => (
                        <div className="panel-inset p-5" key={turn.turnId}>
                          <p className="eyebrow">Tu</p>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-muted">
                            {turn.input}
                          </p>
                          <p className="eyebrow mt-4">Pi</p>
                          {turn.status === "processing" ? (
                            <>
                              <p className="mt-2 inline-flex items-center gap-2 text-xs text-accent-light">
                                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                {describeTurnActivity(turn.progress) ?? "Pi está trabajando…"}
                              </p>
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">
                                {turn.progress.streamedText || "Esperando la primera respuesta de Pi..."}
                              </p>
                            </>
                          ) : turn.status === "failed" ? (
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-danger">
                              {turn.error ?? "El turno fallo."}
                            </p>
                          ) : (
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">
                              {turn.reply ?? ""}
                            </p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
