import type { ReactNode } from "react";
import { cx } from "../../lib/cx";
import { TONE_DOT, TONE_SURFACE, type Tone } from "./tone";

export type StatusDotProps = {
  tone: Tone;
  /** Latido suave para estados en curso. */
  pulse?: boolean;
  className?: string;
};

/** Punto de estado. Siempre acompañado de texto: nunca comunica solo por color. */
export function StatusDot({ tone, pulse = false, className }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "relative inline-flex h-2 w-2 shrink-0 rounded-pill",
        TONE_DOT[tone],
        className,
      )}
    >
      {pulse ? (
        <span
          className={cx("absolute inset-0 animate-breathe rounded-pill", TONE_DOT[tone])}
        />
      ) : null}
    </span>
  );
}

export type PillProps = {
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
};

/** Etiqueta compacta de estado para barras y cabeceras. */
export function Pill({ tone = "neutral", dot = false, pulse = false, children, className, title }: PillProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-pill border px-3 py-1 text-xs font-medium",
        TONE_SURFACE[tone],
        className,
      )}
      title={title}
    >
      {dot ? <StatusDot pulse={pulse} tone={tone} /> : null}
      {children}
    </span>
  );
}
