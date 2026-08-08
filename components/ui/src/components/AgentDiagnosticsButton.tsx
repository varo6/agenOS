import { useMemo, useState } from "react";
import { Clipboard, FileWarning, RefreshCcw, X } from "lucide-react";
import { collectAgentDiagnostics, type AgentDiagnosticCheck, type AgentDiagnosticsReport } from "../lib/agent-diagnostics";
import { Button } from "./ui";

export type AgentDiagnosticsButtonProps = {
  collectDiagnostics?: () => Promise<AgentDiagnosticsReport>;
};

function checksFromReport(report: AgentDiagnosticsReport): AgentDiagnosticCheck[] {
  if (Array.isArray(report.checks)) {
    return report.checks;
  }

  if (Array.isArray(report.http?.probes)) {
    return report.http.probes.map((probe) => ({
      name: typeof probe.name === "string" ? probe.name : "probe",
      ok: probe.ok === true,
      detail: probe.error
        ? String(probe.error)
        : JSON.stringify({
          status: probe.status,
          payload: probe.payload,
        }),
    }));
  }

  return [];
}

function formatCommand(command: unknown): string {
  if (typeof command === "string") {
    return command;
  }

  if (command && typeof command === "object") {
    const record = command as { command?: unknown; args?: unknown };
    if (typeof record.command === "string" && Array.isArray(record.args)) {
      return [record.command, ...record.args.map((arg) => String(arg))].join(" ");
    }
  }

  return JSON.stringify(command);
}

export function AgentDiagnosticsButton({
  collectDiagnostics = collectAgentDiagnostics,
}: AgentDiagnosticsButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<AgentDiagnosticsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reportText = useMemo(() => (report ? JSON.stringify(report, null, 2) : ""), [report]);
  const checks = useMemo(() => (report ? checksFromReport(report) : []), [report]);
  const commands = useMemo(() => (report?.commands ?? []).map(formatCommand), [report]);

  async function loadDiagnostics() {
    setOpen(true);
    setLoading(true);
    setError(null);

    try {
      setReport(await collectDiagnostics());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo leer el informe.");
    } finally {
      setLoading(false);
    }
  }

  async function copyReport() {
    const text = reportText || error || "";
    if (!text) {
      return;
    }

    await globalThis.navigator?.clipboard?.writeText(text);
  }

  return (
    <>
      {/*
       * Herramienta de soporte, no de uso diario: vive en Sistema y se llama
       * por lo que produce ("informe"), no por su nombre de ingeniería.
       */}
      <Button
        icon={<FileWarning aria-hidden="true" className="h-5 w-5" />}
        loading={loading}
        onClick={loadDiagnostics}
      >
        Ver informe técnico
      </Button>

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-canvas/80 px-4 py-20 backdrop-blur-sm">
          <section className="panel grid w-full max-w-3xl gap-5 p-5 text-left sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-medium text-ink">Informe técnico</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  Cópialo y envíaselo a quien te dé soporte.
                </p>
              </div>
              <button
                aria-label="Cerrar informe"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors hover:text-ink"
                onClick={() => setOpen(false)}
                type="button"
              >
                <X aria-hidden="true" className="h-6 w-6" />
              </button>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                icon={<Clipboard aria-hidden="true" className="h-5 w-5" />}
                disabled={!reportText && !error}
                onClick={() => void copyReport()}
                variant="primary"
              >
                Copiar
              </Button>
              <Button
                icon={<RefreshCcw aria-hidden="true" className="h-5 w-5" />}
                onClick={loadDiagnostics}
              >
                Actualizar
              </Button>
            </div>

            {loading ? <p className="text-sm text-ink-muted">Leyendo el estado…</p> : null}

            {error ? (
              <p className="text-sm text-danger">{error}</p>
            ) : null}

            {report ? (
              <>
                <div className="grid gap-2">
                  {checks.map((check) => (
                    <div className="rounded-control border border-line bg-sunken p-3" key={check.name}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-mono text-xs uppercase text-ink-faint">{check.name}</p>
                        <span className={check.ok ? "text-sm text-accent-light" : "text-sm text-danger"}>
                          {check.ok ? "ok" : "error"}
                        </span>
                      </div>
                      <p className="mt-2 break-words font-mono text-xs leading-5 text-ink-muted">{check.detail}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-control border border-line bg-sunken p-3">
                  <p className="font-mono text-xs uppercase text-ink-faint">Comandos útiles</p>
                  <div className="mt-3 grid gap-2">
                    {commands.map((command) => (
                      <code className="block break-all rounded-control bg-surface px-3 py-2 text-xs text-ink-muted" key={command}>
                        {command}
                      </code>
                    ))}
                  </div>
                </div>

                <pre className="max-h-72 overflow-auto rounded-control border border-line bg-sunken p-3 text-xs leading-5 text-ink-muted">
                  {reportText}
                </pre>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
