import { memo, useMemo } from "react";
import { LoaderCircle, MessagesSquare } from "lucide-react";

import { describeTurnActivity } from "../../lib/agent-activity";
import type { PiTurnState } from "../../lib/pi-types";
import { EmptyState, Panel } from "../ui";

export type ConversationPanelProps = {
  turns: PiTurnState[];
};

function TurnCard({ turn }: { turn: PiTurnState }) {
  return (
    <article className="panel-inset p-4 sm:p-5">
      <p className="eyebrow">Tú</p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{turn.input}</p>

      <p className="eyebrow mt-5">Pi</p>
      {turn.status === "processing" ? (
        <>
          <p className="mt-2 inline-flex items-center gap-2 text-xs text-accent-light">
            <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            {describeTurnActivity(turn.progress) ?? "Pi está trabajando…"}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-muted">
            {turn.progress.streamedText || "Esperando la primera respuesta de Pi…"}
          </p>
        </>
      ) : turn.status === "failed" ? (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-danger">
          {turn.error ?? "Pi no pudo terminar esta respuesta."}
        </p>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-muted">
          {turn.reply ?? ""}
        </p>
      )}
    </article>
  );
}

/**
 * Historial de la conversación.
 *
 * La lista no es una región en vivo: el texto en streaming la volvería
 * insoportable con lector de pantalla, porque cada fragmento interrumpiría al
 * anterior. En su lugar se anuncia una sola vez la respuesta final del turno.
 */
function ConversationPanelComponent({ turns }: ConversationPanelProps) {
  const lastReply = useMemo(() => {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn.status === "succeeded" && turn.reply) {
        return turn.reply;
      }
    }

    return "";
  }, [turns]);

  return (
    <Panel
      className="w-full"
      description="Se guarda en este equipo y sobrevive a los reinicios."
      eyebrow="Conversación"
      title="Lo que has hablado con Pi"
    >
      {turns.length === 0 ? (
        <EmptyState
          description="Pulsa el micrófono y pídele algo, o escríbeselo en el campo de arriba."
          icon={<MessagesSquare aria-hidden="true" className="h-6 w-6" />}
          title="Todavía no habéis hablado"
        />
      ) : (
        <div
          aria-label="Conversación con Pi"
          className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1"
          role="log"
          tabIndex={0}
        >
          {turns.map((turn) => (
            <TurnCard key={turn.turnId} turn={turn} />
          ))}
        </div>
      )}

      <p aria-live="polite" className="sr-only" role="status">
        {lastReply ? `Pi responde: ${lastReply}` : ""}
      </p>
    </Panel>
  );
}

export const ConversationPanel = memo(ConversationPanelComponent);
