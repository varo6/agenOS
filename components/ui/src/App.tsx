import { useEffect, useMemo, useState } from "react";

type BootMode = "installer" | "home" | "app";
type PowerAction = "poweroff" | "reboot";
type RoutePath = "/" | "/installer" | "/home" | "/launching";
type FirmwareType = "UEFI" | "BIOS";
type StepId = "welcome" | "language" | "disk" | "identity" | "confirm" | "handoff";

type BootstrapSeed = {
  sessionToken: string;
};

type ShellBootstrap = {
  sessionToken: string;
  bootMode: BootMode;
  isLiveSession: boolean;
  maintenanceEnabled: boolean;
  startupAppDesktopId: string | null;
  installerEnabled: boolean;
};

type AppEntry = {
  desktopId: string;
  name: string;
  description: string;
  iconName: string | null;
  exec: string;
  categories: string[];
  source: "system" | "user" | "internal";
  hidden: boolean;
};

type ApiMessageResponse = {
  ok: boolean;
  message?: string;
};

type PreflightCheck = {
  id: string;
  label: string;
  status: "ok" | "warning" | "error";
  detail: string;
};

type PreflightResponse = {
  firmware: FirmwareType;
  isLiveSession: boolean;
  totalRamBytes: number;
  installableDiskBytes: number;
  checks: PreflightCheck[];
};

type DiskSummary = {
  path: string;
  model: string;
  vendor: string;
  transport: string;
  sizeBytes: number;
  sizeLabel: string;
  systemDisk: boolean;
};

type ValidateErrorMap = Record<string, string>;

type InstallerProfilePayload = {
  schemaVersion: 1;
  locale: string;
  timezone: string;
  keyboardLayout: string;
  keyboardVariant: string;
  targetDisk: string;
  user: {
    fullName: string;
    username: string;
    hostname: string;
    password: string;
    passwordConfirmation?: string;
  };
  installMode: "erase-disk";
  rootMode: "same-as-user";
};

type ValidationResponse = {
  ok: boolean;
  errors: ValidateErrorMap;
  normalizedProfile?: InstallerProfilePayload;
};

type LaunchResponse = {
  ok: boolean;
  launched?: boolean;
  errors?: ValidateErrorMap;
  message?: string;
};

const bootstrapSeed = (window as Window & { __AGENOS_SHELL__?: BootstrapSeed }).__AGENOS_SHELL__ ?? {
  sessionToken: "",
};

const localeOptions = [
  { label: "Español (España)", locale: "es_ES.UTF-8", timezone: "Europe/Madrid", keyboardLayout: "es" },
  { label: "English (United States)", locale: "en_US.UTF-8", timezone: "America/New_York", keyboardLayout: "us" },
  { label: "English (United Kingdom)", locale: "en_GB.UTF-8", timezone: "Europe/London", keyboardLayout: "gb" },
  { label: "Français (France)", locale: "fr_FR.UTF-8", timezone: "Europe/Paris", keyboardLayout: "fr" },
  { label: "Deutsch (Deutschland)", locale: "de_DE.UTF-8", timezone: "Europe/Berlin", keyboardLayout: "de" },
];

const timezoneSuggestions = [
  "Europe/Madrid",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "America/Mexico_City",
  "UTC",
];

const keyboardLayoutOptions = [
  { value: "es", label: "Español" },
  { value: "us", label: "US" },
  { value: "gb", label: "UK" },
  { value: "latam", label: "Latinoamérica" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
];

const steps: { id: StepId; title: string }[] = [
  { id: "welcome", title: "Preflight" },
  { id: "language", title: "Idioma" },
  { id: "disk", title: "Disco" },
  { id: "identity", title: "Usuario" },
  { id: "confirm", title: "Confirmación" },
  { id: "handoff", title: "Handoff" },
];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 GB";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function buildDefaultProfile(): InstallerProfilePayload {
  const defaultLocale = localeOptions[0];
  return {
    schemaVersion: 1,
    locale: defaultLocale.locale,
    timezone: defaultLocale.timezone,
    keyboardLayout: defaultLocale.keyboardLayout,
    keyboardVariant: "",
    targetDisk: "",
    user: {
      fullName: "",
      username: "",
      hostname: "",
      password: "",
      passwordConfirmation: "",
    },
    installMode: "erase-disk",
    rootMode: "same-as-user",
  };
}

