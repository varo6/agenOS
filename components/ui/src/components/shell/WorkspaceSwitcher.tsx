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
    <div
      aria-label="Escritorios"
      className="flex items-center gap-1 rounded-control border border-line bg-surface p-1"
      role="group"
    >
      {workspaces.map((workspace) => {
        const isActive = activeWorkspace === workspace.number;

        return (
          <button
            aria-current={isActive ? "true" : undefined}
            aria-label={`Escritorio ${workspace.number}: ${workspace.label}`}
            className={cx(
              "grid h-8 w-8 place-items-center rounded text-sm font-medium transition-colors",
              isActive
                ? "bg-accent text-accent-ink"
                : "text-ink-muted hover:bg-surface-strong hover:text-ink",
            )}
            key={workspace.number}
            onClick={() => onFocus(workspace.number)}
            title={workspace.label}
            type="button"
          >
            {workspace.number}
          </button>
        );
      })}
      {/*
       * Nombre del escritorio activo para lectores de pantalla: el indicador
       * visual es el color, que por sí solo no comunica. Solo se anuncia en
       * vivo cuando el compositor empuja los cambios; si el valor viene de un
       * sondeo, anunciarlo sería ruido tardío.
       */}
      <span aria-live={live ? "polite" : "off"} className="sr-only">
        {`Escritorio activo: ${activeLabel}`}
      </span>
    </div>
  );
}

export const WorkspaceSwitcher = memo(WorkspaceSwitcherComponent);
