import { useState } from "react";
import { FlaskConical, RotateCcw } from "lucide-react";
import type { AgentActionResponse, AgentAdminStatus } from "../lib/system-types";

type SetupClient = {
  updateConfig(patch: { mode: "local-simulated" }): Promise<AgentActionResponse>;
  testConnection(): Promise<AgentActionResponse>;
};

export type AgentBackendSetupPanelProps = {
  client: SetupClient;
  readiness: AgentAdminStatus["readiness"];
  setupItems: AgentAdminStatus["setupItems"];
  lastErrorCorrelationId?: string | null;
  testButtonLabel?: string;
};

export function AgentBackendSetupPanel({
  client,
  readiness,
  setupItems,
  lastErrorCorrelationId = null,
  testButtonLabel = "Probar conexion",
}: AgentBackendSetupPanelProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"test" | "simulate" | null>(null);

  async function runTestConnection() {
    setBusyAction("test");
    try {
      const response = await client.testConnection();
      setMessage(response.message ?? (response.ok ? "Conexion correcta." : "La conexion necesita atencion."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo probar la conexion.");
    } finally {
      setBusyAction(null);
    }
  }

  async function useLocalSimulated() {
    setBusyAction("simulate");
    try {
      const response = await client.updateConfig({ mode: "local-simulated" });
      setMessage(response.message ?? "Modo simulado activado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cambiar el modo.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="rounded-lg border border-white/10 bg-black/20 p-4 text-left">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">
            Backend
          </p>
          <h3 className="mt-2 text-lg font-medium text-white">
            {readiness === "needs_setup" ? "Setup requerido" : readiness === "degraded" ? "Modo degradado usable" : "Listo"}
          </h3>
        </div>
        <span className="rounded-md border border-white/10 px-2 py-1 font-mono text-[11px] uppercase text-white/55">
          {readiness}
        </span>
      </div>

      {setupItems.length > 0 ? (
        <div className="mt-4 grid gap-2">
          {setupItems.map((item) => (
            <div className="rounded-md border border-white/8 bg-white/[0.03] px-3 py-2" key={item.id}>
              <p className="text-sm text-white/85">{item.label}</p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
                {item.severity} / {item.action}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-white/55">
          No hay acciones de setup pendientes.
        </p>
      )}

      {lastErrorCorrelationId ? (
        <p className="mt-3 break-all font-mono text-xs text-danger">
          {lastErrorCorrelationId}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          aria-label={testButtonLabel}
          className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
          disabled={busyAction !== null}
          onClick={runTestConnection}
          type="button"
        >
          <FlaskConical className="h-4 w-4" />
          {testButtonLabel}
        </button>
        <button
          aria-label="Usar modo simulado"
          className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
          disabled={busyAction !== null}
          onClick={useLocalSimulated}
          type="button"
        >
          <RotateCcw className="h-4 w-4" />
          Usar modo simulado
        </button>
      </div>

      {message ? (
        <p className="mt-3 text-sm text-white/65">{message}</p>
      ) : null}
    </section>
  );
}
