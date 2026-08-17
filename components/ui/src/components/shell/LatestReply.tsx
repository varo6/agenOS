import { memo, useMemo } from "react";
import { LoaderCircle } from "lucide-react";

import { describeTurnActivity } from "../../lib/agent-activity";
import type { PiTurnState } from "../../lib/pi-types";

export type LatestReplyProps = {
  turns: PiTurnState[];
};

/**
 * Lo último que ha dicho Pi, en grande y pegado al campo de escribir.
 *
 * Sin voz de vuelta, la respuesta hay que leerla, y leerla en una tarjeta del
 * historial obliga a buscar cuál de todas es la nueva. Aquí siempre está en el
 * mismo sitio y con el cuerpo de texto más grande del shell. No lleva título:
 * un rótulo tipo "última respuesta" gastaría una línea para decir lo que la
 * posición ya dice.
 */
function LatestReplyComponent({ turns }: LatestReplyProps) {
  const latest = turns.length > 0 ? turns[turns.length - 1] : null;

  /*
   * El anuncio para lectores de pantalla vive aquí, y solo con respuestas ya
   * terminadas: si siguiera al streaming, cada fragmento cortaría al anterior.
   * Es la única región en vivo de la conversación; el historial no lo es.
   */
  const lastFinishedReply = useMemo(() => {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn.status === "succeeded" && turn.reply) {
        return turn.reply;
      }
    }

    return "";
  }, [turns]);

  if (!latest) {
    return null;
  }

  return (
    <section aria-label="Lo último que ha dicho Pi" className="panel w-full max-w-2xl p-5 sm:p-7">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="eyebrow">Pi</p>
        {latest.status === "processing" ? (
          <span className="inline-flex items-center gap-2 text-sm text-accent-light">
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
            {describeTurnActivity(latest.progress) ?? "Pi está trabajando…"}
          </span>
        ) : null}
      </div>

      {/*
       * Una respuesta larga no puede empujar el historial fuera de la pantalla:
       * a partir de cierta altura se desplaza dentro del bloque, y con tabIndex
       * para poder hacerlo también con el teclado. El tope va en `vh` porque lo
       * que manda es la pantalla que hay, no un número de líneas fijo.
       */}
      <div className="mt-3 max-h-[52vh] overflow-y-auto pr-1" tabIndex={0}>
        {latest.status === "processing" ? (
          <p className="whitespace-pre-wrap text-xl leading-relaxed text-ink sm:text-2xl">
            {latest.progress.streamedText || (
              <span className="text-ink-muted">Pi está preparando lo que va a decir…</span>
            )}
          </p>
        ) : latest.status === "failed" ? (
          <p className="whitespace-pre-wrap text-xl leading-relaxed text-danger sm:text-2xl">
            {latest.error ?? "Pi no pudo terminar esta respuesta."}
          </p>
        ) : (
          <p className="whitespace-pre-wrap text-xl leading-relaxed text-ink sm:text-2xl">
            {latest.reply || (
              <span className="text-ink-muted">Pi ha terminado sin decir nada.</span>
            )}
          </p>
        )}
      </div>

      <p aria-live="polite" className="sr-only" role="status">
        {lastFinishedReply ? `Pi responde: ${lastFinishedReply}` : ""}
      </p>
    </section>
  );
}

export const LatestReply = memo(LatestReplyComponent);
