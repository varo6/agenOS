import { describe, expect, test } from "bun:test";
import { createPackageInstaller } from "./package-installer";

const input = {
  packageName: "firefox-esr",
  displayName: "Firefox ESR",
  requestedName: "firefox",
  version: "128.8.0esr-1~deb12u1",
  component: "main" as const,
  selectionReason: "Alias curado de Debian 12.",
};

describe("privileged package installer adapter", () => {
  test("runs only the typed helper path and reports real progress and completion", async () => {
    const calls: unknown[] = [];
    const progress: string[] = [];
    const installer = createPackageInstaller({
      catalog: { isInstalled: async () => false },
      getuid: () => 1000,
      async runHelper(command, args, onOutput) {
        calls.push({ command, args });
        onOutput("Reading package lists... Done");
        onOutput("Get:1 http://deb.debian.org firefox-esr");
        onOutput("Setting up firefox-esr (128.8.0esr-1~deb12u1)");
        return {
          exitCode: 0,
          stdout: "AGENOS_PACKAGE_RESULT installed firefox-esr\n",
          stderr: "",
        };
      },
    });

    await expect(installer.install(input, (message) => progress.push(message))).resolves.toEqual({
      ok: true,
      status: "installed",
      packageName: "firefox-esr",
      displayName: "Firefox ESR",
      message: "Firefox ESR se ha instalado correctamente (firefox-esr).",
    });
    expect(calls).toEqual([{
      command: "sudo",
      args: ["-n", "/usr/local/bin/agenos-shell-helper", "install-package", "firefox-esr"],
    }]);
    expect(progress).toEqual([
      "Instalando el paquete con permisos del sistema…",
      "Comprobando el catálogo de paquetes…",
      "Descargando los paquetes…",
      "Instalando la aplicación…",
      "Instalación terminada.",
    ]);
  });

  test("falls back to pkexec only when passwordless sudo cannot elevate", async () => {
    const calls: unknown[] = [];
    const installer = createPackageInstaller({
      catalog: { isInstalled: async () => false },
      getuid: () => 1000,
      async runHelper(command, args) {
        calls.push({ command, args });
        return command === "sudo"
          ? { exitCode: 1, stdout: "", stderr: "sudo: a password is required" }
          : { exitCode: 0, stdout: "AGENOS_PACKAGE_RESULT installed firefox-esr\n", stderr: "" };
      },
    });

    await expect(installer.install(input)).resolves.toMatchObject({ ok: true, status: "installed" });
    expect(calls).toEqual([
      {
        command: "sudo",
        args: ["-n", "/usr/local/bin/agenos-shell-helper", "install-package", "firefox-esr"],
      },
      {
        command: "pkexec",
        args: ["/usr/local/bin/agenos-shell-helper", "install-package", "firefox-esr"],
      },
    ]);
  });

  test("runs the typed helper directly when the broker is root", async () => {
    const calls: unknown[] = [];
    const installer = createPackageInstaller({
      catalog: { isInstalled: async () => false },
      getuid: () => 0,
      async runHelper(command, args) {
        calls.push({ command, args });
        return { exitCode: 0, stdout: "AGENOS_PACKAGE_RESULT installed firefox-esr\n", stderr: "" };
      },
    });

    await expect(installer.install(input)).resolves.toMatchObject({ ok: true, status: "installed" });
    expect(calls).toEqual([{
      command: "/usr/local/bin/agenos-shell-helper",
      args: ["install-package", "firefox-esr"],
    }]);
  });

  test("returns already installed without invoking the privileged helper", async () => {
    let helperCalls = 0;
    const installer = createPackageInstaller({
      catalog: { isInstalled: async () => true },
      runHelper: async () => {
        helperCalls += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    await expect(installer.install(input)).resolves.toMatchObject({
      ok: true,
      status: "already_installed",
      message: expect.stringContaining("ya estaba instalado"),
    });
    expect(helperCalls).toBe(0);
  });

  test("rejects an injected package name before starting a privileged helper", async () => {
    let helperCalls = 0;
    const installer = createPackageInstaller({
      catalog: { isInstalled: async () => false },
      runHelper: async () => {
        helperCalls += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    await expect(installer.install({ ...input, packageName: "vlc;reboot" })).resolves.toMatchObject({
      ok: false,
      status: "failed",
      message: expect.stringContaining("nombre de paquete Debian válido"),
    });
    expect(helperCalls).toBe(0);
  });

  test("distinguishes a network failure from a completed installation", async () => {
    const installer = createPackageInstaller({
      catalog: { isInstalled: async () => false },
      runHelper: async () => ({
        exitCode: 100,
        stdout: "",
        stderr: "Temporary failure resolving 'deb.debian.org'\nE: Failed to fetch package",
      }),
    });

    await expect(installer.install(input)).resolves.toMatchObject({
      ok: false,
      status: "network_unavailable",
      message: expect.stringContaining("No se pudo descargar Firefox ESR"),
    });
  });

  test("reports a package that disappeared between resolution and execution", async () => {
    const installer = createPackageInstaller({
      catalog: { isInstalled: async () => false },
      runHelper: async () => ({
        exitCode: 4,
        stdout: "AGENOS_PACKAGE_RESULT not-found firefox-esr\n",
        stderr: "The package has no exact candidate",
      }),
    });

    await expect(installer.install(input)).resolves.toMatchObject({
      ok: false,
      status: "not_found",
      message: expect.stringContaining("no se instaló nada"),
    });
  });
});
