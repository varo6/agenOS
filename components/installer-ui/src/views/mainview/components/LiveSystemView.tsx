import { LoaderCircle, Mic, TerminalSquare } from "lucide-react";

export function LiveSystemView({
  commandDraft,
  isInstalled,
  isSwitching,
  lastActionLabel,
  lastCommandOrigin,
  lastIntentLabel,
  lastResultMessage,
  lastTranscript,
  onOpenInstaller,
  onStartVoiceCapture,
  onSubmitCommand,
  onUpdateCommandDraft,
  voiceState,
}: {
  commandDraft: string;
  isInstalled: boolean;
  isSwitching: boolean;
  lastActionLabel: string | null;
  lastCommandOrigin: "voice" | "text" | null;
  lastIntentLabel: string | null;
  lastResultMessage: string | null;
  lastTranscript: string;
  onOpenInstaller?: () => void;
  onStartVoiceCapture: () => void;
  onSubmitCommand: () => void;
  onUpdateCommandDraft: (value: string) => void;
  voiceState: "idle" | "listening" | "processing" | "error";
}) {
  const isBusy = isSwitching || voiceState === "listening" || voiceState === "processing";
  const statusCopy = {
    idle: "Listo para recibir un comando por texto o activar el micro simulado.",
    listening: "Escuchando la demo local antes de resolver la intención mínima.",
    processing: "Interpretando el comando y lanzando la acción real contra el backend local.",
    error: "El último intento no se pudo interpretar o ejecutar.",
  } as const;

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-24">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(255,216,140,0.14),transparent_18%),radial-gradient(circle_at_50%_58%,rgba(123,191,255,0.10),transparent_22%)]" />

      <section className="relative flex w-full max-w-5xl flex-col items-center gap-8 text-center">
        <div className="space-y-4">
          <p className="text-xs uppercase tracking-[0.42em] text-white/48">
            {isInstalled ? "Installed System" : "Live System"}
          </p>
          <h1 className="font-display text-5xl tracking-tight text-white sm:text-6xl">
            AgenOS
          </h1>
          <p className="mx-auto max-w-xl text-base text-white/60 sm:text-lg">
            Primera vertical slice del sistema principal: un micro demo, un comando
            de texto y una única acción real para abrir el terminal de mantenimiento.
          </p>
        </div>

        <div className="flex flex-col items-center gap-4">
          <div className="glass-panel inline-flex items-center gap-3 rounded-full px-4 py-2 text-sm text-white/72">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-accent)]" />
            <span className="font-mono uppercase tracking-[0.22em]">
              Estado: {voiceState}
            </span>
          </div>

          <div className="relative">
            <div className="absolute inset-[-36px] rounded-full bg-[radial-gradient(circle,rgba(244,171,57,0.26),transparent_62%)] blur-2xl" />
            <button
              aria-label="Activar micro"
              className="glass-panel animate-float relative flex h-48 w-48 items-center justify-center rounded-full border border-white/14 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60 sm:h-56 sm:w-56"
              disabled={isBusy}
              onClick={onStartVoiceCapture}
              type="button"
            >
              <div className="animate-pulse-glow flex h-28 w-28 items-center justify-center rounded-full bg-[linear-gradient(135deg,rgba(255,232,187,0.98),rgba(244,171,57,0.92))] text-[#1f1208] shadow-[0_24px_60px_rgba(244,171,57,0.24)]">
                {voiceState === "processing" ? (
                  <LoaderCircle className="h-12 w-12 animate-spin sm:h-14 sm:w-14" strokeWidth={2.2} />
                ) : (
                  <Mic className="h-12 w-12 sm:h-14 sm:w-14" strokeWidth={2.2} />
                )}
              </div>
            </button>
          </div>
        </div>

        <div className="glass-panel w-full max-w-3xl px-6 py-5 text-sm text-white/62">
          <p>{isSwitching ? "Cambiando al live system..." : statusCopy[voiceState]}</p>
        </div>

        <form
          className="glass-panel flex w-full max-w-3xl flex-col gap-4 px-6 py-6 text-left"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmitCommand();
          }}
        >
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.32em] text-white/45">
            <TerminalSquare className="h-4 w-4" />
            <span>Comando local</span>
          </div>
          <label className="space-y-2">
            <span className="text-sm text-white/68">Comando</span>
            <input
              className="glass-input"
              disabled={isBusy}
              onChange={(event) => onUpdateCommandDraft(event.target.value)}
              placeholder="Escribe: abre terminal de mantenimiento"
              value={commandDraft}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              className="btn-primary"
              disabled={isBusy || !commandDraft.trim()}
              type="submit"
            >
              Enviar comando
            </button>
            <button
              className="btn-secondary"
              disabled={isBusy}
              onClick={onStartVoiceCapture}
              type="button"
            >
              Probar micro demo
            </button>
          </div>
        </form>

        <section className="glass-panel w-full max-w-3xl px-6 py-6 text-left">
          <p className="text-xs uppercase tracking-[0.32em] text-white/45">
            Workflow
          </p>
          <h2 className="mt-2 font-display text-2xl text-white">
            Última ejecución
          </h2>

          {lastCommandOrigin || lastTranscript || lastResultMessage ? (
            <dl className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-[0.28em] text-white/38">Origen</dt>
                <dd className="mt-2 text-base text-white/78">
                  {lastCommandOrigin === "voice"
                    ? "voz simulada"
                    : lastCommandOrigin === "text"
                      ? "texto"
                      : "sin datos"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.28em] text-white/38">Comando recibido</dt>
                <dd className="mt-2 text-base text-white/78">
                  {lastTranscript || "Sin entrada todavía."}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.28em] text-white/38">Intención interpretada</dt>
                <dd className="mt-2 text-base text-white/78">
                  {lastIntentLabel ?? "Sin intención resuelta."}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.28em] text-white/38">Acción ejecutada</dt>
                <dd className="mt-2 font-mono text-base text-white/78">
                  {lastActionLabel ?? "Sin acción ejecutada."}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-[0.28em] text-white/38">Resultado final</dt>
                <dd
                  aria-live="polite"
                  className={`mt-2 text-base ${
                    voiceState === "error" ? "text-danger" : "text-white/78"
                  }`}
                >
                  {lastResultMessage ?? "Todavía no se ha ejecutado ningún comando."}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-6 text-sm text-white/56">
              Pulsa el micro o escribe un comando soportado para recorrer el flujo
              completo de intención y ejecución.
            </p>
          )}
        </section>

        {onOpenInstaller ? (
          <button
            className="btn-secondary"
            onClick={onOpenInstaller}
            type="button"
          >
            Volver al instalador
          </button>
        ) : null}
      </section>
    </div>
  );
}
