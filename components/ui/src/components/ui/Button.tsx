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

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-[0.8125rem]",
  md: "px-4 py-2.5 text-sm",
  lg: "px-5 py-3 text-base",
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
        <LoaderCircle aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
});
