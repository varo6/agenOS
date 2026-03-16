import { useEffect, useMemo, useState } from "react";

import type {
  DiskSummary,
  StepId,
  ValidationResponse,
} from "../../shared/installer-types";
import { installerClient } from "./installer-client";
import { GlobalError } from "./components/GlobalError";
import { LoadingScreen } from "./components/LoadingScreen";
import { NavigationBar } from "./components/NavigationBar";
import { SlideContainer } from "./components/SlideContainer";
import { VideoBackground } from "./components/VideoBackground";
import { mapDiskToCardModel, mapPreflightToWelcomeModel } from "./mappers";
import { ConfirmSlide } from "./slides/ConfirmSlide";
import { DiskSlide } from "./slides/DiskSlide";
import { HandoffSlide } from "./slides/HandoffSlide";
import { IdentitySlide } from "./slides/IdentitySlide";
import { LanguageSlide } from "./slides/LanguageSlide";
import { WelcomeSlide } from "./slides/WelcomeSlide";
import {
  STEP_ORDER,
  mergeNormalizedProfile,
  useInstallerStore,
} from "./store/useInstallerStore";

function nextLabel(step: StepId, busy: boolean): string {
  if (busy) {
    return "Trabajando...";
  }

  if (step === "welcome") {
    return "Empezar";
  }

  if (step === "confirm") {
    return "Abrir Calamares guiado";
  }

  return "Continuar";
}

