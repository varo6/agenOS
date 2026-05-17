import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import type { PiAuthState } from "../lib/pi-types";
import type { AgentAdminStatus } from "../lib/system-types";

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

function toneClasses(tone: HealthTone): string {
  switch (tone) {
    case "ok":
      return "border-accent/35 bg-accent/10 text-accent-light";
    case "warning":
      return "border-accent-light/35 bg-accent-light/10 text-accent-light";
    case "error":
      return "border-danger/40 bg-danger/10 text-danger";
    default:
      return "border-white/12 bg-white/[0.04] text-white/55";
  }
}

function ToneIcon({ tone }: { tone: HealthTone }) {
  if (tone === "ok") {
    return <CheckCircle2 className="h-4 w-4" />;
  }
  if (tone === "warning") {
    return <AlertTriangle className="h-4 w-4" />;
  }
  if (tone === "error") {
    return <XCircle className="h-4 w-4" />;
  }
  return <CircleDashed className="h-4 w-4" />;
}

function backendItem(harnessAvailable: boolean, backendError: string | null): HealthItem {
  if (!harnessAvailable || backendError) {
    return {
      id: "backend",
      label: "Backend",
      tone: "error",
      status: "No responde",
      detail: backendError ?? "El broker local no esta disponible.",
    };
  }

  return {
    id: "backend",
    label: "Backend",
    tone: "ok",
    status: "Broker local disponible",
    detail: "La UI puede hablar con el servicio local.",
  };
}

function workerItem(adminStatus: AgentAdminStatus | null, backendError: string | null): HealthItem {
  if (backendError) {
    return {
      id: "worker",
      label: "Worker",
      tone: "pending",
      status: "Sin lectura",
      detail: "Primero hay que recuperar el backend.",
    };
  }

  if (!adminStatus) {
    return {
      id: "worker",
      label: "Worker",
      tone: "pending",
      status: "Leyendo estado",
      detail: "Esperando respuesta del backend.",
    };
  }

  if (!adminStatus.worker.serviceActive || adminStatus.readiness === "needs_setup") {
    return {
      id: "worker",
      label: "Worker",
      tone: adminStatus.worker.serviceActive ? "warning" : "error",
      status: adminStatus.worker.serviceActive ? "Setup requerido" : "Servicio inactivo",
      detail: adminStatus.setupItems[0]?.label ?? "Revisa la configuracion del backend.",
    };
  }

  if (adminStatus.readiness === "degraded") {
    return {
      id: "worker",
      label: "Worker",
      tone: "warning",
      status: "Modo degradado",
      detail: adminStatus.worker.degradedReason ?? adminStatus.worker.lastError ?? "El worker esta usable, pero necesita revision.",
    };
  }

  return {
    id: "worker",
    label: "Worker",
    tone: "ok",
    status: "Worker listo",
    detail: `${adminStatus.worker.mode} / cola ${adminStatus.worker.queueDepth}`,
  };
}

function authItem(authState: PiAuthState): HealthItem {
  if (authState === "connected") {
    return {
      id: "auth",
      label: "Codex/Auth",
      tone: "ok",
      status: "Conectado",
      detail: "ChatGPT/Codex esta listo para recibir mensajes.",
    };
  }

  if (authState === "authorizing") {
    return {
      id: "auth",
      label: "Codex/Auth",
      tone: "warning",
      status: "Login en curso",
      detail: "Termina el flujo en navegador o codigo.",
    };
  }

  if (authState === "error") {
    return {
      id: "auth",
      label: "Codex/Auth",
      tone: "error",
      status: "Requiere atencion",
      detail: "Reintenta el login o refresca el estado.",
    };
  }

  return {
    id: "auth",
    label: "Codex/Auth",
    tone: "pending",
    status: "Conecta ChatGPT",
    detail: "Falta iniciar sesion para usar el chat.",
  };
}

function supportItem(harnessAvailable: boolean, backendError: string | null): HealthItem {
  if (!harnessAvailable || backendError) {
    return {
      id: "support",
      label: "Soporte",
      tone: "warning",
      status: "Diagnostico limitado",
      detail: "El boton Diagnostico aun puede copiar contexto del navegador.",
    };
  }

  return {
    id: "support",
    label: "Soporte",
    tone: "ok",
    status: "Diagnostico listo",
    detail: "El bundle de soporte se puede copiar desde la esquina superior.",
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
    <section aria-label="Salud del agente" className="glass-panel w-full p-5 text-left">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase text-white/35">Salud del agente</p>
          <h2 className="mt-2 text-xl font-medium text-white">Checklist operativo</h2>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <div className="rounded-lg border border-white/8 bg-black/20 p-3" key={item.id}>
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 rounded-md border p-1 ${toneClasses(item.tone)}`}>
                <ToneIcon tone={item.tone} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">{item.label}</p>
                <p className="mt-1 text-sm text-white/75">{item.status}</p>
                <p className="mt-1 break-words text-xs leading-5 text-white/45">{item.detail}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
