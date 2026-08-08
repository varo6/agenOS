import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cx } from "../../lib/cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-danger",
};

/*
 * Ningún tamaño baja de 44px de alto. `sm` no es "pequeño" sino "secundario":
 * sigue siendo pulsable con el dedo, solo pesa menos en la jerarquía.
 */
const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "min-h-11 px-4 text-sm",
  md: "min-h-12 px-5 text-sm",
  lg: "min-h-14 px-7 text-base",
};

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icono a la izquierda del texto. Se sustituye por el spinner cuando `loading`. */
  icon?: ReactNode;
  loading?: boolean;
  /** Ocupa todo el ancho disponible. */
  block?: boolean;
  className?: string;
};

/**
 * Botón único del shell. Centraliza variantes, tamaños, estado de carga y el
 * `aria-busy` correspondiente para que ningún panel los reimplemente.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    icon,
    loading = false,
    block = false,
    disabled = false,
    className,
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      aria-busy={loading || undefined}
      className={cx("btn", VARIANT_CLASS[variant], SIZE_CLASS[size], block && "w-full", className)}
      disabled={disabled || loading}
      ref={ref}
      type={type}
      {...rest}
    >
      {loading ? (
        <LoaderCircle aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
});
