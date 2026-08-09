import { memo } from "react";
import { cx } from "../../lib/cx";
import type { AgentWorkspace, AgentWorkspaceNumber } from "../../lib/system-types";

export type WorkspaceSwitcherProps = {
  workspaces: AgentWorkspace[];
  activeWorkspace: AgentWorkspaceNumber;
  onFocus: (workspace: AgentWorkspaceNumber) => void;
  /** El compositor empuja el escritorio activo: lo que se ve es el estado real. */
  live?: boolean;
};

/**
 * Cambio de escritorio.
 *
 * Vive en Sistema y no en la barra fija: un escritorio numerado es un concepto
 * del gestor de ventanas, no una tarea, y a Pi se le puede pedir el cambio
 * hablando. Aquí cada botón lleva su nombre escrito además del número, porque
 * un "3" suelto no le dice a nadie a dónde va.
 */
function WorkspaceSwitcherComponent({
  workspaces,
  activeWorkspace,
  onFocus,
  live = false,
}: WorkspaceSwitcherProps) {
  const activeLabel =
    workspaces.find((workspace) => workspace.number === activeWorkspace)?.label
    ?? String(activeWorkspace);

  return (
    <div aria-label="Escritorios" className="flex flex-wrap gap-3" role="group">
      {workspaces.map((workspace) => {
        const isActive = activeWorkspace === workspace.number;

        return (
          <button
            aria-current={isActive ? "true" : undefined}
            aria-label={`Escritorio ${workspace.number}: ${workspace.label}`}
            className={cx(
              "inline-flex min-h-14 flex-1 items-center gap-3 rounded-control border px-4 text-base font-medium transition-colors sm:flex-none",
              isActive
                ? "border-accent bg-accent text-accent-ink"
                : "border-line bg-sunken text-ink-muted hover:border-line-strong hover:text-ink",
            )}
            key={workspace.number}
            onClick={() => onFocus(workspace.number)}
            type="button"
          >
            <span aria-hidden="true" className="font-mono text-sm opacity-70">
              {workspace.number}
            </span>
            <span aria-hidden="true">{workspace.label}</span>
          </button>
        );
      })}
      {/*
       * Nombre del escritorio activo para lectores de pantalla. Solo se anuncia
       * en vivo cuando el compositor empuja los cambios; si el valor viene de
       * un sondeo, anunciarlo sería ruido tardío.
       */}
      <span aria-live={live ? "polite" : "off"} className="sr-only">
        {`Escritorio activo: ${activeLabel}`}
      </span>
    </div>
  );
}

export const WorkspaceSwitcher = memo(WorkspaceSwitcherComponent);
