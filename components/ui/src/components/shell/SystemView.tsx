import { useState } from "react";
import { Settings2 } from "lucide-react";

import type { createAgentAdminClient } from "../../lib/agent-admin-client";
import type { AgentWorkspace, AgentWorkspaceNumber } from "../../lib/system-types";
import type { AgentHealthController } from "../../hooks/useAgentHealth";
import type { PiSession } from "../../hooks/usePiSession";
import type { ShellActions } from "../../hooks/useShellActions";
import { AgentAdminPanel } from "../AgentAdminPanel";
import { AgentDiagnosticsButton } from "../AgentDiagnosticsButton";
import { AgentHealthChecklist } from "../AgentHealthChecklist";
import { LearningPanel } from "../LearningPanel";
import { Button, Panel } from "../ui";
import { NetworkConnectionPanel } from "../../../../network/react/NetworkConnectionPanel";
import type { NetworkClient } from "../../../../network/client";
import { ConnectionPanel } from "./ConnectionPanel";
import { AudioSettingsPanel } from "./AudioSettingsPanel";
import { DisplaySettingsPanel } from "./DisplaySettingsPanel";
import { PowerPanel } from "./PowerPanel";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export type SystemViewProps = {
  session: PiSession;
  health: AgentHealthController;
  adminClient: ReturnType<typeof createAgentAdminClient>;
  busy: boolean;
  actions: ShellActions;
  workspaces: AgentWorkspace[];
  activeWorkspace: AgentWorkspaceNumber;
  /** El compositor empuja el escritorio activo (no es un sondeo). */
  workspacesLive: boolean;
  networkClient: NetworkClient;
};

/**
 * Sección "Sistema".
 *
 * Dos niveles a propósito. Arriba, lo que una persona puede necesitar tocar:
 * su cuenta y el escritorio en el que está. Debajo, plegado, todo lo técnico
 * (estado del servicio, administración e informe de soporte), que sigue siendo
 * alcanzable y funcional pero no le sale al paso a quien solo viene a
 * reconectar ChatGPT.
 */
export function SystemView({
  session,
  health,
  adminClient,
  busy,
  actions,
  workspaces,
  activeWorkspace,
  workspacesLive,
  networkClient,
}: SystemViewProps) {
  const [showSystemSettings, setShowSystemSettings] = useState(false);

  return (
    <main
      className="relative z-10 mx-auto grid w-full max-w-4xl gap-5 px-4 pb-16 pt-28 text-left sm:px-6"
      id="contenido"
    >
      <h1 className="font-display text-3xl font-medium tracking-tight text-ink">Sistema</h1>

      <ConnectionPanel
        authState={session.authState}
        busy={busy}
        manualCode={session.manualCode}
        modelId={session.modelId}
        onCancelAuth={session.cancelAuth}
        onConnect={actions.connect}
        onLogout={actions.logout}
        onManualCodeChange={session.setManualCode}
        onRefresh={actions.refresh}
        onSubmitManualCode={session.submitManualCode}
        pendingAttempt={session.pendingAttempt}
        providerName={session.providerName}
        ready={session.ready}
      />

      <Button
        aria-expanded={showSystemSettings}
        aria-controls="ajustes-del-portatil"
        icon={<Settings2 aria-hidden="true" className="h-5 w-5" />}
        onClick={() => setShowSystemSettings((visible) => !visible)}
      >
        {showSystemSettings ? "Ocultar ajustes del portátil" : "Más ajustes"}
      </Button>

      {showSystemSettings ? (
        <section aria-label="Ajustes del portátil" className="grid gap-5" id="ajustes-del-portatil">
          <NetworkConnectionPanel allowDisconnect client={networkClient} embedded />
          <DisplaySettingsPanel />
          <AudioSettingsPanel />
          <PowerPanel />
        </section>
      ) : null}

      <Panel title="Escritorios">
        <WorkspaceSwitcher
          activeWorkspace={activeWorkspace}
          live={workspacesLive}
          onFocus={actions.focusWorkspace}
          workspaces={workspaces}
        />
      </Panel>

      <LearningPanel client={adminClient} />

      {/*
       * Un `details` y no una pestaña: se abre con teclado, se anuncia como
       * botón y, una vez abierto, se queda abierto. Nada se esconde detrás de
       * un tooltip ni desaparece solo.
       */}
      <details>
        <summary className="panel cursor-pointer px-5 py-4 text-base font-medium text-ink">
          Detalles técnicos
        </summary>

        <div className="mt-5 grid gap-5">
          <AgentHealthChecklist
            adminStatus={health.status}
            authState={session.authState}
            backendError={health.error}
            harnessAvailable={session.ready}
          />

          <Panel description="Copia este informe si necesitas ayuda con el equipo." title="Soporte">
            <AgentDiagnosticsButton />
          </Panel>

          <AgentAdminPanel client={adminClient} />
        </div>
      </details>
    </main>
  );
}
