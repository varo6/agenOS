import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  DiskSummary,
  InstallerProfilePayload,
  LaunchResponse,
  PreflightResponse,
  ValidationResponse,
} from "../../shared/installer-types";

const { installerClient } = vi.hoisted(() => ({
  installerClient: {
    getPreflight: vi.fn<() => Promise<PreflightResponse>>(),
    getDisks: vi.fn<() => Promise<DiskSummary[]>>(),
    validateProfile: vi.fn<(profile: InstallerProfilePayload) => Promise<ValidationResponse>>(),
    launchGuided: vi.fn<(profile: InstallerProfilePayload) => Promise<LaunchResponse>>(),
    launchClassic: vi.fn<() => Promise<LaunchResponse>>(),
    switchMode: vi.fn<(mode: "installer" | "system") => Promise<{ ok: boolean; message?: string }>>(),
  },
}));

vi.mock("./installer-client", () => ({
  installerClient,
}));

import App from "./App";

const defaultPreflight: PreflightResponse = {
  firmware: "UEFI",
  isLiveSession: true,
  totalRamBytes: 8 * 1024 * 1024 * 1024,
  installableDiskBytes: 64 * 1024 * 1024 * 1024,
  checks: [
    {
      id: "ram",
      label: "Memoria RAM",
      status: "ok",
      detail: "Detectados 8 GB. El wrapper v1 recomienda 4 GB o mas.",
    },
    {
      id: "live",
      label: "Sesion live",
      status: "ok",
      detail: "Se ha detectado una sesion live valida.",
    },
  ],
};

const singleDisk: DiskSummary = {
  path: "/dev/sda",
  vendor: "ATA",
  model: "Disk",
  transport: "sata",
  sizeBytes: 64 * 1024 * 1024 * 1024,
  sizeLabel: "64 GB",
  systemDisk: false,
};

const secondDisk: DiskSummary = {
  path: "/dev/nvme0n1",
  vendor: "Samsung",
  model: "970 EVO Plus",
  transport: "nvme",
  sizeBytes: 512 * 1024 * 1024 * 1024,
  sizeLabel: "512 GB",
  systemDisk: false,
};

function validProfile(): InstallerProfilePayload {
  return {
    schemaVersion: 1,
    locale: "es_ES.UTF-8",
    timezone: "Europe/Madrid",
    keyboardLayout: "es",
    keyboardVariant: "",
    targetDisk: "/dev/sda",
    user: {
      fullName: "Ada Lovelace",
      username: "ada",
      hostname: "agenos",
      password: "secret",
      passwordConfirmation: "secret",
    },
    installMode: "erase-disk",
    rootMode: "same-as-user",
  };
}

function normalizedProfile(overrides: Partial<InstallerProfilePayload> = {}) {
  const profile = validProfile();
  const merged = { ...profile, ...overrides };

  return {
    schemaVersion: 1 as const,
    locale: merged.locale,
    localeCode: "es_ES",
    localeConf: { LANG: merged.locale },
    timezone: merged.timezone,
    keyboardLayout: merged.keyboardLayout,
    keyboardVariant: merged.keyboardVariant,
    targetDisk: merged.targetDisk,
    user: {
      fullName: merged.user.fullName.trim(),
      username: merged.user.username,
      hostname: merged.user.hostname,
      password: merged.user.password,
    },
    installMode: "erase-disk" as const,
    rootMode: "same-as-user" as const,
  };
}

async function renderLoadedApp(disks: DiskSummary[] = [singleDisk]) {
  installerClient.getPreflight.mockResolvedValue(defaultPreflight);
  installerClient.getDisks.mockResolvedValue(disks);
  installerClient.validateProfile.mockResolvedValue({
    ok: true,
    errors: {},
    normalizedProfile: normalizedProfile(),
  });
  installerClient.launchGuided.mockResolvedValue({
    ok: true,
    launched: true,
    message: "Perfil guiado validado. Calamares se abrira con el tramo final minimo.",
  });
  installerClient.launchClassic.mockResolvedValue({
    ok: true,
    launched: true,
    message: "Se esta abriendo la instalacion avanzada con Calamares.",
  });
  installerClient.switchMode.mockResolvedValue({
    ok: true,
    message: "Cambiando a system.",
  });

  render(<App />);
  await screen.findByRole("heading", { name: "Instalador de AgenOS" });
  await screen.findByRole("heading", { name: "Todo listo para preparar la instalacion" });
}

