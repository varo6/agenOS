import { useMemo, useState } from "react";
import { Clipboard, FileWarning, LoaderCircle, RefreshCcw, X } from "lucide-react";
import { collectAgentDiagnostics, type AgentDiagnosticCheck, type AgentDiagnosticsReport } from "../lib/agent-diagnostics";

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
      setError(loadError instanceof Error ? loadError.message : "No se pudo leer el diagnostico.");
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
      <div className="fixed right-4 top-4 z-50 sm:right-6 sm:top-6">
        <button
          aria-label="Diagnostico"
          className="btn-secondary inline-flex items-center gap-2 bg-black/35 px-3 py-2 text-sm backdrop-blur-md"
          onClick={loadDiagnostics}
          type="button"
        >
          {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileWarning className="h-4 w-4" />}
          Diagnostico
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/55 px-4 py-20 backdrop-blur-sm">
          <section className="glass-panel grid w-full max-w-3xl gap-5 p-5 text-left sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase text-white/35">
                  Produccion
                </p>
                <h2 className="mt-2 text-2xl font-medium text-white">Diagnostico de AgenOS</h2>
              </div>
              <button
                aria-label="Cerrar diagnostico"
                className="rounded-full p-2 text-white/55 transition-colors hover:text-white"
                onClick={() => setOpen(false)}
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm" onClick={loadDiagnostics} type="button">
                <RefreshCcw className="h-4 w-4" />
                Refrescar
              </button>
              <button className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm" disabled={!reportText && !error} onClick={() => void copyReport()} type="button">
                <Clipboard className="h-4 w-4" />
                Copiar
              </button>
            </div>

            {loading ? (
              <p className="text-sm text-white/60">Leyendo estado local...</p>
            ) : null}

            {error ? (
              <p className="text-sm text-danger">{error}</p>
            ) : null}

            {report ? (
              <>
                <div className="grid gap-2">
                  {checks.map((check) => (
                    <div className="rounded-lg border border-white/8 bg-black/20 p-3" key={check.name}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-mono text-xs uppercase text-white/50">{check.name}</p>
                        <span className={check.ok ? "text-sm text-accent-light" : "text-sm text-danger"}>
                          {check.ok ? "ok" : "error"}
                        </span>
                      </div>
                      <p className="mt-2 break-words font-mono text-xs leading-5 text-white/70">{check.detail}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border border-white/8 bg-black/20 p-3">
                  <p className="font-mono text-xs uppercase text-white/50">Comandos utiles</p>
                  <div className="mt-3 grid gap-2">
                    {commands.map((command) => (
                      <code className="block break-all rounded-md bg-white/[0.04] px-3 py-2 text-xs text-white/75" key={command}>
                        {command}
                      </code>
                    ))}
                  </div>
                </div>

                <pre className="max-h-72 overflow-auto rounded-lg border border-white/8 bg-black/30 p-3 text-xs leading-5 text-white/65">
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
