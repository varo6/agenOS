import { memo, type FormEvent } from "react";
import { ArrowUpRight, Clipboard, ExternalLink, LogOut, RefreshCcw, XCircle } from "lucide-react";

import type { PiAuthState, PiModelId, PiPendingAttempt, PiReasoningLevel } from "../../lib/pi-types";
import { Button, Field, Panel, PanelInset } from "../ui";

export type ConnectionPanelProps = {
  providerName: string;
  modelId: string;
  reasoningLevel?: PiReasoningLevel;
  authState: PiAuthState;
  /** El servicio de Pi responde. */
  ready: boolean;
  /** Hay un turno en curso: conectar ahora lo interrumpiría. */
  busy: boolean;
  pendingAttempt: PiPendingAttempt | null;
  manualCode: string;
  onManualCodeChange: (value: string) => void;
  onSubmitManualCode: () => void;
  onConnect: () => void;
  onCancelAuth: () => void;
  onLogout: () => void;
  onRefresh: () => void;
  onConfigurationChange?: (modelId: PiModelId, reasoningLevel: PiReasoningLevel) => void;
  /**
   * Versión de paso: solo lo necesario para terminar de conectar. Se usa en
   * Inicio, donde este panel baja únicamente cuando hay un código que copiar y
   * ofrecer además "actualizar" o "cerrar sesión" sería abrir caminos que no
   * llevan a ninguna parte.
   */
  compact?: boolean;
};

/** Qué significa el estado de la cuenta, sin jerga de autenticación. */
function describeAuthState(authState: PiAuthState): string {
  switch (authState) {
    case "connected":
      return "Ya puedes hablar con Pi.";
    case "authorizing":
      return "Termina de conectarla en el navegador.";
    case "error":
      return "Algo ha fallado. Vuelve a conectarla.";
    default:
      return "Conecta ChatGPT para empezar.";
  }
}

/**
 * Conexión de la cuenta. En la pantalla principal solo aparece mientras falte
 * algo por hacer; una vez conectada vive en Sistema para no competir con la
 * conversación.
 */
function ConnectionPanelComponent({
  providerName,
  modelId,
  reasoningLevel = "low",
  authState,
  ready,
  busy,
  pendingAttempt,
  manualCode,
  onManualCodeChange,
  onSubmitManualCode,
  onConnect,
  onCancelAuth,
  onLogout,
  onRefresh,
  onConfigurationChange,
  compact = false,
}: ConnectionPanelProps) {
  const connectLabel = authState === "connected" ? "Reconectar ChatGPT" : "Conectar ChatGPT";

  function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmitManualCode();
  }

  return (
    <Panel
      /* Proveedor y modelo son dato de ficha técnica: van al margen, no al título. */
      actions={
        compact ? undefined : (
          <span className="rounded-pill border border-line bg-sunken px-3 py-1.5 font-mono text-xs text-ink-faint">
            {providerName} · {modelId}
          </span>
        )
      }
      className="w-full"
      description={pendingAttempt ? pendingAttempt.instructions : describeAuthState(authState)}
      title="Tu cuenta"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!ready || busy}
          icon={<ArrowUpRight aria-hidden="true" className="h-5 w-5" />}
          loading={authState === "authorizing"}
          onClick={onConnect}
          size="lg"
          variant="primary"
        >
          {connectLabel}
        </Button>

        {pendingAttempt ? (
          <Button
            disabled={!ready}
            icon={<XCircle aria-hidden="true" className="h-5 w-5" />}
            onClick={onCancelAuth}
          >
            Cancelar
          </Button>
        ) : null}

        {compact ? null : (
          <>
            <Button
              disabled={!ready}
              icon={<RefreshCcw aria-hidden="true" className="h-5 w-5" />}
              onClick={onRefresh}
            >
              Actualizar
            </Button>

            <Button
              disabled={!ready || authState === "authorizing"}
              icon={<LogOut aria-hidden="true" className="h-5 w-5" />}
              onClick={onLogout}
              variant="ghost"
            >
              Cerrar sesión
            </Button>
          </>
        )}
      </div>

      {!compact && onConfigurationChange ? (
        <PanelInset className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="eyebrow">Modelo</span>
            <select
              className="field-input"
              disabled={!ready || busy}
              onChange={(event) => onConfigurationChange(event.target.value as PiModelId, reasoningLevel)}
              value={modelId}
            >
              <option value="gpt-5.6-sol">GPT-5.6 Sol</option>
              <option value="gpt-5.6-terra">GPT-5.6 Terra</option>
              <option value="gpt-5.6-luna">GPT-5.6 Luna</option>
              <option value="gpt-5.5">GPT-5.5</option>
            </select>
          </label>
          <label className="flex flex-col gap-2">
            <span className="eyebrow">Razonamiento</span>
            <select
              className="field-input"
              disabled={!ready || busy}
              onChange={(event) => onConfigurationChange(modelId as PiModelId, event.target.value as PiReasoningLevel)}
              value={reasoningLevel}
            >
              <option value="off">Sin razonamiento</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </PanelInset>
      ) : null}

      {pendingAttempt ? (
        pendingAttempt.method === "device" ? (
          /* Los dos pasos van numerados: el código no sirve sin abrir el enlace. */
          <PanelInset className="mt-4 grid gap-5">
            <div>
              <p className="text-base font-semibold text-ink">Paso 1: abre este enlace</p>
              <a
                className="mt-2 inline-flex min-w-0 items-center gap-2 break-all rounded text-base text-accent-light hover:text-ink"
                href={pendingAttempt.url}
                rel="noreferrer"
                target="_blank"
              >
                {pendingAttempt.url}
                <ExternalLink aria-hidden="true" className="h-5 w-5 shrink-0" />
              </a>
            </div>

            <div>
              <p className="text-base font-semibold text-ink">Paso 2: escribe este código</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <code className="rounded-control border border-line bg-canvas px-4 py-3 font-mono text-2xl tracking-[0.18em] text-ink">
                  {pendingAttempt.userCode ?? "Esperando código…"}
                </code>
                <Button
                  disabled={!pendingAttempt.userCode}
                  icon={<Clipboard aria-hidden="true" className="h-5 w-5" />}
                  onClick={() => {
                    if (pendingAttempt.userCode) {
                      void navigator.clipboard?.writeText(pendingAttempt.userCode);
                    }
                  }}
                >
                  Copiar
                </Button>
              </div>
            </div>
          </PanelInset>
        ) : (
          <form className="mt-4 flex flex-col gap-3" onSubmit={handleManualSubmit}>
            <Field
              hint="Copia aquí la dirección que te muestre el navegador."
              label="Pegar el enlace o el código"
              onChange={(event) => onManualCodeChange(event.target.value)}
              placeholder="http://localhost:1455/auth/callback?…"
              value={manualCode}
            />
            <Button className="self-start" type="submit">
              Enviar código
            </Button>
          </form>
        )
      ) : null}
    </Panel>
  );
}

export const ConnectionPanel = memo(ConnectionPanelComponent);