async function goToLanguage() {
  fireEvent.click(screen.getByRole("button", { name: "Empezar" }));
  await screen.findByRole("heading", { name: "Idioma, zona horaria y teclado" });
}

async function goToDisk() {
  await goToLanguage();
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  await screen.findByRole("heading", { name: "Elige el disco de destino" });
}

async function goToIdentity() {
  await goToDisk();
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  await screen.findByRole("heading", { name: "Tu cuenta principal" });
}

async function fillIdentity() {
  fireEvent.change(screen.getByLabelText("Nombre completo"), {
    target: { value: "Ada Lovelace " },
  });
  fireEvent.change(screen.getByLabelText("Nombre de usuario"), {
    target: { value: "ada" },
  });
  fireEvent.change(screen.getByLabelText("Hostname"), {
    target: { value: "agenos" },
  });
  fireEvent.change(screen.getByLabelText("Contrasena"), {
    target: { value: "secret" },
  });
  fireEvent.change(screen.getByLabelText("Confirmar contrasena"), {
    target: { value: "secret" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/installer");
});

describe("App", () => {
  test("shows a loading screen while preflight and disks are pending", async () => {
    installerClient.getPreflight.mockResolvedValue(defaultPreflight);
    installerClient.getDisks.mockResolvedValue([singleDisk]);

    render(<App />);

    expect(screen.getByText("Preparando instalador")).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Todo listo para preparar la instalacion" });
  });

  test("shows a global error banner if initial data fails", async () => {
    installerClient.getPreflight.mockRejectedValueOnce(new Error("Sin acceso al API"));
    installerClient.getDisks.mockResolvedValueOnce([singleDisk]);

    render(<App />);

    await screen.findByRole("alert");
    expect(screen.getByText("Sin acceso al API")).toBeInTheDocument();
  });

  test("shows the live mode switch in live sessions", async () => {
    await renderLoadedApp();

    expect(screen.getByRole("button", { name: "Live Installation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Live System" })).toBeInTheDocument();
  });

  test("hides the mode switch and forces the live system view in installed mode", async () => {
    installerClient.getPreflight.mockResolvedValue({
      ...defaultPreflight,
      isLiveSession: false,
      checks: [
        {
          id: "live",
          label: "Sesion live",
          status: "error",
          detail: "No parece una sesion live soportada por el wrapper.",
        },
      ],
    });
    installerClient.getDisks.mockResolvedValue([singleDisk]);

    render(<App />);

    await screen.findByRole("heading", { name: "AgenOS" });
    expect(screen.queryByRole("button", { name: "Live Installation" })).not.toBeInTheDocument();
    expect(screen.getByText("Installed System")).toBeInTheDocument();
  });

  test("renders real preflight checks on the welcome slide", async () => {
    await renderLoadedApp();

    expect(screen.getByText("Memoria RAM")).toBeInTheDocument();
    expect(screen.getByText("UEFI")).toBeInTheDocument();
    expect(screen.getByText("64 GB")).toBeInTheDocument();
  });

  test("language preset updates timezone and keyboard defaults", async () => {
    await renderLoadedApp();
    await goToLanguage();

    fireEvent.click(screen.getByRole("button", { name: "Ingles (Estados Unidos)" }));

    expect(screen.getByLabelText("Zona horaria")).toHaveValue("America/New_York");
    expect(screen.getByLabelText("Layout de teclado")).toHaveValue("us");
  });

  test("blocks the disk step when no disk is selected", async () => {
    await renderLoadedApp([singleDisk, secondDisk]);
    await goToDisk();

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(
      await screen.findByText("Selecciona el disco que se borrara por completo."),
    ).toBeInTheDocument();
  });

  test("auto-selects the only available disk and lets the flow advance", async () => {
    await renderLoadedApp([singleDisk]);
    await goToIdentity();

    expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument();
  });

  test("shows Spanish local validation errors on the identity step", async () => {
    await renderLoadedApp([singleDisk]);
    await goToIdentity();

    fireEvent.change(screen.getByLabelText("Nombre de usuario"), {
      target: { value: "Bad User" },
    });
    fireEvent.change(screen.getByLabelText("Hostname"), {
      target: { value: "bad host" },
    });
    fireEvent.change(screen.getByLabelText("Contrasena"), {
      target: { value: "secret" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar contrasena"), {
      target: { value: "different" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(
      await screen.findByText(
        "El nombre de usuario debe empezar en minuscula y solo puede usar a-z, 0-9, _ o -.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "El hostname solo puede usar minusculas, numeros y guiones.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Las contrasenas no coinciden.")).toBeInTheDocument();
  });

  test("renders remote validation errors in the new identity UI", async () => {
    await renderLoadedApp([singleDisk]);
    await goToIdentity();
    await fillIdentity();

    installerClient.validateProfile.mockResolvedValueOnce({
      ok: false,
      errors: {
        username: "El username no es valido.",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByText("El username no es valido.")).toBeInTheDocument();
    expect(installerClient.launchGuided).not.toHaveBeenCalled();
  });

  test("launches guided mode from confirm and merges the normalized profile", async () => {
    await renderLoadedApp([singleDisk]);
    await goToIdentity();
    await fillIdentity();

    installerClient.validateProfile.mockResolvedValueOnce({
      ok: true,
      errors: {},
      normalizedProfile: normalizedProfile({
        user: {
          ...validProfile().user,
          fullName: "Ada Lovelace",
        },
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "Revision final antes del handoff" });

    fireEvent.click(screen.getByRole("button", { name: "Abrir Calamares guiado" }));

    await screen.findByRole("heading", { name: "Calamares toma el tramo final" });
    expect(installerClient.launchGuided).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({
          fullName: "Ada Lovelace",
        }),
      }),
    );
  });

  test("keeps the user on confirm when guided launch fails", async () => {
    await renderLoadedApp([singleDisk]);
    await goToIdentity();
    await fillIdentity();

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "Revision final antes del handoff" });

    installerClient.launchGuided.mockRejectedValueOnce(
      new Error("POST /api/installer/start-guided fallo: helper denegado"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Abrir Calamares guiado" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Revision final antes del handoff" })).toBeInTheDocument();
    });
    expect(screen.getByText("POST /api/installer/start-guided fallo: helper denegado")).toBeInTheDocument();
  });

  test("launches classic mode from the navigation bar", async () => {
    await renderLoadedApp([singleDisk]);

    fireEvent.click(screen.getByRole("button", { name: "Modo clasico" }));

    await screen.findByRole("heading", { name: "Calamares toma el tramo final" });
    expect(installerClient.launchClassic).toHaveBeenCalled();
  });

  test("restores the installer snapshot after remounting", async () => {
    installerClient.getPreflight.mockResolvedValue(defaultPreflight);
    installerClient.getDisks.mockResolvedValue([singleDisk]);
    installerClient.validateProfile.mockResolvedValue({
      ok: true,
      errors: {},
      normalizedProfile: normalizedProfile(),
    });
    installerClient.launchGuided.mockResolvedValue({
      ok: true,
      launched: true,
      message: "ok",
    });
    installerClient.launchClassic.mockResolvedValue({
      ok: true,
      launched: true,
      message: "ok",
    });
    installerClient.switchMode.mockResolvedValue({
      ok: true,
      message: "ok",
    });

    const firstRender = render(<App />);
    await screen.findByRole("heading", { name: "Instalador de AgenOS" });
    await screen.findByRole("heading", { name: "Todo listo para preparar la instalacion" });

    fireEvent.click(screen.getByRole("button", { name: "Empezar" }));
    await screen.findByRole("heading", { name: "Idioma, zona horaria y teclado" });
    fireEvent.change(screen.getByLabelText("Zona horaria"), {
      target: { value: "UTC" },
    });

    firstRender.unmount();

    render(<App />);

    await screen.findByRole("heading", { name: "Idioma, zona horaria y teclado" });
    expect(screen.getByLabelText("Zona horaria")).toHaveValue("UTC");
  });
});
