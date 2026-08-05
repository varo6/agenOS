import { cx } from "../../lib/cx";
import { describeComposerBlock, resolveShellReadiness } from "../../lib/shell-state";
import type { VoiceBlockedReason } from "../../lib/voice-status";
import type { AgentHealthController } from "../../hooks/useAgentHealth";
import type { Conversation } from "../../hooks/useConversation";
import type { PiSession } from "../../hooks/usePiSession";
import type { ShellActions } from "../../hooks/useShellActions";
import type { VoiceController } from "../../hooks/useVoice";
import { AgentOnboardingPanel } from "../AgentOnboardingPanel";
import { VoiceConsole } from "../voice/VoiceConsole";
import { Composer } from "./Composer";
import { ConnectionPanel } from "./ConnectionPanel";
import { ConversationPanel } from "./ConversationPanel";

export type HomeViewProps = {
  voice: VoiceController;
  conversation: Conversation;
  session: PiSession;
  health: AgentHealthController;
  /** Por qué no se puede hablar ahora mismo, si es que no se puede. */
  blockedReason: VoiceBlockedReason | null;
  /** Hay un turno en vuelo. */
  busy: boolean;
  actions: ShellActions;
};

/**
 * Pantalla principal: hablar con Pi.
 *
 * El orden es el del uso real y no el de la arquitectura: primero el
 * micrófono, después la alternativa escrita, después lo que haya que arreglar
 * para poder usarlo y por último el historial. Lo técnico que no bloquea vive
 * en Sistema.
 */
export function HomeView({
  voice,
  conversation,
  session,
  health,
  blockedReason,
  busy,
  actions,
}: HomeViewProps) {
  const readiness = resolveShellReadiness({
    harnessAvailable: session.ready,
    backendError: health.error,
    adminStatus: health.status,
    authState: session.authState,
  });

  const isBlocked = readiness === "blocked";
  const isFirstUse = conversation.turns.length === 0;
  const composerDisabled = !session.ready || blockedReason !== null;

  return (
    <main
      className={cx(
        "relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col items-center gap-10 px-4 pb-16 pt-24 sm:px-6 sm:pt-28",
        // Sin conversación ni tareas pendientes, el orbe se queda en el centro.
        isFirstUse && !isBlocked && "justify-center",
      )}
      id="contenido"
    >
      {isFirstUse ? (
        <div className="text-center">
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink sm:text-5xl">
            Hola, soy Pi
          </h1>
          <p className="mx-auto mt-3 max-w-md text-base leading-7 text-ink-muted">
            Dime qué necesitas y lo hago en este equipo: abrir aplicaciones, buscar archivos o
            cambiar de escritorio.
          </p>
        </div>
      ) : (
        <h1 className="sr-only">Conversación con Pi</h1>
      )}

      <VoiceConsole
        buttonLabel={voice.buttonLabel}
        onActivate={voice.start}
        onCancel={voice.cancel}
        status={voice.status}
      />

      <Composer
        busy={busy}
        disabled={composerDisabled}
        disabledReason={composerDisabled ? describeComposerBlock(blockedReason, session.ready) : null}
        onChange={conversation.setDraft}
        onSubmit={actions.sendDraft}
        value={conversation.draft}
      />

      {/*
       * Lo que impide usar a Pi se resuelve aquí mismo: mandar a la persona a
       * otra sección para poder empezar sería pedirle que adivine.
       */}
      {isBlocked ? (
        <div className="grid w-full gap-4">
          <AgentOnboardingPanel
            adminStatus={health.status}
            authState={session.authState}
            backendError={health.error}
            harnessAvailable={session.ready}
            onConnectCodex={actions.connect}
            onOpenSystem={actions.openSystem}
            onRefresh={actions.refresh}
          />

          {session.authState !== "connected" ? (
            <ConnectionPanel
              authState={session.authState}
              busy={busy}
              manualCode={session.manualCode}
              modelId={session.modelId}
              onCancelAuth={session.cancelAuth}
              onConnect={actions.connect}
              onLogout={actions.logout}
              onManualCodeChange={session.setManualCode}
              onRefresh={actions.refresh}
              onSubmitManualCode={session.submitManualCode}
              pendingAttempt={session.pendingAttempt}
              providerName={session.providerName}
              ready={session.ready}
            />
          ) : null}
        </div>
      ) : null}

      <ConversationPanel turns={conversation.turns} />
    </main>
  );
}
