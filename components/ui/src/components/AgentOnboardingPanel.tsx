import { ArrowUpRight, CheckCircle2, RefreshCcw, Settings, Wrench } from "lucide-react";
import { cx } from "../lib/cx";
import type { PiAuthState } from "../lib/pi-types";
import type { AgentAdminStatus } from "../lib/system-types";
import { Button, Panel, TONE_SURFACE, type Tone } from "./ui";

type OnboardingStep = {
  title: string;
  detail: string;
  primary: {
    label: string;
    action: "refresh" | "system" | "connect";
  };
  secondary?: {
    label: string;
    action: "refresh" | "system" | "connect";
  };
  tone: "ready" | "work" | "error";
};

export type AgentOnboardingPanelProps = {
  adminStatus: AgentAdminStatus | null;
  authState: PiAuthState;
  backendError: string | null;
  harnessAvailable: boolean;
  onConnectCodex: () => void;
  onOpenSystem: () => void;
  onRefresh: () => void;
};

function chooseStep({
  adminStatus,
  authState,
  backendError,
  harnessAvailable,
}: Pick<AgentOnboardingPanelProps, "adminStatus" | "authState" | "backendError" | "harnessAvailable">): OnboardingStep {
  /*
   * Nada de lo que sale de aquí nombra piezas internas. El mensaje de error
   * crudo del servicio (`backendError`, `degradedReason`, los `setupItems` en
   * inglés) se queda fuera a propósito: no le dice nada a quien usa el equipo
   * y sigue disponible en Sistema para quien tenga que arreglarlo.
   */
  if (!harnessAvailable || backendError) {
    return {
      title: "Pi no está disponible",
      detail: "Espera unos segundos y vuelve a intentarlo.",
      primary: { label: "Reintentar", action: "refresh" },
      secondary: { label: "Abrir Sistema", action: "system" },
      tone: "error",
    };
  }

  if (!adminStatus) {
    return {
      title: "Un momento",
      detail: "Estoy comprobando que todo esté listo.",
      primary: { label: "Reintentar", action: "refresh" },
      tone: "work",
    };
  }

  if (adminStatus.readiness === "needs_setup") {
    return {
      title: "Falta terminar la configuración",
      detail: "Ábrela en Sistema y lo dejamos listo.",
      primary: { label: "Abrir Sistema", action: "system" },
      tone: "work",
    };
  }

  if (adminStatus.readiness === "degraded") {
    return {
      title: "Pi funciona a medias",
      detail: "Puedes usarlo, pero conviene revisarlo.",
      primary: { label: "Abrir Sistema", action: "system" },
      tone: "work",
    };
  }

  if (authState === "authorizing") {
    return {
      title: "Termina de conectar tu cuenta",
      detail: "Abre el enlace y escribe el código.",
      primary: { label: "Reintentar", action: "refresh" },
      tone: "work",
    };
  }

  if (authState !== "connected") {
    return {
      title: "Conecta tu cuenta",
      detail: "Es el último paso para poder hablar con Pi.",
      primary: { label: "Conectar", action: "connect" },
      tone: "work",
    };
  }

  return {
    title: "Todo listo",
    detail: "Ya puedes hablar con Pi.",
    primary: { label: "Reintentar", action: "refresh" },
    tone: "ready",
  };
}

const STEP_TONE: Record<OnboardingStep["tone"], Tone> = {
  ready: "positive",
  work: "accent",
  error: "danger",
};

function iconForTone(tone: OnboardingStep["tone"]) {
  if (tone === "ready") {
    return <CheckCircle2 aria-hidden="true" className="h-5 w-5" />;
  }
  if (tone === "error") {
    return <Wrench aria-hidden="true" className="h-5 w-5" />;
  }
  return <Settings aria-hidden="true" className="h-5 w-5" />;
}

export function AgentOnboardingPanel(props: AgentOnboardingPanelProps) {
  const step = chooseStep(props);
  const runAction = (action: OnboardingStep["primary"]["action"]) => {
    if (action === "refresh") {
      props.onRefresh();
    } else if (action === "system") {
      props.onOpenSystem();
    } else {
      props.onConnectCodex();
    }
  };

  const actionIcon = (action: OnboardingStep["primary"]["action"]) =>
    action === "refresh" ? (
      <RefreshCcw aria-hidden="true" className="h-4 w-4" />
    ) : action === "system" ? (
      <Settings aria-hidden="true" className="h-4 w-4" />
    ) : (
      <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
    );

  return (
    <Panel
      actions={
        <>
          <Button
            icon={actionIcon(step.primary.action)}
            onClick={() => runAction(step.primary.action)}
            variant="primary"
          >
            {step.primary.label}
          </Button>
          {step.secondary ? (
            <Button
              icon={actionIcon(step.secondary.action)}
              onClick={() => runAction(step.secondary!.action)}
            >
              {step.secondary.label}
            </Button>
          ) : null}
        </>
      }
      className="w-full"
      description={step.detail}
      eyebrow="Siguiente paso"
      title={
        <span className="flex items-center gap-3">
          <span className={cx("rounded-control border p-2", TONE_SURFACE[STEP_TONE[step.tone]])}>
            {iconForTone(step.tone)}
          </span>
          {step.title}
        </span>
      }
    />
  );
}
