import { memo, type ReactNode } from "react";

import { cx } from "../../lib/cx";
import type { PiAuthState } from "../../lib/pi-types";
import type { AgentWorkspace, AgentWorkspaceNumber } from "../../lib/system-types";
import { Pill, type Tone } from "../ui";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

/** Las dos caras del shell: hablar con Pi y revisar el equipo. */
export type ShellSection = "home" | "system";

const SECTIONS: Array<{ id: ShellSection; label: string }> = [
  { id: "home", label: "Inicio" },
  { id: "system", label: "Sistema" },
];

/**
 * Estado de la cuenta en palabras. El color acompaña, nunca comunica solo: el
 * texto es la fuente de verdad para quien no distingue colores.
 */
const CONNECTION_COPY: Record<PiAuthState, { label: string; tone: Tone }> = {
  connected: { label: "Conectado", tone: "positive" },
  authorizing: { label: "Conectando…", tone: "warning" },
  error: { label: "Revisa tu cuenta", tone: "danger" },
  disconnected: { label: "Sin conectar", tone: "neutral" },
};

export type TopBarProps = {
  workspaces: AgentWorkspace[];
  activeWorkspace: AgentWorkspaceNumber;
  /** El compositor empuja el escritorio activo (no es un sondeo). */
  workspacesLive: boolean;
  onFocusWorkspace: (workspace: AgentWorkspaceNumber) => void;
  authState: PiAuthState;
  /** Modelo en uso; solo tiene sentido con la cuenta conectada. */
  modelId: string;
  section: ShellSection;
  onChangeSection: (section: ShellSection) => void;
  /** Ranura para acciones de soporte (diagnóstico). */
  actions?: ReactNode;
};

/**
 * Barra de sistema: identidad, navegación, escritorios y estado de la cuenta.
 * Es lo único fijo en pantalla, así que se mantiene deliberadamente escueta.
 */
function TopBarComponent({
  workspaces,
  activeWorkspace,
  workspacesLive,
  onFocusWorkspace,
  authState,
  modelId,
  section,
  onChangeSection,
  actions,
}: TopBarProps) {
  const connection = CONNECTION_COPY[authState];

  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <span className="font-display text-sm font-semibold tracking-tight text-ink">AgenOS</span>
          <nav aria-label="Secciones" className="flex items-center gap-1">
            {SECTIONS.map((item) => (
              <button
                aria-current={section === item.id ? "page" : undefined}
                className={cx(
                  "rounded-control px-3 py-1.5 text-sm transition-colors",
                  section === item.id
                    ? "bg-surface-strong text-ink"
                    : "text-ink-faint hover:text-ink",
                )}
                key={item.id}
                onClick={() => onChangeSection(item.id)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <WorkspaceSwitcher
          activeWorkspace={activeWorkspace}
          live={workspacesLive}
          onFocus={onFocusWorkspace}
          workspaces={workspaces}
        />

        <div className="flex min-w-0 items-center justify-end gap-2">
          {authState === "connected" ? (
            <span className="hidden font-mono text-[11px] text-ink-faint lg:inline">{modelId}</span>
          ) : null}
          <Pill className="hidden sm:inline-flex" dot pulse={authState === "authorizing"} tone={connection.tone}>
            {connection.label}
          </Pill>
          {actions}
        </div>
      </div>
    </header>
  );
}

export const TopBar = memo(TopBarComponent);
