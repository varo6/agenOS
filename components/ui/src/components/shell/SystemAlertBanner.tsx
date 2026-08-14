import { memo } from "react";
import { ArrowUpRight, RefreshCcw, Settings, Wifi } from "lucide-react";

import type { UserError, UserErrorAction } from "../../lib/user-errors";
import { Alert, Button } from "../ui";

export type SystemAlertBannerProps = {
  alert: UserError;
  onDismiss: () => void;
  onRetry: () => void;
  onReconnect: () => void;
  onCheckNetwork: () => void;
  onOpenSystem: () => void;
};

const ACTION_LABEL: Record<UserErrorAction, string> = {
  retry: "Reintentar",
  reconnect: "Conectar ChatGPT",
  openNetwork: "Comprobar la red",
  openSystem: "Abrir Sistema",
};

function actionIcon(action: UserErrorAction) {
  switch (action) {
    case "reconnect":
      return <ArrowUpRight aria-hidden="true" className="h-4 w-4" />;
    case "openNetwork":
      return <Wifi aria-hidden="true" className="h-4 w-4" />;
    case "openSystem":
      return <Settings aria-hidden="true" className="h-4 w-4" />;
    default:
      return <RefreshCcw aria-hidden="true" className="h-4 w-4" />;
  }
}

/**
 * Aviso de sistema. Cada fallo llega con el botón que lo resuelve: antes se
 * volcaba el mensaje y quedaba a la persona adivinar qué hacer con él.
 *
 * El `role` (alert o status) lo decide el tono dentro de `Alert`, así que un
 * fallo grave se anuncia de inmediato y un aviso menor espera su turno.
 */
function SystemAlertBannerComponent({
  alert,
  onDismiss,
  onRetry,
  onReconnect,
  onCheckNetwork,
  onOpenSystem,
}: SystemAlertBannerProps) {
  function runAction() {
    switch (alert.action) {
      case "reconnect":
        onReconnect();
        return;
      case "openNetwork":
        onCheckNetwork();
        return;
      case "openSystem":
        onOpenSystem();
        return;
      default:
        onRetry();
    }
  }

  return (
    /* Sin puntero salvo en el propio aviso: no debe robar clics a la pantalla. */
    <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4">
      <Alert
        actions={
          <Button icon={actionIcon(alert.action)} onClick={runAction} size="sm">
            {ACTION_LABEL[alert.action]}
          </Button>
        }
        className="pointer-events-auto w-full max-w-2xl"
        details={alert.details}
        onDismiss={onDismiss}
        title={alert.title}
        tone={alert.tone}
      >
        {alert.hint}
      </Alert>
    </div>
  );
}

export const SystemAlertBanner = memo(SystemAlertBannerComponent);