export default function App() {
  const installer = useInstallerStore();
  const [preflightModel, setPreflightModel] = useState<ReturnType<
    typeof mapPreflightToWelcomeModel
  > | null>(null);
  const [disks, setDisks] = useState<DiskSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  const diskCards = useMemo(() => disks.map(mapDiskToCardModel), [disks]);
  const selectedDisk = useMemo(
    () => diskCards.find((disk) => disk.path === installer.profile.targetDisk) ?? null,
    [diskCards, installer.profile.targetDisk],
  );

  useEffect(() => {
    let active = true;

    async function loadInitialData() {
      setIsLoading(true);
      installer.setGlobalError(null);

      try {
        const [preflight, diskResponse] = await Promise.all([
          installerClient.getPreflight(),
          installerClient.getDisks(),
        ]);

        if (!active) {
          return;
        }

        setPreflightModel(mapPreflightToWelcomeModel(preflight));
        setDisks(diskResponse);

        if (diskResponse.length === 1) {
          installer.selectDisk(diskResponse[0].path);
        }
      } catch (error) {
        if (!active) {
          return;
        }

        setPreflightModel(null);
        setDisks([]);
        installer.setGlobalError(
          error instanceof Error
            ? error.message
            : "No se pudo cargar el instalador.",
        );
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadInitialData();

    return () => {
      active = false;
    };
  }, [reloadToken]);

  async function validateIdentityRemotely(): Promise<ValidationResponse | null> {
    const localErrors = installer.validateCurrentStep(disks, "identity");
    if (Object.keys(localErrors).length > 0) {
      return null;
    }

    try {
      const response = await installerClient.validateProfile(installer.profile);
      installer.setErrors(response.errors ?? {});

      if (response.ok && response.normalizedProfile) {
        installer.applyNormalizedProfile(response.normalizedProfile);
      }

      return response;
    } catch (error) {
      installer.setGlobalError(
        error instanceof Error
          ? error.message
          : "Fallo validando el perfil.",
      );
      return null;
    }
  }

  async function launchGuided() {
    installer.setBusy(true);
    installer.setGlobalError(null);

    try {
      const localErrors = installer.validateCurrentStep(disks, "confirm");
      if (Object.keys(localErrors).length > 0) {
        installer.goToStep("identity");
        installer.setGlobalError(
          "Hay datos pendientes o invalidos. Revisa los campos marcados antes de abrir Calamares.",
        );
        return;
      }

      const validation = await installerClient.validateProfile(installer.profile);
      installer.setErrors(validation.errors ?? {});

      if (!validation.ok) {
        installer.setGlobalError(
          "Hay datos pendientes o invalidos. Revisa los campos marcados antes de abrir Calamares.",
        );
        return;
      }

      const profileToLaunch = validation.normalizedProfile
        ? mergeNormalizedProfile(installer.profile, validation.normalizedProfile)
        : installer.profile;

      installer.applyProfile(profileToLaunch);

      const response = await installerClient.launchGuided(profileToLaunch);
      installer.setLaunchMode("guided");
      installer.setLaunchMessage(
        response.message ??
          "Perfil guiado validado. Calamares se abrira con el tramo final minimo.",
      );
      installer.goToStep("handoff");
    } catch (error) {
      installer.setGlobalError(
        error instanceof Error ? error.message : "No se pudo abrir Calamares.",
      );
    } finally {
      installer.setBusy(false);
    }
  }

  async function launchClassic() {
    installer.setBusy(true);
    installer.setGlobalError(null);

    try {
      const response = await installerClient.launchClassic();
      installer.setLaunchMode("classic");
      installer.setLaunchMessage(
        response.message ??
          "Se esta abriendo la instalacion avanzada con Calamares.",
      );
      installer.goToStep("handoff");
    } catch (error) {
      installer.setGlobalError(
        error instanceof Error
          ? error.message
          : "No se pudo abrir el Calamares clasico.",
      );
    } finally {
      installer.setBusy(false);
    }
  }

  async function handleNext() {
    installer.setGlobalError(null);

    if (installer.step === "welcome") {
      installer.goToStep("language");
      return;
    }

    if (installer.step === "language") {
      const errors = installer.validateCurrentStep(disks, "language");
      if (Object.keys(errors).length === 0) {
        installer.goToStep("disk");
      }
      return;
    }

    if (installer.step === "disk") {
      const errors = installer.validateCurrentStep(disks, "disk");
      if (Object.keys(errors).length === 0) {
        installer.goToStep("identity");
      }
      return;
    }

    if (installer.step === "identity") {
      const validation = await validateIdentityRemotely();
      if (validation?.ok) {
        installer.goToStep("confirm");
      }
      return;
    }

    if (installer.step === "confirm") {
      await launchGuided();
    }
  }

  function handleBack() {
    const currentIndex = STEP_ORDER.indexOf(installer.step);
    if (currentIndex <= 0) {
      return;
    }

    installer.goToStep(STEP_ORDER[currentIndex - 1]!);
  }

  const activeSlide = (() => {
    if (!preflightModel) {
      return (
        <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 text-center">
          <div className="glass-panel max-w-2xl border border-danger/30 bg-danger/10 px-8 py-10">
            <p className="text-xs uppercase tracking-[0.32em] text-danger/80">
              Estado inicial
            </p>
            <h2 className="mt-3 font-display text-4xl text-white">
              No se pudo preparar el instalador
            </h2>
            <p className="mt-3 text-base text-white/60">
              El contenedor grafico sigue intacto, pero la lectura de preflight o
              discos fallo. Reintenta la carga o abre el modo clasico.
            </p>
            <button
              className="btn-secondary mt-6"
              onClick={() => setReloadToken((current) => current + 1)}
              type="button"
            >
              Reintentar
            </button>
          </div>
        </section>
      );
    }

    if (installer.step === "welcome") {
      return <WelcomeSlide model={preflightModel} />;
    }

    if (installer.step === "language") {
      return (
        <LanguageSlide
          errors={installer.errors}
          onApplyPreset={installer.applyPreset}
          onUpdateField={installer.updateProfileField}
          profile={installer.profile}
          selectedPresetId={installer.selectedPresetId}
        />
      );
    }

    if (installer.step === "disk") {
      return (
        <DiskSlide
          disks={diskCards}
          errors={installer.errors}
          onSelectDisk={installer.selectDisk}
          selectedDiskPath={installer.profile.targetDisk}
        />
      );
    }

    if (installer.step === "identity") {
      return (
        <IdentitySlide
          errors={installer.errors}
          onUpdateUserField={installer.updateUserField}
          user={installer.profile.user}
        />
      );
    }

    if (installer.step === "confirm") {
      return (
        <ConfirmSlide
          profile={installer.profile}
          selectedDisk={selectedDisk}
        />
      );
    }

    return (
      <HandoffSlide
        launchMessage={installer.launchMessage}
        launchMode={installer.launchMode}
        onClassicLaunch={() => void launchClassic()}
      />
    );
  })();

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <VideoBackground />
      <GlobalError
        error={installer.globalError}
        onDismiss={installer.dismissGlobalError}
      />

      {isLoading ? (
        <LoadingScreen />
      ) : (
        <div className="relative z-10 flex min-h-screen flex-col">
          <header className="px-6 pt-6">
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
              <div className="hidden text-right text-sm text-white/45 lg:block">
                <p>Preparacion guiada con traspaso final a Calamares.</p>
              </div>
            </div>
          </header>

          <main className="flex min-h-0 flex-1 px-6 pb-4 pt-4">
            <div className="mx-auto flex w-full max-w-6xl flex-1 min-h-0">
              <SlideContainer direction={installer.direction} step={installer.step}>
                {activeSlide}
              </SlideContainer>
            </div>
          </main>

          {installer.step !== "handoff" ? (
            <NavigationBar
              busy={installer.busy}
              canGoBack={installer.step !== "welcome" && Boolean(preflightModel)}
              canGoNext={Boolean(preflightModel)}
              currentStep={installer.step}
              nextLabel={nextLabel(installer.step, installer.busy)}
              onBack={handleBack}
              onClassicLaunch={() => void launchClassic()}
              onNext={() => void handleNext()}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
