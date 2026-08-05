import { memo, useId, type FormEvent } from "react";
import { SendHorizontal } from "lucide-react";

import { Button } from "../ui";

export type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  /** Hay un turno en curso: el botón se anuncia como ocupado. */
  busy: boolean;
  /** Por qué no se puede escribir ahora mismo, si es que no se puede. */
  disabledReason?: string | null;
};

/**
 * Entrada de texto. La voz es la vía principal, pero escribir siempre está
 * disponible: es la salida cuando el micrófono falla, cuando hay ruido o
 * cuando lo que hay que dictar es una ruta o un nombre raro.
 */
function ComposerComponent({
  value,
  onChange,
  onSubmit,
  disabled,
  busy,
  disabledReason = null,
}: ComposerProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const hasHint = Boolean(disabledReason);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) {
      return;
    }

    onSubmit();
  }

  return (
    <form className="w-full max-w-2xl" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor={inputId}>
        Escribe a Pi
      </label>
      <div className="flex items-center gap-2 rounded-pill border border-line bg-sunken p-1.5 transition-colors focus-within:border-line-strong">
        <input
          aria-describedby={hasHint ? hintId : undefined}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-faint disabled:cursor-not-allowed"
          disabled={disabled}
          id={inputId}
          onChange={(event) => onChange(event.target.value)}
          placeholder="O escríbeselo aquí…"
          value={value}
        />
        <Button
          className="rounded-pill"
          disabled={disabled || value.trim().length === 0}
          icon={<SendHorizontal aria-hidden="true" className="h-4 w-4" />}
          loading={busy}
          size="sm"
          type="submit"
          variant="primary"
        >
          Enviar
        </Button>
      </div>
      {/*
       * Un campo apagado sin explicación parece una interfaz rota: si no se
       * puede escribir, aquí se dice por qué.
       */}
      {hasHint ? (
        <p className="mt-2 text-center text-xs leading-5 text-ink-faint" id={hintId}>
          {disabledReason}
        </p>
      ) : null}
    </form>
  );
}

export const Composer = memo(ComposerComponent);
