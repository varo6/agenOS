import { memo } from "react";
import { Bookmark, BookmarkCheck, LoaderCircle, MessagesSquare } from "lucide-react";

import { describeTurnActivity } from "../../lib/agent-activity";
import { cx } from "../../lib/cx";
import type { PiTurnState } from "../../lib/pi-types";
import { Button, EmptyState, Panel } from "../ui";

export type ConversationPanelProps = {
  turns: PiTurnState[];
  /** Turnos que el usuario ya ha guardado en esta pantalla. */
  savedTurnIds: ReadonlySet<string>;
  /** Turnos con la marca todavía en vuelo. */
  savingTurnIds: ReadonlySet<string>;
  failedTurnIds: ReadonlySet<string>;
  onSaveToMemory: (turnId: string) => void;
};

/** Palabras de la petición que caben en una etiqueta sin volverla ilegible. */
const LABEL_WORDS = 6;

/**
 * Las primeras palabras de lo que se pidió.
 *
 * Sirven para nombrar el botón: con varias tarjetas en la lista, tres botones
 * llamados "Guardar en memoria" son indistinguibles con lector de pantalla.
 */
function summarizeInput(input: string): string {
  const words = input.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "lo anterior";
  }

  const head = words.slice(0, LABEL_WORDS).join(" ");
  return words.length > LABEL_WORDS ? `${head}…` : head;
}

type SaveToMemoryButtonProps = {
  turn: PiTurnState;
  saved: boolean;
  saving: boolean;
  failed: boolean;
  onSave: (turnId: string) => void;
};

/**
 * "Guardar en memoria": el gesto con el que el usuario dice que esta respuesta
 * le ha servido.
 *
 * No pregunta nada ni enseña la nota. Mantiene el estado de escritura visible
 * y solo cambia el texto final cuando el broker confirma el fichero.
 */
function SaveToMemoryButton({ turn, saved, saving, failed, onSave }: SaveToMemoryButtonProps) {
  const subject = summarizeInput(turn.input);
  const label = saved
    ? `Ya guardada en memoria la respuesta a “${subject}”`
    : saving
      ? `Guardando en memoria la respuesta a “${subject}”`
      : `Guardar en memoria la respuesta a “${subject}”`;

  return (
    <div className="mt-4 flex flex-col">
      <Button
        aria-label={label}
        className={cx("self-start", saved && "text-accent-light")}
        disabled={saved}
        icon={saved
          ? <BookmarkCheck aria-hidden="true" className="h-5 w-5 shrink-0" />
          : <Bookmark aria-hidden="true" className="h-5 w-5 shrink-0" />}
        loading={saving}
        onClick={() => onSave(turn.turnId)}
        size="md"
        variant="ghost"
      >
        {saved ? "Lo tendré en cuenta" : saving ? "Guardando…" : "Guardar en memoria"}
      </Button>

      {/*
       * El acuse se anuncia aquí y no en el botón: al guardarse, el botón se
       * apaga y el foco se queda sin nada que leer. Es la única región en vivo
       * de la tarjeta, y está vacía hasta que hay algo que decir, para que
       * abrir el historial no dispare ningún anuncio.
       */}
      <p aria-live="polite" className="sr-only" role="status">
        {saved ? `Guardado. Tendré en cuenta cómo resolví “${subject}”.` : ""}
      </p>
      {failed ? (
        <p className="mt-1 text-sm text-danger" role="status">
          No se pudo guardar. Puedes intentarlo de nuevo.
        </p>
      ) : null}
    </div>
  );
}

type TurnCardProps = {
  turn: PiTurnState;
  saved: boolean;
  saving: boolean;
  failed: boolean;
  onSaveToMemory: (turnId: string) => void;
};

function TurnCard({ turn, saved, saving, failed, onSaveToMemory }: TurnCardProps) {
  return (
    <article className="panel-inset p-4 sm:p-5">
      {/* Quién habla, en palabras normales: la etiqueta mono de antes se leía peor. */}
      <p className="text-sm font-semibold text-ink-faint">Tú</p>
      <p className="mt-1 whitespace-pre-wrap text-base text-ink">{turn.input}</p>

      <p className="mt-4 text-sm font-semibold text-ink-faint">Pi</p>
      {turn.status === "processing" ? (
        <>
          <p className="mt-1 inline-flex items-center gap-2 text-sm text-accent-light">
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
            {describeTurnActivity(turn.progress) ?? "Pi está trabajando…"}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-base text-ink-muted">
            {turn.progress.streamedText || "Esperando la primera respuesta de Pi…"}
          </p>
        </>
      ) : turn.status === "failed" ? (
        <p className="mt-1 whitespace-pre-wrap text-base text-danger">
          {turn.error ?? "Pi no pudo terminar esta respuesta."}
        </p>
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-base text-ink-muted">
          {turn.reply ?? (turn.status === "cancelled" ? "Respuesta detenida." : "")}
        </p>
      )}

      {/*
       * Solo bajo una respuesta terminada y con contenido: guardar algo que se
       * quedó a medias o que falló enseñaría a Pi justo lo que no funcionó.
       */}
      {turn.status === "succeeded" && turn.reply ? (
        <SaveToMemoryButton failed={failed} onSave={onSaveToMemory} saved={saved} saving={saving} turn={turn} />
      ) : null}
    </article>
  );
}

/**
 * Historial de la conversación.
 *
 * La lista no es una región en vivo: el texto en streaming la volvería
 * insoportable con lector de pantalla, porque cada fragmento interrumpiría al
 * anterior. Quien anuncia la respuesta terminada, una sola vez, es
 * `LatestReply`; aquí solo se navega lo que ya ha pasado.
 */
function ConversationPanelComponent({
  turns,
  savedTurnIds,
  savingTurnIds,
  failedTurnIds,
  onSaveToMemory,
}: ConversationPanelProps) {
  return (
    <Panel className="w-full" title="Conversación">
      {turns.length === 0 ? (
        <EmptyState
          description="Pulsa el micrófono y pídele algo."
          icon={<MessagesSquare aria-hidden="true" className="h-7 w-7" />}
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
            <TurnCard
              key={turn.turnId}
              onSaveToMemory={onSaveToMemory}
              saved={savedTurnIds.has(turn.turnId)}
              saving={savingTurnIds.has(turn.turnId)}
              failed={failedTurnIds.has(turn.turnId)}
              turn={turn}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

export const ConversationPanel = memo(ConversationPanelComponent);
