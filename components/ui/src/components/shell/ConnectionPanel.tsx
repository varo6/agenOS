import { memo, type FormEvent } from "react";
import { ArrowUpRight, Clipboard, ExternalLink, LogOut, RefreshCcw, XCircle } from "lucide-react";

import type { PiAuthState, PiPendingAttempt } from "../../lib/pi-types";
import { Button, Field, Panel, PanelInset } from "../ui";

export type ConnectionPanelProps = {
  providerName: string;
  modelId: string;
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
};

/** Qué significa el estado de la cuenta, sin jerga de autenticación. */
function describeAuthState(authState: PiAuthState): string {
  switch (authState) {
    case "connected":
      return "Tu cuenta está lista: ya puedes hablar con Pi.";
    case "authorizing":
      return "Termina el inicio de sesión en el navegador o pega aquí el código.";
    case "error":
      return "La conexión con tu cuenta necesita atención.";
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
}: ConnectionPanelProps) {
  const connectLabel = authState === "connected" ? "Reconectar ChatGPT" : "Conectar ChatGPT";

  function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmitManualCode();
  }

  return (
    <Panel
      actions={
        <span className="rounded-pill border border-line bg-sunken px-3 py-1 font-mono text-[11px] text-ink-faint">
          {modelId}
        </span>
      }
      className="w-full"
      description={pendingAttempt ? pendingAttempt.instructions : describeAuthState(authState)}
      eyebrow="Tu cuenta"
      title={providerName}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!ready || busy}
          icon={<ArrowUpRight aria-hidden="true" className="h-4 w-4" />}
          loading={authState === "authorizing"}
          onClick={onConnect}
          variant="primary"
        >
          {connectLabel}
        </Button>

        {pendingAttempt ? (
          <Button
            disabled={!ready}
            icon={<XCircle aria-hidden="true" className="h-4 w-4" />}
            onClick={onCancelAuth}
          >
            Cancelar login
          </Button>
        ) : null}

        <Button
          disabled={!ready}
          icon={<RefreshCcw aria-hidden="true" className="h-4 w-4" />}
          onClick={onRefresh}
        >
          Refrescar estado
        </Button>

        <Button
          disabled={!ready || authState === "authorizing"}
          icon={<LogOut aria-hidden="true" className="h-4 w-4" />}
          onClick={onLogout}
          variant="ghost"
        >
          Cerrar sesión
        </Button>
      </div>

      {pendingAttempt ? (
        pendingAttempt.method === "device" ? (
          /* Los dos pasos van numerados: el código no sirve sin abrir el enlace. */
          <PanelInset className="mt-4 grid gap-4">
            <div>
              <p className="eyebrow">Paso 1: abre este enlace</p>
              <a
                className="mt-2 inline-flex min-w-0 items-center gap-2 break-all rounded text-sm text-accent-light hover:text-ink"
                href={pendingAttempt.url}
                rel="noreferrer"
                target="_blank"
              >
                {pendingAttempt.url}
                <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0" />
              </a>
            </div>

            <div>
              <p className="eyebrow">Paso 2: escribe este código</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <code className="rounded-control border border-line bg-canvas px-3 py-2 font-mono text-lg tracking-[0.18em] text-ink">
                  {pendingAttempt.userCode ?? "Esperando código…"}
                </code>
                <Button
                  disabled={!pendingAttempt.userCode}
                  icon={<Clipboard aria-hidden="true" className="h-4 w-4" />}
                  onClick={() => {
                    if (pendingAttempt.userCode) {
                      void navigator.clipboard?.writeText(pendingAttempt.userCode);
                    }
                  }}
                  size="sm"
                >
                  Copiar
                </Button>
              </div>
            </div>
          </PanelInset>
        ) : (
          <form className="mt-4 flex flex-col gap-3" onSubmit={handleManualSubmit}>
            <Field
              hint="Si el navegador no vuelve solo, copia aquí la dirección a la que te ha llevado."
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
