import { useEffect, useMemo, useState } from "react";

import type {
  DiskSummary,
  StepId,
  ValidationResponse,
} from "../../shared/installer-types";
import { GlobalError } from "./components/GlobalError";
import { LoadingScreen } from "./components/LoadingScreen";
import { VideoBackground } from "./components/VideoBackground";
import { InstallerShell } from "../installer-shell/InstallerShell";
import { NetworkConnectionPanel } from "../../../../network/react/NetworkConnectionPanel";
import { createNetworkClient } from "../../../../network/client";
import { installerClient } from "./installer-client";
import { mapDiskToCardModel, mapPreflightToWelcomeModel } from "./mappers";
import { ConfirmSlide } from "./slides/ConfirmSlide";
import { DiskSlide } from "./slides/DiskSlide";
import { HandoffSlide } from "./slides/HandoffSlide";
import { IdentitySlide } from "./slides/IdentitySlide";
import { LanguageSlide } from "./slides/LanguageSlide";
import { WelcomeSlide } from "./slides/WelcomeSlide";
import {
  STEP_ORDER,
  buildDefaultProfile,
  mergeNormalizedProfile,
  useInstallerStore,
  type InstallerStoreSnapshot,
} from "./store/useInstallerStore";

const INSTALLER_SNAPSHOT_STORAGE_KEY = "agenos.installer.snapshot";
const INSTALLER_SNAPSHOT_VERSION = 1;
const networkClient = createNetworkClient();

type PersistedInstallerState = {
  version: number;
  snapshot: InstallerStoreSnapshot;
};

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInstallerSnapshot(value: unknown): value is InstallerStoreSnapshot {
  if (!isObject(value)) {
    return false;
  }

  if (!STEP_ORDER.includes(value.step as StepId)) {
    return false;
  }

  if (typeof value.selectedPresetId !== "string") {
    return false;
  }

  if (!isObject(value.profile) || value.profile.schemaVersion !== 1) {
    return false;
  }

  if (!isObject(value.profile.user)) {
    return false;
  }

  if (!["guided", "classic", null].includes((value.launchMode as string | null) ?? null)) {
    return false;
  }

  return typeof value.launchMessage === "string";
}

