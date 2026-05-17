import { ArrowUpRight, CheckCircle2, RefreshCcw, Settings, Wrench } from "lucide-react";
import type { PiAuthState } from "../lib/pi-types";
import type { AgentAdminStatus } from "../lib/system-types";

type OnboardingStep = {
  title: string;
  detail: string;
  primary: {
    label: string;
    action: "refresh" | "backend" | "connect";
  };
  secondary?: {
    label: string;
    action: "refresh" | "backend" | "connect";
  };
  tone: "ready" | "work" | "error";
};

export type AgentOnboardingPanelProps = {
  adminStatus: AgentAdminStatus | null;
  authState: PiAuthState;
  backendError: string | null;
  harnessAvailable: boolean;
  onConnectCodex: () => void;
  onOpenBackend: () => void;
  onRefresh: () => void;
};

function chooseStep({
  adminStatus,
  authState,
  backendError,
  harnessAvailable,
}: Pick<AgentOnboardingPanelProps, "adminStatus" | "authState" | "backendError" | "harnessAvailable">): OnboardingStep {
  if (!harnessAvailable || backendError) {
    return {
      title: "Backend no disponible",
      detail: backendError ?? "El servicio local del agente no responde. Refresca la salud o abre Backend para revisar el servicio.",
      primary: { label: "Refrescar salud", action: "refresh" },
      secondary: { label: "Abrir Backend", action: "backend" },
      tone: "error",
    };
  }

  if (!adminStatus) {
    return {
      title: "Leyendo backend",
      detail: "Estoy cargando el estado del broker y del worker.",
      primary: { label: "Refrescar salud", action: "refresh" },
      secondary: { label: "Abrir Backend", action: "backend" },
      tone: "work",
    };
  }

  if (adminStatus.readiness === "needs_setup") {
    return {
      title: "Setup del agente",
      detail: adminStatus.setupItems[0]?.label ?? "Completa la configuracion del provider antes de usar el agente real.",
      primary: { label: "Abrir Backend", action: "backend" },
      secondary: { label: "Refrescar salud", action: "refresh" },
      tone: "work",
    };
  }

  if (adminStatus.readiness === "degraded") {
    return {
      title: "Backend en modo degradado",
      detail: adminStatus.worker.degradedReason ?? adminStatus.worker.lastError ?? "El agente puede estar usable, pero conviene revisar el worker.",
      primary: { label: "Abrir Backend", action: "backend" },
      secondary: { label: "Refrescar salud", action: "refresh" },
      tone: "work",
    };
  }

  if (authState === "authorizing") {
    return {
      title: "Completa el login de Codex",
      detail: "Termina el flujo de navegador o pega el codigo manual si el callback no vuelve solo.",
      primary: { label: "Refrescar salud", action: "refresh" },
      secondary: { label: "Abrir Backend", action: "backend" },
      tone: "work",
    };
  }

  if (authState !== "connected") {
    return {
      title: "Conecta ChatGPT/Codex",
      detail: "El backend esta listo. Solo falta iniciar sesion para activar el chat y el micro.",
      primary: { label: "Conectar ahora", action: "connect" },
      secondary: { label: "Abrir Backend", action: "backend" },
      tone: "work",
    };
  }

  return {
    title: "Agente listo",
    detail: "Backend, worker y login local estan disponibles. Ya puedes escribir o usar el micro.",
    primary: { label: "Refrescar salud", action: "refresh" },
    secondary: { label: "Abrir Backend", action: "backend" },
    tone: "ready",
  };
}

function iconForTone(tone: OnboardingStep["tone"]) {
  if (tone === "ready") {
    return <CheckCircle2 className="h-5 w-5 text-accent-light" />;
  }
  if (tone === "error") {
    return <Wrench className="h-5 w-5 text-danger" />;
  }
  return <Settings className="h-5 w-5 text-accent-light" />;
}

export function AgentOnboardingPanel(props: AgentOnboardingPanelProps) {
  const step = chooseStep(props);
  const runAction = (action: OnboardingStep["primary"]["action"]) => {
    if (action === "refresh") {
      props.onRefresh();
    } else if (action === "backend") {
      props.onOpenBackend();
    } else {
      props.onConnectCodex();
    }
  };

  return (
    <section className="glass-panel w-full p-5 text-left">
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="rounded-lg border border-white/10 bg-black/25 p-3">
            {iconForTone(step.tone)}
          </div>
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase text-white/35">Siguiente paso</p>
            <h2 className="mt-2 text-2xl font-medium text-white">{step.title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">{step.detail}</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            aria-label={step.primary.label}
            className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
            onClick={() => runAction(step.primary.action)}
            type="button"
          >
            {step.primary.action === "refresh" ? <RefreshCcw className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
            {step.primary.label}
          </button>
          {step.secondary ? (
            <button
              aria-label={step.secondary.label}
              className="btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm"
              onClick={() => runAction(step.secondary!.action)}
              type="button"
            >
              {step.secondary.action === "refresh" ? <RefreshCcw className="h-4 w-4" /> : <Settings className="h-4 w-4" />}
              {step.secondary.label}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
