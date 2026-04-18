import type { ReactNode } from "react";

import type { StepId } from "../../shared/installer-types";
import { NavigationBar } from "../mainview/components/NavigationBar";
import { SlideContainer } from "../mainview/components/SlideContainer";

type InstallerShellProps = {
  activeSlide: ReactNode;
  busy: boolean;
  canGoBack: boolean;
  canGoNext: boolean;
  currentStep: StepId;
  direction: number;
  nextLabel: string;
  onBack: () => void;
  onClassicLaunch: () => void;
  onNext: () => void;
};

export function InstallerShell({
  activeSlide,
  busy,
  canGoBack,
  canGoNext,
  currentStep,
  direction,
  nextLabel,
  onBack,
  onClassicLaunch,
  onNext,
}: InstallerShellProps) {
  return (
    <div className="relative z-10 flex min-h-screen flex-col">
      <header className="px-6 pt-20">
        <div className="glass-panel mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="brand-mark">A</div>
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-amber-100/60">
                AgenOS
              </p>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
                Instalador de AgenOS
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right text-sm text-white/45 lg:block">
              <p>Preparacion guiada con traspaso final a Calamares.</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 px-6 pb-4 pt-4">
        <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1">
          <SlideContainer direction={direction} step={currentStep}>
            {activeSlide}
          </SlideContainer>
        </div>
      </main>

      {currentStep !== "handoff" ? (
        <NavigationBar
          busy={busy}
          canGoBack={canGoBack}
          canGoNext={canGoNext}
          currentStep={currentStep}
          nextLabel={nextLabel}
          onBack={onBack}
          onClassicLaunch={onClassicLaunch}
          onNext={onNext}
        />
      ) : null}
    </div>
  );
}