function readInstallerSnapshot(): InstallerStoreSnapshot | null {
  try {
    const rawValue = window.localStorage.getItem(INSTALLER_SNAPSHOT_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as PersistedInstallerState;
    if (parsed.version !== INSTALLER_SNAPSHOT_VERSION || !isInstallerSnapshot(parsed.snapshot)) {
      return null;
    }

    return parsed.snapshot;
  } catch {
    return null;
  }
}

function writeInstallerSnapshot(snapshot: InstallerStoreSnapshot): void {
  try {
    const payload: PersistedInstallerState = {
      version: INSTALLER_SNAPSHOT_VERSION,
      snapshot,
    };
    window.localStorage.setItem(INSTALLER_SNAPSHOT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures in live kiosk mode.
  }
}

function normalizeSnapshot(snapshot: InstallerStoreSnapshot): InstallerStoreSnapshot {
  const defaults = buildDefaultProfile();
  const profile = snapshot.profile;
  const user = isObject(profile.user) ? profile.user : {};
  const safeUser = user as Record<string, unknown>;

  return {
    step: STEP_ORDER.includes(snapshot.step) ? snapshot.step : "welcome",
    selectedPresetId: snapshot.selectedPresetId,
    profile: {
      schemaVersion: 1,
      locale: typeof profile.locale === "string" ? profile.locale : defaults.locale,
      timezone: typeof profile.timezone === "string" ? profile.timezone : defaults.timezone,
      keyboardLayout: typeof profile.keyboardLayout === "string"
        ? profile.keyboardLayout
        : defaults.keyboardLayout,
      keyboardVariant: typeof profile.keyboardVariant === "string"
        ? profile.keyboardVariant
        : defaults.keyboardVariant,
      targetDisk: typeof profile.targetDisk === "string" ? profile.targetDisk : "",
      user: {
        fullName: typeof safeUser.fullName === "string" ? safeUser.fullName : "",
        username: typeof safeUser.username === "string" ? safeUser.username : "",
        hostname: typeof safeUser.hostname === "string" ? safeUser.hostname : "",
        password: typeof safeUser.password === "string" ? safeUser.password : "",
        passwordConfirmation: typeof safeUser.passwordConfirmation === "string"
          ? safeUser.passwordConfirmation
          : typeof safeUser.password === "string"
            ? safeUser.password
            : "",
      },
      installMode: "erase-disk",
      rootMode: "same-as-user",
    },
    launchMode: snapshot.launchMode,
    launchMessage: snapshot.launchMessage,
  };
}

export default function App() {
  const installer = useInstallerStore();
  const [preflightModel, setPreflightModel] = useState<ReturnType<
    typeof mapPreflightToWelcomeModel
  > | null>(null);
  const [isLiveSession, setIsLiveSession] = useState<boolean | null>(null);
  const [disks, setDisks] = useState<DiskSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [networkOnline, setNetworkOnline] = useState<boolean | null>(null);
  const [continueOffline, setContinueOffline] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [hasHydratedInstaller, setHasHydratedInstaller] = useState(false);

  const diskCards = useMemo(() => disks.map(mapDiskToCardModel), [disks]);
  const selectedDisk = useMemo(
    () => diskCards.find((disk) => disk.path === installer.profile.targetDisk) ?? null,
    [diskCards, installer.profile.targetDisk],
  );

  useEffect(() => {
    let active = true;

    async function loadInitialData() {
      setIsLoading(true);
      setHasHydratedInstaller(false);
      installer.setGlobalError(null);

      try {
        const [preflight, diskResponse] = await Promise.all([
          installerClient.getPreflight(),
          installerClient.getDisks(),
        ]);
        const networkStatus = await networkClient.getStatus().catch(() => null);

        if (!active) {
          return;
        }

        setPreflightModel(mapPreflightToWelcomeModel(preflight));
        setIsLiveSession(preflight.isLiveSession);
        setDisks(diskResponse);
        setNetworkOnline(networkStatus?.overall === "online");

        if (preflight.isLiveSession) {
          const persistedSnapshot = readInstallerSnapshot();
          if (persistedSnapshot) {
            installer.restoreSnapshot(normalizeSnapshot(persistedSnapshot));
          } else if (diskResponse.length === 1) {
            installer.selectDisk(diskResponse[0].path);
          }
        } else if (diskResponse.length === 1) {
          installer.selectDisk(diskResponse[0].path);
        }
      } catch (error) {
        if (!active) {
          return;
        }

        setPreflightModel(null);
        setIsLiveSession(null);
        setDisks([]);
        installer.setGlobalError(
          error instanceof Error
            ? error.message
            : "No se pudo cargar el instalador.",
        );
      } finally {
        if (active) {
          setHasHydratedInstaller(true);
          setIsLoading(false);
        }
      }
    }

    void loadInitialData();

    return () => {
      active = false;
    };
  }, [reloadToken]);

  useEffect(() => {
    if (!hasHydratedInstaller || !isLiveSession) {
      return;
    }

    writeInstallerSnapshot({
      step: installer.step,
      selectedPresetId: installer.selectedPresetId,
      profile: installer.profile,
      launchMode: installer.launchMode,
      launchMessage: installer.launchMessage,
    });
  }, [
    hasHydratedInstaller,
    installer.launchMessage,
    installer.launchMode,
    installer.profile,
    installer.selectedPresetId,
    installer.step,
    isLiveSession,
  ]);

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

    if (isLiveSession === false) {
      return (
        <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 text-center">
          <div className="glass-panel max-w-2xl border border-danger/30 bg-danger/10 px-8 py-10">
            <p className="text-xs uppercase tracking-[0.32em] text-danger/80">
              Sesión no válida
            </p>
            <h2 className="mt-3 font-display text-4xl text-white">
              El instalador guiado solo vive en modo live
            </h2>
            <p className="mt-3 text-base text-white/60">
              Esta app queda separada del sistema principal y no debería abrirse en
              una sesión ya instalada.
            </p>
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
    <div className="relative min-h-screen overflow-hidden bg-[#07090f] text-white">
      <VideoBackground />
      <GlobalError
        error={installer.globalError}
        onDismiss={installer.dismissGlobalError}
      />

      {isLoading ? (
        <LoadingScreen />
      ) : networkOnline !== true && !continueOffline ? (
        <NetworkConnectionPanel
          allowContinueOffline
          client={networkClient}
          continueOfflineLabel="Continuar al instalador sin internet"
          onContinueOffline={() => setContinueOffline(true)}
          onOnline={() => setNetworkOnline(true)}
        />
      ) : (
        <InstallerShell
          activeSlide={activeSlide}
          busy={installer.busy}
          canGoBack={isLiveSession !== false && installer.step !== "welcome" && Boolean(preflightModel)}
          canGoNext={isLiveSession !== false && Boolean(preflightModel)}
          currentStep={installer.step}
          direction={installer.direction}
          nextLabel={nextLabel(installer.step, installer.busy)}
          onBack={handleBack}
          onClassicLaunch={() => void launchClassic()}
          onNext={() => void handleNext()}
        />
      )}
    </div>
  );
}
