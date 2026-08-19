import { memo } from "react";
import { ArrowLeft, Settings } from "lucide-react";

import { cx } from "../../lib/cx";

/** Las dos caras del shell: hablar con Pi y revisar el equipo. */
export type ShellSection = "home" | "system";

export type SectionSwitchProps = {
  section: ShellSection;
  onChangeSection: (section: ShellSection) => void;
  /** Hay algo que mirar en Sistema, aunque no impida hablar con Pi. */
  needsAttention?: boolean;
};

/**
 * El paso entre las dos caras del shell, en un solo botón.
 *
 * Antes esto era una barra fija con dos pestañas, y la pestaña "Inicio" estaba
 * siempre encendida diciendo dónde estás cuando ya se ve dónde estás. Inicio no
 * es un destino: es la pantalla. Así que queda un único control en la esquina,
 * la rueda de ajustes de toda la vida, y desde Sistema esa misma esquina es la
 * flecha de volver. Un sitio, un botón, ninguna franja permanente comiéndose el
 * borde de arriba de la pantalla en la que se habla.
 */
function SectionSwitchComponent({
  section,
  onChangeSection,
  needsAttention = false,
}: SectionSwitchProps) {
  const onHome = section === "home";
  const target: ShellSection = onHome ? "system" : "home";
  /*
   * El aviso también se dice con palabras: un punto de color no lo ve todo el
   * mundo, y quien navega con lector de pantalla no lo ve en absoluto.
   */
  const marked = onHome && needsAttention;
  const label = onHome ? (marked ? "Sistema, necesita atención" : "Sistema") : "Inicio";
  const Icon = onHome ? Settings : ArrowLeft;

  return (
    <div className="group fixed right-4 top-4 z-40 flex items-center gap-3 sm:right-6 sm:top-6">
      {/*
       * Un icono solo no dice gran cosa a quien no vive en las interfaces: al
       * pasar por encima o al llegar con el teclado aparece a su lado el nombre
       * de a dónde lleva. Se pinta encima, sin ocupar sitio en el flujo, para
       * que aparecer no mueva nada de la pantalla.
       */}
      <span
        aria-hidden="true"
        className={cx(
          "pointer-events-none rounded-pill border border-line bg-sunken px-4 py-2 text-sm text-ink-muted opacity-0 transition-opacity duration-200",
          "group-focus-within:opacity-100 group-hover:opacity-100",
        )}
      >
        {onHome ? "Sistema" : "Volver a Inicio"}
      </span>

      <button
        aria-label={label}
        className={cx(
          "relative grid h-12 w-12 shrink-0 place-items-center rounded-pill border border-line bg-sunken/80 text-ink-faint backdrop-blur-xl transition-colors",
          "hover:border-line-strong hover:bg-surface-strong hover:text-ink",
        )}
        onClick={() => onChangeSection(target)}
        type="button"
      >
        <Icon aria-hidden="true" className="h-6 w-6" strokeWidth={1.5} />

        {marked ? (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 h-2.5 w-2.5 rounded-pill bg-warning"
          />
        ) : null}
      </button>
    </div>
  );
}

export const SectionSwitch = memo(SectionSwitchComponent);
