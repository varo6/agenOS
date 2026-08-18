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
import { LatestReply } from "./LatestReply";

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
  const composerHint = composerDisabled
    ? describeComposerBlock(blockedReason, session.ready)
    : null;

  return (
    <main
      className={cx(
        "relative z-10 mx-auto flex min-h-[100dvh] w-full flex-col items-center px-4 pb-16 sm:px-6",
        // Sin conversación, el orbe se queda en el centro de la pantalla.
        /*
         * Con conversación la pantalla se ensancha: el bloque de respuesta es
         * el que más texto tiene que enseñar y quien manda en el ancho. La
         * franja de arriba, en cambio, se mide en `vh` y no en píxeles fijos:
         * en un monitor grande baja el grupo de hablar hacia el centro óptico,
         * y en una pantalla baja (la VM arranca en 600px de alto) encoge sola
         * hasta el suelo de 5rem, que es lo justo para no pegarse a la barra.
         * El aire entre bloques sigue la misma regla, y por eso la condición es
         * de altura y no de anchura: lo que escasea es el alto.
         */
        isFirstUse
          ? "max-w-3xl justify-center gap-8 pt-24"
          : "max-w-4xl gap-5 pt-[max(5rem,16vh)] [@media(min-height:800px)]:gap-8",
      )}
      id="contenido"
    >
      {isFirstUse ? (
        <>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
            Hola, soy Pi
          </h1>

          <VoiceConsole
            buttonLabel={voice.buttonLabel}
            onActivate={voice.start}
            onCancel={voice.cancel}
            status={voice.status}
          />

          <Composer
            busy={busy}
            className="max-w-xl"
            disabled={composerDisabled}
            disabledReason={composerHint}
            onChange={conversation.setDraft}
            onSubmit={actions.sendDraft}
            value={conversation.draft}
          />
        </>
      ) : (
        <>
          <h1 className="sr-only">Conversación con Pi</h1>

          {/*
           * Con conversación abierta, hablar y escribir comparten fila. El orbe
           * grande vale la pantalla entera cuando no hay nada que leer, pero en
           * cuanto Pi contesta esos 300px de alto son la diferencia entre leer
           * la respuesta o tener que buscarla con la rueda del ratón. Encogido
           * sigue siendo el elemento con más peso de la fila.
           *
           * La fila se queda estrecha a propósito, más que el bloque de abajo:
           * centrada y con menos ancho que la respuesta, se lee como el mando
           * de la pantalla y no como una barra más. El ancho sobrante es para
           * el texto, que es lo único que crece.
           */}
          <div className="flex w-full max-w-2xl flex-col gap-2">
            <div className="flex items-center gap-3 sm:gap-4">
              <VoiceConsole
                buttonLabel={voice.buttonLabel}
                className="shrink-0"
                onActivate={voice.start}
                onCancel={voice.cancel}
                size="compact"
                status={voice.status}
              />

              <Composer
                busy={busy}
                className="min-w-0 flex-1"
                disabled={composerDisabled}
                disabledReason={composerHint}
                onChange={conversation.setDraft}
                onSubmit={actions.sendDraft}
                value={conversation.draft}
              />
            </div>

            {/*
             * El orbe compacto se queda sin sus dos líneas, pero la fase no
             * puede contarse solo con el color: aquí va, en una sola línea.
             * Cuando el campo está apagado, su propio motivo dice ya lo mismo y
             * además va asociado al input, así que esta línea se aparta en vez
             * de repetirlo; lo que Pi esté haciendo se ve igualmente en el
             * bloque de respuesta, que muestra el turno en curso.
             */}
            {composerHint ? null : (
              <p className="text-center text-base text-ink-muted">{voice.status.title}</p>
            )}
          </div>

          {/*
           * Lo último que ha dicho Pi va justo bajo el campo de escribir, donde
           * ya está mirando la persona, y el historial completo debajo. El orden
           * es deliberado: primero lo que acaba de pasar, después lo que hay que
           * buscar.
           */}
          <LatestReply turns={conversation.turns} />
          <ConversationPanel turns={conversation.turns} />
        </>
      )}
    </main>
  );
}
