import { useState } from "react";
import { FlaskConical, KeyRound, Play, RotateCcw, Send, Wrench } from "lucide-react";
import type { AgentActionResponse, AgentAdminStatus } from "../lib/system-types";

type SetupClient = {
  updateConfig(patch: { mode: "local-simulated" }): Promise<AgentActionResponse>;
  testConnection(): Promise<AgentActionResponse>;
  rerunSetup(): Promise<AgentActionResponse>;
  startBackendCodexLogin(): Promise<AgentActionResponse & { command?: string[] }>;
  configureTelegram(token: string): Promise<AgentActionResponse>;
  testTelegram(): Promise<AgentActionResponse>;
  enableTelegram(): Promise<AgentActionResponse>;
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
  const [telegramToken, setTelegramToken] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function runPanelAction(action: string, callback: () => Promise<AgentActionResponse>, fallback: string) {
    setBusyAction(action);
    try {
      const response = await callback();
      setMessage(response.message ?? fallback);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo completar la accion.");
    } finally {
      setBusyAction(null);
    }
  }

  async function runTestConnection() {
    await runPanelAction("test", client.testConnection, "Conexion correcta.");
  }

  async function useLocalSimulated() {
    await runPanelAction("simulate", () => client.updateConfig({ mode: "local-simulated" }), "Modo simulado activado.");
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
          aria-label="Reejecutar setup"
          className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
          disabled={busyAction === "rerun"}
          onClick={() => void runPanelAction("rerun", client.rerunSetup, "Setup reejecutado.")}
          type="button"
        >
          <Wrench className="h-4 w-4" />
          Reejecutar setup
        </button>
        {setupItems.some((item) => item.action === "connect_backend_codex") ? (
          <button
            aria-label="Conectar Codex backend"
            className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
            disabled={busyAction === "codex"}
            onClick={() => void runPanelAction("codex", client.startBackendCodexLogin, "Login de Codex backend iniciado.")}
            type="button"
          >
            <KeyRound className="h-4 w-4" />
            Conectar Codex backend
          </button>
        ) : null}
        <button
          aria-label={testButtonLabel}
          className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
          disabled={busyAction === "test"}
          onClick={runTestConnection}
          type="button"
        >
          <FlaskConical className="h-4 w-4" />
          {testButtonLabel}
        </button>
        <button
          aria-label="Usar modo simulado"
          className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
          disabled={busyAction === "simulate"}
          onClick={useLocalSimulated}
          type="button"
        >
          <RotateCcw className="h-4 w-4" />
          Usar modo simulado
        </button>
      </div>

      {setupItems.some((item) => item.action === "configure_telegram" || item.action === "test_telegram" || item.action === "enable_telegram") ? (
        <div className="mt-4 rounded-md border border-white/8 bg-white/[0.03] p-3">
          <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35" htmlFor="telegram-token">
            Telegram bot token
          </label>
          <input
            className="glass-input mt-2"
            id="telegram-token"
            onChange={(event) => setTelegramToken(event.target.value)}
            placeholder="123456:token de BotFather"
            type="password"
            value={telegramToken}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              aria-label="Guardar Telegram"
              className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
              disabled={busyAction === "telegram-configure" || !telegramToken.trim()}
              onClick={() => void runPanelAction("telegram-configure", () => client.configureTelegram(telegramToken), "Token de Telegram guardado.")}
              type="button"
            >
              <Send className="h-4 w-4" />
              Guardar Telegram
            </button>
            <button
              aria-label="Probar Telegram"
              className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
              disabled={busyAction === "telegram-test"}
              onClick={() => void runPanelAction("telegram-test", client.testTelegram, "Telegram probado.")}
              type="button"
            >
              <FlaskConical className="h-4 w-4" />
              Probar Telegram
            </button>
            <button
              aria-label="Activar Telegram"
              className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
              disabled={busyAction === "telegram-enable"}
              onClick={() => void runPanelAction("telegram-enable", client.enableTelegram, "Telegram activado.")}
              type="button"
            >
              <Play className="h-4 w-4" />
              Activar Telegram
            </button>
          </div>
        </div>
      ) : null}

      {message ? (
        <p className="mt-3 text-sm text-white/65">{message}</p>
      ) : null}
    </section>
  );
}
