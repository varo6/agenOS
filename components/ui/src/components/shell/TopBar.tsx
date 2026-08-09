import { memo } from "react";

import { cx } from "../../lib/cx";

/** Las dos caras del shell: hablar con Pi y revisar el equipo. */
export type ShellSection = "home" | "system";

const SECTIONS: Array<{ id: ShellSection; label: string }> = [
  { id: "home", label: "Inicio" },
  { id: "system", label: "Sistema" },
];

export type TopBarProps = {
  section: ShellSection;
  onChangeSection: (section: ShellSection) => void;
  /** Hay algo que mirar en Sistema, aunque no impida hablar con Pi. */
  needsAttention?: boolean;
};

/**
 * Barra de sistema: dos destinos y nada más.
 *
 * Antes cargaba también el nombre del producto, los cinco escritorios, el
 * modelo en uso, el estado de la cuenta y el botón de diagnóstico. Todo eso
 * era información permanente sobre la máquina en la única franja que nunca
 * desaparece de la pantalla; ahora vive en Sistema, que es donde se va cuando
 * uno quiere mirar la máquina en vez de hablar con Pi.
 */
function TopBarComponent({ section, onChangeSection, needsAttention = false }: TopBarProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-line bg-canvas/90 backdrop-blur-xl">
      <nav
        aria-label="Secciones"
        className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 sm:px-6"
      >
        {SECTIONS.map((item) => {
          const marked = item.id === "system" && needsAttention;

          return (
            <button
              aria-current={section === item.id ? "page" : undefined}
              /*
               * El aviso también se dice con palabras: un punto de color no lo
               * ve todo el mundo, y quien navega con lector de pantalla no lo
               * ve en absoluto.
               */
              aria-label={marked ? `${item.label}, necesita atención` : undefined}
              className={cx(
                "inline-flex min-h-12 items-center gap-2 rounded-control px-5 text-base font-medium transition-colors",
                section === item.id
                  ? "bg-surface-strong text-ink"
                  : "text-ink-muted hover:bg-surface hover:text-ink",
              )}
              key={item.id}
              onClick={() => onChangeSection(item.id)}
              type="button"
            >
              {item.label}
              {marked ? (
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-pill bg-warning" />
              ) : null}
            </button>
          );
        })}
      </nav>
    </header>
  );
}

export const TopBar = memo(TopBarComponent);
