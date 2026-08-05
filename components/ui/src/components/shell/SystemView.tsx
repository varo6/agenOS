import type { createAgentAdminClient } from "../../lib/agent-admin-client";
import type { AgentHealthController } from "../../hooks/useAgentHealth";
import type { PiSession } from "../../hooks/usePiSession";
import type { ShellActions } from "../../hooks/useShellActions";
import { AgentAdminPanel } from "../AgentAdminPanel";
import { AgentHealthChecklist } from "../AgentHealthChecklist";
import { ConnectionPanel } from "./ConnectionPanel";

export type SystemViewProps = {
  session: PiSession;
  health: AgentHealthController;
  adminClient: ReturnType<typeof createAgentAdminClient>;
  busy: boolean;
  actions: ShellActions;
};

/**
 * Sección "Sistema": el estado del equipo, de la cuenta y del servicio que hace
 * funcionar a Pi. Todo lo técnico vive aquí para que la pantalla principal se
 * pueda dedicar a hablar; solo hace falta entrar si algo va mal.
 */
export function SystemView({ session, health, adminClient, busy, actions }: SystemViewProps) {
  return (
    <main
      className="relative z-10 mx-auto grid w-full max-w-5xl gap-4 px-4 pb-16 pt-24 text-left sm:px-6 sm:pt-28"
      id="contenido"
    >
      <div>
        <h1 className="font-display text-2xl font-medium tracking-tight text-ink">Sistema</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
          Estado del equipo, de tu cuenta y del servicio que hace funcionar a Pi.
        </p>
      </div>

      <AgentHealthChecklist
        adminStatus={health.status}
        authState={session.authState}
        backendError={health.error}
        harnessAvailable={session.ready}
      />

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

      <AgentAdminPanel client={adminClient} />
    </main>
  );
}