function mergeNormalizedProfile(
  current: InstallerProfilePayload,
  normalized: InstallerProfilePayload,
): InstallerProfilePayload {
  return {
    ...normalized,
    user: {
      ...normalized.user,
      passwordConfirmation: current.user.passwordConfirmation ?? current.user.password,
    },
  };
}

function localValidation(profile: InstallerProfilePayload): ValidateErrorMap {
  const errors: ValidateErrorMap = {};
  if (!profile.locale.trim()) {
    errors.locale = "Selecciona un locale válido.";
  }
  if (!profile.timezone.trim()) {
    errors.timezone = "Selecciona una zona horaria.";
  }
  if (!profile.keyboardLayout.trim()) {
    errors.keyboardLayout = "Selecciona un layout de teclado.";
  }
  if (!profile.targetDisk.trim()) {
    errors.targetDisk = "Selecciona el disco que se destruirá.";
  }
  if (!profile.user.fullName.trim()) {
    errors.fullName = "El nombre completo es obligatorio.";
  }
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(profile.user.username)) {
    errors.username = "El usuario debe empezar en minúscula y usar solo a-z, 0-9, _ o -.";
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(profile.user.hostname)) {
    errors.hostname = "El hostname debe usar minúsculas, números y guiones.";
  }
  if (!profile.user.password) {
    errors.password = "La contraseña es obligatoria.";
  }
  if (profile.user.password !== profile.user.passwordConfirmation) {
    errors.passwordConfirmation = "Las contraseñas no coinciden.";
  }
  return errors;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json() as Promise<T>;
  }
  const text = await response.text();
  throw new Error(text || `${response.status} ${response.statusText}`);
}

async function apiGet<T>(path: string, sessionToken?: string): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (sessionToken) {
    headers["X-Session-Token"] = sessionToken;
  }
  const response = await fetch(path, { headers });
  const payload = await parseResponse<T | ApiMessageResponse>(response);
  if (!response.ok) {
    throw new Error((payload as ApiMessageResponse).message ?? `GET ${path} devolvió ${response.status}`);
  }
  return payload as T;
}

async function apiPost<T>(path: string, body: unknown, sessionToken: string): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Session-Token": sessionToken,
    },
    body: JSON.stringify(body),
  });
  const payload = await parseResponse<T | ApiMessageResponse>(response);
  if (!response.ok) {
    throw new Error((payload as ApiMessageResponse).message ?? `POST ${path} devolvió ${response.status}`);
  }
  return payload as T;
}

