import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "../../lib/cx";

export type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "id"> & {
  label: string;
  /** Oculta visualmente la etiqueta pero la mantiene para lectores de pantalla. */
  hideLabel?: boolean;
  hint?: ReactNode;
  /** Mensaje de error: marca el campo como inválido y lo anuncia. */
  error?: string | null;
  className?: string;
  containerClassName?: string;
  id?: string;
};

/**
 * Campo de texto con etiqueta, ayuda y error correctamente asociados
 * (`htmlFor`, `aria-describedby`, `aria-invalid`). Evita inputs sueltos sin
 * nombre accesible, que era el patrón anterior.
 */
export function Field({
  label,
  hideLabel = false,
  hint,
  error,
  className,
  containerClassName,
  id,
  ...rest
}: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? `field-${generatedId}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = cx(hint ? hintId : undefined, error ? errorId : undefined) || undefined;

  return (
    <div className={cx("flex flex-col gap-2", containerClassName)}>
      <label className={cx("eyebrow", hideLabel && "sr-only")} htmlFor={inputId}>
        {label}
      </label>
      <input
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={cx("field-input", className)}
        id={inputId}
        {...rest}
      />
      {hint ? (
        <p className="text-xs leading-5 text-ink-faint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs leading-5 text-danger" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
