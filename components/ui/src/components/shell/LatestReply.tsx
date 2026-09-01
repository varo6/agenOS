import { memo, useMemo } from "react";
import { LoaderCircle, Square } from "lucide-react";

import { describeTurnActivity } from "../../lib/agent-activity";
import type { PiTurnState } from "../../lib/pi-types";
import { Button } from "../ui";

export type LatestReplyProps = {
  turns: PiTurnState[];
  onStop?: () => void;
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
function LatestReplyComponent({ turns, onStop }: LatestReplyProps) {
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
    /*
     * Ocupa todo el ancho que le deje la pantalla, que es más del que ocupan el
     * micrófono y el campo de escribir. No es capricho: cada línea cabe casi el
     * doble de texto que antes, así que a igualdad de alto se lee bastante más
     * respuesta sin desplazarse.
     */
    <section aria-label="Lo último que ha dicho Pi" className="panel w-full p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="eyebrow">Pi</p>
        {latest.status === "processing" ? (
          <>
            <span className="inline-flex items-center gap-2 text-sm text-accent-light">
              <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
              {describeTurnActivity(latest.progress) ?? "Pi está trabajando…"}
            </span>
            {onStop ? (
              <Button
                className="ml-auto"
                icon={<Square aria-hidden="true" className="h-3.5 w-3.5 fill-current" />}
                onClick={onStop}
                size="sm"
                type="button"
                variant="secondary"
              >
                Parar respuesta
              </Button>
            ) : null}
          </>
        ) : null}
      </div>

      {/*
       * Una respuesta larga no puede empujar el historial fuera de la pantalla:
       * a partir de cierta altura se desplaza dentro del bloque, y con tabIndex
       * para poder hacerlo también con el teclado. El tope va en `vh` porque lo
       * que manda es la pantalla que hay, no un número de líneas fijo, y baja
       * de 52 a 40 para que asome el historial: un bloque que llega justo al
       * borde no cuenta que debajo hay más.
       */}
      <div className="mt-4 max-h-[40vh] overflow-y-auto pr-1" tabIndex={0}>
        {/*
         * El texto baja un peldaño (de 30px a 26px) y gana el ancho del panel.
         * A 30px en una columna estrecha las frases se partían cada cinco
         * palabras y el bloque parecía apretado; así entran unos 60 caracteres
         * por línea, que es la medida en la que se lee de corrido, y sigue
         * siendo el cuerpo de texto más grande del shell.
         */}
        {latest.status === "processing" ? (
          <p className="whitespace-pre-wrap text-lg leading-relaxed text-ink sm:text-xl">
            {latest.progress.streamedText || (
              <span className="text-ink-muted">Pi está preparando lo que va a decir…</span>
            )}
          </p>
        ) : latest.status === "failed" ? (
          <p className="whitespace-pre-wrap text-lg leading-relaxed text-danger sm:text-xl">
            {latest.error ?? "Pi no pudo terminar esta respuesta."}
          </p>
        ) : (
          <p className="whitespace-pre-wrap text-lg leading-relaxed text-ink sm:text-xl">
            {latest.reply || (latest.status === "cancelled" ? (
              <span className="text-ink-muted">Respuesta detenida.</span>
            ) : (
              <span className="text-ink-muted">Pi ha terminado sin decir nada.</span>
            ))}
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
