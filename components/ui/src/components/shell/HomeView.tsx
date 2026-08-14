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
 * Tiene dos caras y nunca las dos a la vez. Si falta algo para poder hablar,
 * la pantalla es solo eso que falta: un titular, una frase y el botón que lo
 * arregla. Si no falta nada, la pantalla es el micrófono, y el historial solo
 * aparece cuando ya hay algo que recordar. Lo técnico no vive aquí en ninguno
 * de los dos casos.
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

  if (readiness === "blocked") {
    return (
      <main
        className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col justify-center gap-5 px-4 pb-16 pt-28 sm:px-6"
        id="contenido"
      >
        <h1 className="sr-only">Falta un paso para hablar con Pi</h1>

        <AgentOnboardingPanel
          adminStatus={health.status}
          authState={session.authState}
          backendError={health.error}
          harnessAvailable={session.ready}
          onConnectCodex={actions.connect}
          onOpenSystem={actions.openSystem}
          onRefresh={actions.refresh}
        />

        {/*
         * El panel de cuenta solo baja aquí cuando hay un código que copiar:
         * en cualquier otro momento repetiría el botón de arriba y obligaría a
         * elegir entre dos caminos que llevan al mismo sitio.
         */}
        {session.pendingAttempt ? (
          <ConnectionPanel
            authState={session.authState}
            busy={busy}
            compact
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
      </main>
    );
  }

  const isFirstUse = conversation.turns.length === 0;
  const composerDisabled = !session.ready || blockedReason !== null;

  return (
    <main
      className={cx(
        "relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col items-center gap-10 px-4 pb-16 pt-28",
        // Sin conversación, el orbe se queda en el centro de la pantalla.
        isFirstUse && "justify-center",
      )}
      id="contenido"
    >
      {isFirstUse ? (
        <h1 className="font-display text-4xl font-medium tracking-tight text-ink sm:text-5xl">
          Hola, soy Pi
        </h1>
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

      {/* El historial aparece cuando hay historial: un panel vacío es ruido. */}
      {isFirstUse ? null : <ConversationPanel turns={conversation.turns} />}
    </main>
  );
}
