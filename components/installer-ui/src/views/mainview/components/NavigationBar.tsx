import { ChevronLeft, ChevronRight, Terminal } from "lucide-react";

import type { StepId } from "../../../shared/installer-types";

const STEP_LABELS: Array<{ id: StepId; label: string }> = [
  { id: "welcome", label: "Sistema" },
  { id: "language", label: "Idioma" },
  { id: "disk", label: "Disco" },
  { id: "identity", label: "Usuario" },
  { id: "confirm", label: "Confirmar" },
  { id: "handoff", label: "Handoff" },
];

type NavigationBarProps = {
  busy: boolean;
  canGoBack: boolean;
  canGoNext: boolean;
  currentStep: StepId;
  nextLabel: string;
  onBack: () => void;
  onClassicLaunch: () => void;
  onNext: () => void;
};

export function NavigationBar({
  busy,
  canGoBack,
  canGoNext,
  currentStep,
  nextLabel,
  onBack,
  onClassicLaunch,
  onNext,
}: NavigationBarProps) {
  return (
    <div className="relative z-10 px-6 pb-6">
      <div className="glass-panel mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
          {STEP_LABELS.map((item, index) => {
            const currentIndex = STEP_LABELS.findIndex((step) => step.id === currentStep);
            const isCurrent = item.id === currentStep;
            const isComplete = index < currentIndex;

            return (
              <div className="flex items-center gap-2" key={item.id}>
                <div
                  className={[
                    "h-2 rounded-full transition-all duration-300",
                    isCurrent
                      ? "w-9 bg-accent"
                      : isComplete
                        ? "w-2 bg-success"
                        : "w-2 bg-white/15",
                  ].join(" ")}
                />
                {isCurrent ? (
                  <span className="whitespace-nowrap text-xs font-medium uppercase tracking-[0.22em] text-white/60">
                    {item.label}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <button
            className="btn-secondary flex items-center gap-2 px-4 py-3 text-sm"
            disabled={busy}
            onClick={onClassicLaunch}
            type="button"
          >
            <Terminal className="h-4 w-4" />
            <span>Modo clasico</span>
          </button>

          {canGoBack ? (
            <button
              className="btn-secondary flex items-center gap-2 px-4 py-3"
              disabled={busy}
              onClick={onBack}
              type="button"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>Atras</span>
            </button>
          ) : null}

          <button
            className="btn-primary flex items-center gap-2 px-5 py-3"
            disabled={!canGoNext || busy}
            onClick={onNext}
            type="button"
          >
            <span>{nextLabel}</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
