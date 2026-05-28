import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Download,
  FlaskConical,
  Play,
  RefreshCcw,
  RotateCcw,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { AgentBackendSetupPanel } from "./AgentBackendSetupPanel";
import type { createAgentAdminClient } from "../lib/agent-admin-client";
import type { AgentAdminStatus, AgentConfirmation, AgentPolicyRule } from "../lib/system-types";

type AgentAdminClient = ReturnType<typeof createAgentAdminClient>;

type AgentAdminPanelProps = {
  client: AgentAdminClient;
};

function formatHeartbeat(timestamp: string | null): string {
  if (!timestamp) {
    return "sin heartbeat";
  }

  const ageMs = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return timestamp;
  }

  return `${Math.round(ageMs / 1000)}s`;
}

export function AgentAdminPanel({ client }: AgentAdminPanelProps) {
  const [status, setStatus] = useState<AgentAdminStatus | null>(null);
  const [policyRules, setPolicyRules] = useState<AgentPolicyRule[]>([]);
  const [confirmations, setConfirmations] = useState<AgentConfirmation[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [shellCommand, setShellCommand] = useState("pwd && id");
  const [shellOutput, setShellOutput] = useState("");
  const [shellRunning, setShellRunning] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, policy, pending] = await Promise.all([
        client.getStatus(),
        client.getPolicy(),
        client.listConfirmations(),
      ]);
      setStatus(nextStatus);
      setPolicyRules(Array.isArray(policy) ? policy : policy.rules);
      setConfirmations(pending);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "No se pudo leer el backend.");
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pendingConfirmations = useMemo(
    () => confirmations.filter((confirmation) => confirmation.status === "pending"),
    [confirmations],
  );

  async function runAction(action: () => Promise<{ ok?: boolean; message?: string }>, fallback: string) {
    try {
      const response = await action();
      setMessage(response.message ?? fallback);
      setError(null);
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "No se pudo completar la accion.");
    }
  }

  async function runShell() {
    const command = shellCommand.trim();
    if (!command) {
      setError("Escribe un comando.");
      return;
    }

    setShellRunning(true);
    try {
      const response = await client.executeShell(command);
      const blocks = [
        `$ ${response.command}`,
        response.stdout.trim() ? response.stdout.trim() : "",
        response.stderr.trim() ? response.stderr.trim() : "",
        `[exit ${response.exitCode ?? "signal"}${response.timedOut ? " timeout" : ""}] ${response.message ?? ""}`.trim(),
      ].filter(Boolean);
      setShellOutput(blocks.join("\n"));
      setMessage(response.message ?? "Comando completado.");
      setError(response.ok ? null : response.message ?? "El comando fallo.");
    } catch (shellError) {
      setError(shellError instanceof Error ? shellError.message : "No se pudo ejecutar el comando.");
    } finally {
      setShellRunning(false);
    }
  }

  if (!status) {
    return (
      <section className="glass-panel p-6 text-left">
        <button className="btn-secondary inline-flex items-center gap-2" onClick={refresh} type="button">
          <RefreshCcw className="h-4 w-4" />
          Cargar backend
        </button>
        {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="glass-panel grid w-full gap-5 p-5 text-left sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/35">
            Agent Backend
          </p>
          <h2 className="mt-2 text-2xl font-medium text-white">{status.worker.mode}</h2>
          <p className="mt-1 text-sm text-white/55">
            {status.worker.serviceActive ? "Servicio activo" : "Servicio inactivo"} / version {status.worker.version}
          </p>
          <p className="sr-only">{status.worker.serviceActive ? "Servicio activo" : "Servicio inactivo"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button aria-label="Refrescar backend" className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm" onClick={refresh} type="button">
            <RefreshCcw className="h-4 w-4" />
            Refrescar
          </button>
          <button aria-label="Reiniciar servicio" className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm" onClick={() => void runAction(client.restart, "Servicio reiniciado.")} type="button">
            <RotateCcw className="h-4 w-4" />
            Reiniciar servicio
          </button>
          <button aria-label="Probar conexion" className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm" onClick={() => void runAction(client.testConnection, "Conexion probada.")} type="button">
            <FlaskConical className="h-4 w-4" />
            Probar conexion
          </button>
          <button aria-label="Exportar diagnostico" className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm" onClick={() => void runAction(client.exportDiagnostics, "Diagnostico exportado.")} type="button">
            <Download className="h-4 w-4" />
            Exportar diagnostico
          </button>
        </div>
      </div>

      {status.readiness !== "ready" ? (
        <AgentBackendSetupPanel
          client={client}
          readiness={status.readiness}
          setupItems={status.setupItems}
          lastErrorCorrelationId={status.worker.lastErrorCorrelationId}
          testButtonLabel="Probar setup"
        />
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-white/8 bg-black/20 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">Cola</p>
          <p className="mt-2 text-xl text-white">{status.worker.queueDepth}</p>
          <p className="mt-1 text-xs text-white/45">heartbeat {formatHeartbeat(status.worker.lastHeartbeatAt)}</p>
        </div>
        <div className="rounded-lg border border-white/8 bg-black/20 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">Provider</p>
          <p className="mt-2 text-sm text-white">{status.config.provider} / {status.config.model}</p>
          <p className="mt-1 text-xs text-white/45">
            auth {status.config.apiAuth.type === "env" ? `${status.config.apiAuth.envVar}: ${status.config.apiAuth.configured ? "configurada" : "pendiente"}` : "none"}
          </p>
        </div>
        <div className="rounded-lg border border-white/8 bg-black/20 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">Canales</p>
          <p className="mt-2 text-sm text-white">
            email {status.config.channels.email ? "on" : "off"} / telegram {status.config.channels.telegram ? "on" : "off"} / whatsapp {status.config.channels.whatsapp ? "on" : "off"}
          </p>
          <p className="mt-1 text-xs text-white/45">memoria {status.config.policyDefaults.memoryWrite}, envio {status.config.policyDefaults.outboundSend}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
        <div className="rounded-lg border border-white/8 bg-black/20 p-4">
          <label className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/35" htmlFor="agent-state-dir">
            State dir
          </label>
          <input aria-label="State dir" className="glass-input mt-2" id="agent-state-dir" readOnly value={status.config.stateDir} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-secondary px-3 py-2 text-sm" onClick={() => void runAction(() => client.updateConfig({ mode: "auto" }), "Modo auto solicitado.")} type="button">
              Auto
            </button>
            <button className="btn-secondary px-3 py-2 text-sm" onClick={() => void runAction(() => client.updateConfig({ mode: "local-simulated" }), "Modo simulado solicitado.")} type="button">
              Local simulado
            </button>
          </div>
          {status.worker.lastError ? <p className="mt-3 text-sm text-danger">{status.worker.lastError}</p> : null}
          {status.worker.degradedReason ? <p className="mt-3 text-sm text-accent-light">{status.worker.degradedReason}</p> : null}
        </div>

        <div className="rounded-lg border border-white/8 bg-black/20 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">Tarea</p>
          <input aria-label="Task id" className="glass-input mt-2" onChange={(event) => setSelectedTaskId(event.target.value)} placeholder="task id" value={selectedTaskId} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm" disabled={!selectedTaskId} onClick={() => void runAction(() => client.retryTask(selectedTaskId), "Retry solicitado.")} type="button">
              <RefreshCcw className="h-4 w-4" />
              Reintentar
            </button>
            <button className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm" disabled={!selectedTaskId} onClick={() => void runAction(() => client.clearTask(selectedTaskId), "Tarea limpiada.")} type="button">
              <Trash2 className="h-4 w-4" />
              Limpiar
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-white/8 bg-black/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">Shell local</p>
            <p className="mt-1 text-xs text-white/45">bash access desde el frontend</p>
          </div>
          <button
            aria-label="Ejecutar comando shell"
            className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
            disabled={shellRunning || !shellCommand.trim()}
            onClick={() => void runShell()}
            type="button"
          >
            <Play className="h-4 w-4" />
            {shellRunning ? "Ejecutando" : "Ejecutar"}
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Terminal className="h-4 w-4 text-white/45" />
          <input
            aria-label="Comando shell"
            className="glass-input font-mono"
            onChange={(event) => setShellCommand(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                void runShell();
              }
            }}
            spellCheck={false}
            value={shellCommand}
          />
        </div>
        {shellOutput ? (
          <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-black/35 p-3 font-mono text-xs leading-relaxed text-white/70">
            {shellOutput}
          </pre>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-white/8 bg-black/20 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">Policy rules</p>
          <div className="mt-3 grid gap-2">
            {policyRules.map((rule) => (
              <div className="rounded-md bg-white/[0.03] p-3" key={rule.ruleId}>
                <p className="font-mono text-xs text-white/75">{rule.ruleId}</p>
                <p className="mt-1 text-xs text-white/45">{rule.tool} / {rule.source} / {rule.decision}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-white/8 bg-black/20 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">Confirmaciones</p>
          <div className="mt-3 grid gap-2">
            {pendingConfirmations.length === 0 ? <p className="text-sm text-white/50">Sin confirmaciones pendientes.</p> : null}
            {pendingConfirmations.map((confirmation) => (
              <div className="rounded-md bg-white/[0.03] p-3" key={confirmation.confirmationId}>
                <p className="text-sm text-white/80">{confirmation.summary}</p>
                <p className="mt-1 font-mono text-xs text-white/45">{confirmation.confirmationId}</p>
                <div className="mt-2 flex gap-2">
                  <button aria-label={`Confirmar ${confirmation.confirmationId}`} className="btn-secondary px-3 py-2 text-sm" onClick={() => void runAction(() => client.confirm(confirmation.confirmationId), "Confirmado.")} type="button">
                    <Check className="h-4 w-4" />
                  </button>
                  <button aria-label={`Denegar ${confirmation.confirmationId}`} className="btn-secondary px-3 py-2 text-sm" onClick={() => void runAction(() => client.deny(confirmation.confirmationId), "Denegado.")} type="button">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {message ? <p className="text-sm text-white/65">{message}</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </section>
  );
}