function useRoutePath(): [RoutePath, (next: RoutePath) => void] {
  const current = window.location.pathname as RoutePath;
  const [path, setPath] = useState<RoutePath>(current || "/");

  useEffect(() => {
    const onPopState = () => setPath((window.location.pathname as RoutePath) || "/");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(next: RoutePath) {
    if (window.location.pathname !== next) {
      window.history.pushState({}, "", next);
    }
    setPath(next);
  }

  return [path, navigate];
}

function inferMaintenanceAction(entry: AppEntry): "terminal" | "classic-installer" | "reload-shell" | null {
  if (entry.desktopId === "internal:terminal") {
    return "terminal";
  }
  if (entry.desktopId === "internal:classic-installer") {
    return "classic-installer";
  }
  if (entry.desktopId === "internal:reload-shell") {
    return "reload-shell";
  }
  return null;
}

function AppList({
  entries,
  query,
  onOpen,
}: {
  entries: AppEntry[];
  query: string;
  onOpen: (entry: AppEntry) => void;
}) {
  if (entries.length === 0) {
    return (
      <div className="empty-state">
        <strong>No hay coincidencias</strong>
        <p>{query.startsWith(":") ? "Ese comando oculto no existe." : "Prueba con otro nombre o categoría."}</p>
      </div>
    );
  }

  return (
    <div className="app-grid">
      {entries.map((entry) => (
        <button key={entry.desktopId} type="button" className="app-card" onClick={() => onOpen(entry)}>
          <span className="app-icon">{(entry.name[0] ?? "A").toUpperCase()}</span>
          <div>
            <strong>{entry.name}</strong>
            <p>{entry.description || (entry.source === "internal" ? "Acción interna de la shell." : "App del sistema.")}</p>
            <small>{entry.source === "internal" ? "mantenimiento" : entry.source === "user" ? "usuario" : "sistema"}</small>
          </div>
        </button>
      ))}
    </div>
  );
}

function LaunchingView({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="screen">
      <section className="launch-screen">
        <div className="eyebrow">Transición</div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </section>
    </div>
  );
}

function ShellErrorView({
  message,
  onRetry,
  onOpenTerminal,
}: {
  message: string;
  onRetry: () => void;
  onOpenTerminal: () => void;
}) {
  return (
    <div className="screen">
      <section className="error-screen">
        <div className="eyebrow">Error local</div>
        <h2>La shell no ha podido completar el arranque.</h2>
        <p>{message}</p>
        <div className="row-actions">
          <button className="primary" onClick={onRetry}>
            Reintentar shell
          </button>
          <button className="secondary" onClick={onOpenTerminal}>
            Abrir terminal de mantenimiento
          </button>
        </div>
      </section>
    </div>
  );
}

function InstallerView({
  sessionToken,
  isLiveSession,
  installerEnabled,
}: {
  sessionToken: string;
  isLiveSession: boolean;
  installerEnabled: boolean;
}) {
  const [step, setStep] = useState<StepId>("welcome");
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  const [disks, setDisks] = useState<DiskSummary[]>([]);
  const [profile, setProfile] = useState<InstallerProfilePayload>(buildDefaultProfile());
  const [errors, setErrors] = useState<ValidateErrorMap>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [launchMessage, setLaunchMessage] = useState("");
  const [globalError, setGlobalError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [preflightResponse, disksResponse] = await Promise.all([
          apiGet<PreflightResponse>("/api/installer/preflight", sessionToken),
          apiGet<DiskSummary[]>("/api/installer/disks", sessionToken),
        ]);

        if (!active) {
          return;
        }

        setPreflight(preflightResponse);
        setDisks(disksResponse);
        if (disksResponse.length === 1) {
          setProfile((current) => ({ ...current, targetDisk: disksResponse[0].path }));
        }
      } catch (error) {
        setGlobalError(error instanceof Error ? error.message : "No se pudo cargar el instalador.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [sessionToken]);

  const selectedDisk = useMemo(
    () => disks.find((disk) => disk.path === profile.targetDisk) ?? null,
    [disks, profile.targetDisk],
  );

  function updateUserField<Key extends keyof InstallerProfilePayload["user"]>(
    key: Key,
    value: InstallerProfilePayload["user"][Key],
  ) {
    setProfile((current) => ({
      ...current,
      user: {
        ...current.user,
        [key]: value,
      },
    }));
  }

  function applyLocalePreset(locale: string) {
    const preset = localeOptions.find((option) => option.locale === locale);
    setProfile((current) => ({
      ...current,
      locale,
      timezone: preset?.timezone ?? current.timezone,
      keyboardLayout: preset?.keyboardLayout ?? current.keyboardLayout,
    }));
  }

  async function validateRemotely(): Promise<ValidationResponse | null> {
    const localErrors = localValidation(profile);
    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      return null;
    }

    try {
      const response = await apiPost<ValidationResponse>("/api/installer/validate-profile", profile, sessionToken);
      setErrors(response.errors ?? {});
      return response;
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "Fallo validando el perfil.");
      return null;
    }
  }

  async function nextStep() {
    setGlobalError("");
    if (step === "welcome") {
      setStep("language");
      return;
    }
    if (step === "language") {
      const localErrors = localValidation(profile);
      setErrors(localErrors);
      if (localErrors.locale || localErrors.timezone || localErrors.keyboardLayout) {
        return;
      }
      setStep("disk");
      return;
    }
    if (step === "disk") {
      const localErrors = localValidation(profile);
      setErrors(localErrors);
      if (localErrors.targetDisk) {
        return;
      }
      setStep("identity");
      return;
    }
    if (step === "identity") {
      const validation = await validateRemotely();
      if (!validation?.ok) {
        return;
      }
      const normalizedProfile = validation.normalizedProfile;
      if (normalizedProfile) {
        setProfile((current) => mergeNormalizedProfile(current, normalizedProfile));
      }
      setStep("confirm");
      return;
    }
    if (step === "confirm") {
      await launchGuided();
    }
  }

  function previousStep() {
    if (step === "language") {
      setStep("welcome");
      return;
    }
    if (step === "disk") {
      setStep("language");
      return;
    }
    if (step === "identity") {
      setStep("disk");
      return;
    }
    if (step === "confirm") {
      setStep("identity");
    }
  }

  async function launchGuided() {
    setBusy(true);
    setLaunchMessage("");
    setGlobalError("");

    try {
      const validation = await validateRemotely();
      if (!validation?.ok) {
        setGlobalError("Hay datos pendientes o inválidos. Revisa los campos marcados antes de abrir Calamares.");
        return;
      }

      const profileToLaunch = validation.normalizedProfile
        ? mergeNormalizedProfile(profile, validation.normalizedProfile)
        : profile;
      setProfile(profileToLaunch);

      const response = await apiPost<LaunchResponse>("/api/installer/start-guided", profileToLaunch, sessionToken);
      setLaunchMessage(
        response.message ??
          "Calamares se está abriendo con el perfil guiado mínimo. Completa allí partición, resumen y finalización.",
      );
      setStep("handoff");
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "No se pudo abrir Calamares.");
    } finally {
      setBusy(false);
    }
  }

  async function launchClassic() {
    setBusy(true);
    setGlobalError("");
    try {
      const response = await apiPost<LaunchResponse>("/api/installer/start-classic", {}, sessionToken);
      setLaunchMessage(response.message ?? "Calamares clásico se está abriendo en modo avanzado.");
      setStep("handoff");
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "No se pudo abrir el Calamares clásico.");
    } finally {
      setBusy(false);
    }
  }

  if (!installerEnabled) {
    return (
      <div className="screen">
        <section className="error-screen">
          <div className="eyebrow">Installer deshabilitado</div>
          <h2>El instalador guiado solo está disponible en la sesión live.</h2>
          <p>Esta instalación ya debería arrancar directamente a la home de AgenOS.</p>
        </section>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="screen">
        <div className="loading-card">Inicializando instalador…</div>
      </div>
    );
  }

  return (
    <div className="installer-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <div>
            <div className="eyebrow">Modo live</div>
            <h1>AgenOS Installer</h1>
          </div>
        </div>
        <ol className="step-list">
          {steps.map((item, index) => (
            <li key={item.id} className={item.id === step ? "active" : ""}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.title}</strong>
            </li>
          ))}
        </ol>
        {isLiveSession ? (
          <button className="secondary ghost" onClick={() => void launchClassic()} disabled={busy}>
            Instalación avanzada con Calamares
          </button>
        ) : null}
      </aside>

      <main className="panel">
        {globalError ? <div className="banner error">{globalError}</div> : null}

        {step === "welcome" && preflight ? (
          <section className="content">
            <div className="hero">
              <div>
                <div className="eyebrow">Shell unificada</div>
                <h2>La sesión live entra directa al wrapper guiado antes de Calamares.</h2>
              </div>
              <div className="hero-stats">
                <div>
                  <span>Firmware</span>
                  <strong>{preflight.firmware}</strong>
                </div>
                <div>
                  <span>RAM detectada</span>
                  <strong>{formatBytes(preflight.totalRamBytes)}</strong>
                </div>
                <div>
                  <span>Discos instalables</span>
                  <strong>{formatBytes(preflight.installableDiskBytes)}</strong>
                </div>
              </div>
            </div>

            <div className="check-grid">
              {preflight.checks.map((check) => (
                <article key={check.id} className={`check-card ${check.status}`}>
                  <div className="check-header">
                    <span className="pill">{check.status}</span>
                    <strong>{check.label}</strong>
                  </div>
                  <p>{check.detail}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {step === "language" ? (
          <section className="content">
            <div className="section-heading">
              <div className="eyebrow">Paso 2</div>
              <h2>Idioma, locale, timezone y teclado</h2>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>Preset de idioma</span>
                <select value={profile.locale} onChange={(event) => applyLocalePreset(event.target.value)}>
                  {localeOptions.map((option) => (
                    <option key={option.locale} value={option.locale}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Locale</span>
                <input value={profile.locale} onChange={(event) => setProfile((current) => ({ ...current, locale: event.target.value }))} />
                {errors.locale ? <small>{errors.locale}</small> : null}
              </label>

              <label className="field">
                <span>Timezone</span>
                <input list="timezone-suggestions" value={profile.timezone} onChange={(event) => setProfile((current) => ({ ...current, timezone: event.target.value }))} />
                <datalist id="timezone-suggestions">
                  {timezoneSuggestions.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
                {errors.timezone ? <small>{errors.timezone}</small> : null}
              </label>

              <label className="field">
                <span>Layout de teclado</span>
                <select value={profile.keyboardLayout} onChange={(event) => setProfile((current) => ({ ...current, keyboardLayout: event.target.value }))}>
                  {keyboardLayoutOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {errors.keyboardLayout ? <small>{errors.keyboardLayout}</small> : null}
              </label>

              <label className="field">
                <span>Variante de teclado</span>
                <input value={profile.keyboardVariant} onChange={(event) => setProfile((current) => ({ ...current, keyboardVariant: event.target.value }))} placeholder="Vacío para default" />
              </label>
            </div>
          </section>
        ) : null}

        {step === "disk" ? (
          <section className="content">
            <div className="section-heading">
              <div className="eyebrow">Paso 3</div>
              <h2>Selecciona el disco que será borrado por completo</h2>
            </div>

            <div className="warning-card">
              La v1 solo soporta instalación sobre disco completo. Todo el contenido del disco elegido será destruido.
            </div>

            <div className="disk-grid">
              {disks.map((disk) => (
                <button
                  key={disk.path}
                  className={`disk-card ${profile.targetDisk === disk.path ? "selected" : ""}`}
                  onClick={() => setProfile((current) => ({ ...current, targetDisk: disk.path }))}
                  type="button"
                >
                  <div className="disk-topline">
                    <strong>{disk.path}</strong>
                    <span>{disk.sizeLabel}</span>
                  </div>
                  <p>{[disk.vendor, disk.model].filter(Boolean).join(" ").trim() || "Disco sin modelo declarado"}</p>
                  <small>{disk.transport || "transporte desconocido"}</small>
                </button>
              ))}
            </div>
            {errors.targetDisk ? <div className="inline-error">{errors.targetDisk}</div> : null}
          </section>
        ) : null}

        {step === "identity" ? (
          <section className="content">
            <div className="section-heading">
              <div className="eyebrow">Paso 4</div>
              <h2>Usuario principal, hostname y contraseña</h2>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>Nombre completo</span>
                <input value={profile.user.fullName} onChange={(event) => updateUserField("fullName", event.target.value)} />
                {errors.fullName ? <small>{errors.fullName}</small> : null}
              </label>

              <label className="field">
                <span>Usuario</span>
                <input value={profile.user.username} onChange={(event) => updateUserField("username", event.target.value.toLowerCase())} />
                {errors.username ? <small>{errors.username}</small> : null}
              </label>

              <label className="field">
                <span>Hostname</span>
                <input value={profile.user.hostname} onChange={(event) => updateUserField("hostname", event.target.value.toLowerCase())} />
                {errors.hostname ? <small>{errors.hostname}</small> : null}
              </label>

              <label className="field">
                <span>Contraseña</span>
                <input type="password" value={profile.user.password} onChange={(event) => updateUserField("password", event.target.value)} />
                {errors.password ? <small>{errors.password}</small> : null}
              </label>

              <label className="field">
                <span>Confirmación de contraseña</span>
                <input type="password" value={profile.user.passwordConfirmation ?? ""} onChange={(event) => updateUserField("passwordConfirmation", event.target.value)} />
                {errors.passwordConfirmation ? <small>{errors.passwordConfirmation}</small> : null}
              </label>
            </div>

            <div className="tip-card">
              La cuenta `root` heredará la misma contraseña del usuario principal.
            </div>
          </section>
        ) : null}

        {step === "confirm" ? (
          <section className="content">
            <div className="section-heading">
              <div className="eyebrow">Paso 5</div>
              <h2>Confirmación destructiva final</h2>
            </div>

            <div className="summary-grid">
              <article className="summary-card">
                <span>Destino</span>
                <strong>{selectedDisk?.path ?? "Sin seleccionar"}</strong>
                <p>{selectedDisk ? `${selectedDisk.sizeLabel} · ${[selectedDisk.vendor, selectedDisk.model].filter(Boolean).join(" ")}` : "Selecciona un disco antes de continuar."}</p>
              </article>

              <article className="summary-card">
                <span>Perfil</span>
                <strong>{profile.user.fullName || "Sin nombre"}</strong>
                <p>{profile.user.username}@{profile.user.hostname || "hostname-pendiente"}</p>
              </article>

              <article className="summary-card">
                <span>Idioma y teclado</span>
                <strong>{profile.locale}</strong>
                <p>{profile.timezone} · {profile.keyboardLayout}{profile.keyboardVariant ? `/${profile.keyboardVariant}` : ""}</p>
              </article>
            </div>

            <div className="warning-card critical">
              Al pulsar continuar se escribirá un `profile.json` temporal y se abrirá Calamares en el tramo final. El disco seleccionado será el candidato de destrucción total.
            </div>
          </section>
        ) : null}

        {step === "handoff" ? (
          <section className="content">
            <div className="section-heading">
              <div className="eyebrow">Paso 6</div>
              <h2>Calamares toma el tramo final</h2>
            </div>

            <div className="handoff-card">
              <p>{launchMessage || "Esperando a que Calamares se abra..."}</p>
              <p>Si necesitas salir del flujo guiado, usa la ruta oculta `:classic-installer`.</p>
            </div>
          </section>
        ) : null}

        <footer className="actions">
          <div className="left-actions">
            {step !== "welcome" && step !== "handoff" ? (
              <button className="secondary" onClick={previousStep} disabled={busy}>
                Atrás
              </button>
            ) : null}
          </div>
          <div className="right-actions">
            {step !== "handoff" ? (
              <button className="primary" onClick={() => void nextStep()} disabled={busy}>
                {busy ? "Trabajando…" : step === "confirm" ? "Abrir Calamares guiado" : "Continuar"}
              </button>
            ) : null}
          </div>
        </footer>
      </main>
    </div>
  );
}

export default function App() {
  const [route, navigate] = useRoutePath();
  const [bootstrap, setBootstrap] = useState<ShellBootstrap | null>(null);
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [banner, setBanner] = useState("");
  const [loading, setLoading] = useState(true);
  const [shellError, setShellError] = useState("");
  const [query, setQuery] = useState("");
  const [launchState, setLaunchState] = useState({
    title: "Preparando shell",
    detail: "Cargando estado inicial.",
  });
  const [confirmPowerAction, setConfirmPowerAction] = useState<PowerAction | null>(null);

  async function loadShellState() {
    try {
      setLoading(true);
      setShellError("");
      const bootstrapResponse = await apiGet<ShellBootstrap>("/api/bootstrap");
      const appsResponse = await apiGet<AppEntry[]>("/api/apps", bootstrapResponse.sessionToken || bootstrapSeed.sessionToken);
      setBootstrap({ ...bootstrapResponse, sessionToken: bootstrapResponse.sessionToken || bootstrapSeed.sessionToken });
      setApps(appsResponse);
    } catch (error) {
      setShellError(error instanceof Error ? error.message : "La shell no ha podido hablar con el backend.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadShellState();
  }, []);

  useEffect(() => {
    if (!bootstrap) {
      return;
    }
    if (route !== "/") {
      return;
    }

    if (bootstrap.bootMode === "installer" && bootstrap.installerEnabled) {
      navigate("/installer");
      return;
    }

    if (bootstrap.bootMode === "app" && bootstrap.startupAppDesktopId) {
      const startupApp = apps.find((entry) => entry.desktopId === bootstrap.startupAppDesktopId);
      if (startupApp) {
        void handleOpenEntry(startupApp);
        return;
      }
    }

    navigate("/home");
  }, [apps, bootstrap, navigate, route]);

  const filteredEntries = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const visibleApps = apps.filter((entry) => entry.source !== "internal");
    const internalApps = apps.filter((entry) => entry.source === "internal");

    if (trimmed.startsWith(":")) {
      const maintenanceQuery = trimmed.slice(1);
      return internalApps.filter((entry) => entry.name.toLowerCase().includes(maintenanceQuery) || entry.description.toLowerCase().includes(maintenanceQuery));
    }

    if (!trimmed) {
      return visibleApps.slice(0, 8);
    }

    return visibleApps.filter((entry) => {
      const haystack = [entry.name, entry.description, entry.categories.join(" ")].join(" ").toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [apps, query]);

  async function runMaintenance(action: "terminal" | "classic-installer" | "reload-shell") {
    const sessionToken = bootstrap?.sessionToken ?? bootstrapSeed.sessionToken;
    if (!sessionToken) {
      return;
    }
    try {
      setBanner("");
      setLaunchState({
        title: "Lanzando mantenimiento",
        detail: `Acción ${action} en curso.`,
      });
      navigate("/launching");
      const response = await apiPost<ApiMessageResponse>("/api/system/maintenance", { action }, sessionToken);
      setBanner(response.message ?? "Acción de mantenimiento lanzada.");
      if (action === "reload-shell") {
        window.setTimeout(() => window.location.reload(), 600);
        return;
      }
      window.setTimeout(() => navigate("/home"), 700);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "La acción de mantenimiento ha fallado.");
      navigate("/home");
    }
  }

  async function handleOpenEntry(entry: AppEntry) {
    if (!bootstrap) {
      return;
    }

    const maintenanceAction = inferMaintenanceAction(entry);
    if (maintenanceAction) {
      await runMaintenance(maintenanceAction);
      return;
    }

    try {
      setBanner("");
      setLaunchState({
        title: `Abriendo ${entry.name}`,
        detail: "La app se moverá al workspace 2:app y tomará foco en fullscreen.",
      });
      navigate("/launching");
      const response = await apiPost<ApiMessageResponse>(
        "/api/apps/open",
        { desktopId: entry.desktopId },
        bootstrap.sessionToken,
      );
      setBanner(response.message ?? `${entry.name} lanzada.`);
      setQuery("");
      window.setTimeout(() => navigate("/home"), 700);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "No se pudo abrir la app.");
      navigate("/home");
    }
  }

  async function handlePowerAction(action: PowerAction) {
    if (!bootstrap) {
      return;
    }
    try {
      setBanner("");
      setLaunchState({
        title: action === "poweroff" ? "Apagando" : "Reiniciando",
        detail: "La orden ya fue entregada al sistema.",
      });
      navigate("/launching");
      await apiPost<ApiMessageResponse>(`/api/system/${action}`, {}, bootstrap.sessionToken);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "La acción de energía ha fallado.");
      navigate("/home");
    } finally {
      setConfirmPowerAction(null);
    }
  }

  if (loading) {
    return (
      <div className="screen">
        <div className="loading-card">Inicializando shell…</div>
      </div>
    );
  }

  if (shellError) {
    return (
      <ShellErrorView
        message={shellError}
        onRetry={() => void loadShellState()}
        onOpenTerminal={() => void runMaintenance("terminal")}
      />
    );
  }

  if (!bootstrap) {
    return (
      <div className="screen">
        <div className="loading-card">Esperando bootstrap…</div>
      </div>
    );
  }

  return (
    <div className="shell-root">
      {route === "/installer" ? (
        <InstallerView
          sessionToken={bootstrap.sessionToken}
          isLiveSession={bootstrap.isLiveSession}
          installerEnabled={bootstrap.installerEnabled}
        />
      ) : null}

      {route === "/launching" ? <LaunchingView title={launchState.title} detail={launchState.detail} /> : null}

      {route === "/home" ? (
        <div className="screen">
          <section className="home-shell">
            <div className="home-header">
              <div>
                <div className="eyebrow">Workspace 1:home</div>
                <h1>Hola mundo.</h1>
                <p>Busca una app, lanza una acción o entra en mantenimiento con `:` al principio de la consulta.</p>
              </div>
              <div className="home-meta">
                <span>{bootstrap.isLiveSession ? "live" : "installed"}</span>
                <strong>{bootstrap.bootMode}</strong>
              </div>
            </div>

            {banner ? <div className="banner info">{banner}</div> : null}

            <div className="launcher-panel">
              <label className="search-shell">
                <span className="eyebrow">Launcher</span>
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar apps o escribir :terminal"
                />
              </label>
              <AppList entries={filteredEntries} query={query} onOpen={(entry) => void handleOpenEntry(entry)} />
            </div>

            <div className="power-row">
              <button className="secondary" onClick={() => setConfirmPowerAction("poweroff")}>
                Apagar
              </button>
              <button className="secondary" onClick={() => setConfirmPowerAction("reboot")}>
                Reiniciar
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {confirmPowerAction ? (
        <div className="modal-backdrop">
          <section className="modal-card">
            <div className="eyebrow">Confirmación</div>
            <h2>{confirmPowerAction === "poweroff" ? "Apagar el equipo" : "Reiniciar el equipo"}</h2>
            <p>La shell pedirá la acción al backend y abandonará la sesión actual.</p>
            <div className="row-actions">
              <button className="secondary" onClick={() => setConfirmPowerAction(null)}>
                Cancelar
              </button>
              <button className="primary" onClick={() => void handlePowerAction(confirmPowerAction)}>
                Confirmar
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
