import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cx } from "../../lib/cx";
import { TONE_SURFACE, type Tone } from "./tone";

const TONE_ICON: Record<Tone, typeof Info> = {
  neutral: Info,
  accent: Info,
  positive: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
};

export type AlertProps = {
  tone?: Tone;
  /** Qué ha pasado, en una frase corta. */
  title: ReactNode;
  /** Qué puede hacer la persona. */
  children?: ReactNode;
  /** Botones de recuperación. */
  actions?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Detalle técnico plegado: nunca es la primera línea que se lee. */
  details?: string | null;
  detailsLabel?: string;
  className?: string;
};

/**
 * Aviso accionable. Los errores del shell se muestran siempre así: título en
 * lenguaje llano, qué hacer a continuación y, si acaso, el detalle técnico
 * plegado para soporte.
 */
export function Alert({
  tone = "danger",
  title,
  children,
  actions,
  onDismiss,
  dismissLabel = "Cerrar aviso",
  details,
  detailsLabel = "Detalle técnico",
  className,
}: AlertProps) {
  const Icon = TONE_ICON[tone];
  const isUrgent = tone === "danger";

  return (
    <div
      className={cx(
        "flex items-start gap-4 rounded-panel border p-4 shadow-raised backdrop-blur-md",
        TONE_SURFACE[tone],
        className,
      )}
      role={isUrgent ? "alert" : "status"}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink">{title}</p>
        {children ? <div className="mt-1 text-sm text-ink-muted">{children}</div> : null}
        {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
        {details ? (
          <details className="mt-2">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs text-ink-faint hover:text-ink">
              {detailsLabel}
            </summary>
            <p className="mt-1 break-words font-mono text-xs text-ink-faint">{details}</p>
          </details>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          aria-label={dismissLabel}
          /* 44x44 aunque el icono sea pequeño: el objetivo lo marca el botón. */
          className="btn-ghost -mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-pill p-0 text-ink-muted"
          onClick={onDismiss}
          type="button"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  );
}
