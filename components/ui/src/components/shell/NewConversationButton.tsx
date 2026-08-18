import { memo } from "react";
import { Plus } from "lucide-react";

import { cx } from "../../lib/cx";

export type NewConversationButtonProps = {
  onStart: () => void;
  /** Hay un turno en vuelo: empezar otra conversación ahora la cortaría. */
  busy: boolean;
  className?: string;
};

/**
 * Empezar de cero, en la esquina.
 *
 * Es la única acción de la pantalla que no es hablar, así que va donde no
 * estorbe: abajo a la derecha, del tamaño justo para acertar con el dedo pero
 * con el peso visual de un detalle. Quien viene a hablar no la ve; quien busca
 * cómo cerrar el tema la encuentra donde ya la ha visto en otros sitios.
 *
 * El "+" solo no dice gran cosa a quien no vive en las interfaces de chat, así
 * que al pasar por encima o al llegar con el teclado aparece a su lado el
 * nombre completo de lo que hace. La etiqueta se pinta encima, sin ocupar sitio
 * en el flujo, para que aparecer no mueva nada de la pantalla.
 */
function NewConversationButtonComponent({ onStart, busy, className }: NewConversationButtonProps) {
  const label = busy
    ? "Espera a que Pi termine para empezar otra conversación"
    : "Empezar una conversación nueva";

  return (
    <div className={cx("group fixed bottom-6 right-6 z-30 flex items-center gap-3", className)}>
      <span
        aria-hidden="true"
        className={cx(
          "pointer-events-none rounded-pill border border-line bg-sunken px-4 py-2 text-sm text-ink-muted opacity-0 transition-opacity duration-200",
          "group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        {busy ? "Pi está respondiendo" : "Conversación nueva"}
      </span>

      <button
        /*
         * Como el orbe: nunca se deshabilita del todo, para que quien navega con
         * teclado o lector de pantalla llegue hasta aquí y oiga por qué no puede
         * usarlo ahora. La pulsación se ignora cuando no procede.
         */
        aria-disabled={busy ? "true" : undefined}
        aria-label={label}
        className={cx(
          "grid h-14 w-14 shrink-0 place-items-center rounded-pill border border-line bg-sunken text-ink-faint transition-colors",
          busy
            ? "cursor-not-allowed opacity-60"
            : "hover:border-line-strong hover:bg-surface-strong hover:text-ink",
        )}
        onClick={() => {
          if (busy) {
            return;
          }

          onStart();
        }}
        type="button"
      >
        <Plus aria-hidden="true" className="h-7 w-7" strokeWidth={1.5} />
      </button>
    </div>
  );
}

export const NewConversationButton = memo(NewConversationButtonComponent);
