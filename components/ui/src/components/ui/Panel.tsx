import type { ReactNode } from "react";
import { cx } from "../../lib/cx";

export type PanelProps = {
  /** Etiqueta corta en mayúsculas sobre el título. */
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  /** Acciones alineadas a la derecha de la cabecera. */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Nombre accesible de la región cuando no hay título visible. */
  ariaLabel?: string;
};

/**
 * Contenedor estándar del shell: cabecera opcional (eyebrow / título /
 * descripción / acciones) y cuerpo. Todo el espaciado sale de aquí para que los
 * paneles no diverjan entre sí.
 */
export function Panel({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  ariaLabel,
}: PanelProps) {
  const hasHeader = Boolean(eyebrow || title || description || actions);

  return (
    <section aria-label={ariaLabel} className={cx("panel p-5 text-left sm:p-6", className)}>
      {hasHeader ? (
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            {title ? (
              <h2 className="mt-2.5 font-display text-xl font-medium tracking-tight text-ink">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-2 max-w-prose text-sm leading-6 text-ink-muted">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children ? (
        <div className={cx(hasHeader && "mt-5", bodyClassName)}>{children}</div>
      ) : null}
    </section>
  );
}

export type PanelInsetProps = {
  children?: ReactNode;
  className?: string;
};

/** Bloque interior de un panel (métricas, celdas de lista, salidas). */
export function PanelInset({ children, className }: PanelInsetProps) {
  return <div className={cx("panel-inset p-4", className)}>{children}</div>;
}
