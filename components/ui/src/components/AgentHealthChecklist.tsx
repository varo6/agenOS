import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { cx } from "../lib/cx";
import type { PiAuthState } from "../lib/pi-types";
import type { AgentAdminStatus } from "../lib/system-types";
import { Panel, PanelInset, TONE_SURFACE, type Tone } from "./ui";

type HealthTone = "ok" | "warning" | "error" | "pending";

type HealthItem = {
  id: string;
  label: string;
  tone: HealthTone;
  status: string;
  detail: string;
};

export type AgentHealthChecklistProps = {
  adminStatus: AgentAdminStatus | null;
  authState: PiAuthState;
  backendError: string | null;
  harnessAvailable: boolean;
};

/** Cada estado de salud se pinta con el tono compartido del sistema. */
const HEALTH_TONE: Record<HealthTone, Tone> = {
  ok: "positive",
  warning: "warning",
  error: "danger",
  pending: "neutral",
};

function ToneIcon({ tone }: { tone: HealthTone }) {
  if (tone === "ok") {
    return <CheckCircle2 aria-hidden="true" className="h-5 w-5" />;
  }
  if (tone === "warning") {
    return <AlertTriangle aria-hidden="true" className="h-5 w-5" />;
  }
  if (tone === "error") {
    return <XCircle aria-hidden="true" className="h-5 w-5" />;
  }
  return <CircleDashed aria-hidden="true" className="h-5 w-5" />;
}

/*
 * Cada tarjeta se lee en dos niveles: nombre y estado en castellano llano para
 * quien solo quiere saber si va o no va, y una tercera línea con el dato
 * técnico (mensaje del servicio, modo del motor, cola) para quien tenga que
 * arreglarlo o defenderlo. La jerga vive en esa línea, nunca en el titular.
 */
function backendItem(harnessAvailable: boolean, backendError: string | null): HealthItem {
  if (!harnessAvailable || backendError) {
    return {
      id: "backend",
      label: "Servicio de Pi",
      tone: "error",
      status: "No responde",
      detail: backendError ?? "El broker local (127.0.0.1:4173) no está disponible.",
    };
  }

  return {
    id: "backend",
    label: "Servicio de Pi",
    tone: "ok",
    status: "Funcionando",
    detail: "El broker local responde en 127.0.0.1:4173.",
  };
}

function workerItem(adminStatus: AgentAdminStatus | null, backendError: string | null): HealthItem {
  if (backendError) {
    return {
      id: "worker",
      label: "Motor de tareas",
      tone: "pending",
      status: "Sin datos",
      detail: "Primero tiene que volver el servicio de Pi.",
    };
  }

  if (!adminStatus) {
    return {
      id: "worker",
      label: "Motor de tareas",
      tone: "pending",
      status: "Comprobando",
      detail: "Esperando respuesta del servicio.",
    };
  }

  if (!adminStatus.worker.serviceActive || adminStatus.readiness === "needs_setup") {
    return {
      id: "worker",
      label: "Motor de tareas",
      tone: adminStatus.worker.serviceActive ? "warning" : "error",
      status: adminStatus.worker.serviceActive ? "Falta configurarlo" : "Parado",
      detail: adminStatus.setupItems[0]?.label ?? "Revisa la configuración del worker.",
    };
  }

  if (adminStatus.readiness === "degraded") {
    return {
      id: "worker",
      label: "Motor de tareas",
      tone: "warning",
      status: "Funciona a medias",
      detail:
        adminStatus.worker.degradedReason
        ?? adminStatus.worker.lastError
        ?? "El worker responde en modo degradado.",
    };
  }

  return {
    id: "worker",
    label: "Motor de tareas",
    tone: "ok",
    status: "Listo",
    detail: `Modo ${adminStatus.worker.mode}, ${adminStatus.worker.queueDepth} en cola.`,
  };
}

function authItem(authState: PiAuthState): HealthItem {
  if (authState === "connected") {
    return {
      id: "auth",
      label: "Tu cuenta",
      tone: "ok",
      status: "Conectada",
      detail: "ChatGPT puede recibir tus mensajes.",
    };
  }

  if (authState === "authorizing") {
    return {
      id: "auth",
      label: "Tu cuenta",
      tone: "warning",
      status: "Conectando",
      detail: "Falta terminar el inicio de sesión.",
    };
  }

  if (authState === "error") {
    return {
      id: "auth",
      label: "Tu cuenta",
      tone: "error",
      status: "Necesita atención",
      detail: "Vuelve a conectarla desde esta misma pantalla.",
    };
  }

  return {
    id: "auth",
    label: "Tu cuenta",
    tone: "pending",
    status: "Conecta ChatGPT",
    detail: "Sin cuenta conectada Pi no puede responder.",
  };
}

function supportItem(harnessAvailable: boolean, backendError: string | null): HealthItem {
  if (!harnessAvailable || backendError) {
    return {
      id: "support",
      label: "Soporte",
      tone: "warning",
      status: "Informe incompleto",
      detail: "Sin servicio solo se recoge el contexto del navegador.",
    };
  }

  return {
    id: "support",
    label: "Soporte",
    tone: "ok",
    status: "Informe disponible",
    detail: "Puedes copiar el informe técnico para pedir ayuda.",
  };
}

export function AgentHealthChecklist({
  adminStatus,
  authState,
  backendError,
  harnessAvailable,
}: AgentHealthChecklistProps) {
  const items = [
    backendItem(harnessAvailable, backendError),
    workerItem(adminStatus, backendError),
    authItem(authState),
    supportItem(harnessAvailable, backendError),
  ];

  return (
    <Panel ariaLabel="Estado del sistema" className="w-full" title="Estado del sistema">
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <PanelInset className="p-4" key={item.id}>
            <div className="flex items-start gap-3">
              <span className={cx("mt-1 rounded-control border p-1.5", TONE_SURFACE[HEALTH_TONE[item.tone]])}>
                <ToneIcon tone={item.tone} />
              </span>
              <div className="min-w-0">
                <p className="text-base font-semibold text-ink">{item.label}</p>
                <p className="text-sm text-ink-muted">{item.status}</p>
                <p className="mt-1 break-words text-xs text-ink-faint">{item.detail}</p>
              </div>
            </div>
          </PanelInset>
        ))}
      </div>
    </Panel>
  );
}
