import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfirmationStore } from "./confirmations";
import { createPackageService } from "./package-service";
import { createToolRunner } from "./tool-runner";
import type { PackageResolution } from "./package-resolver";

function resolved(installed = false): PackageResolution {
  return {
    ok: true,
    status: "resolved",
    index: { available: true, updatedAt: "2026-08-13T10:00:00.000Z" },
    package: {
      packageName: "firefox-esr",
      displayName: "Firefox ESR",
      requestedName: "firefox",
      version: "128.8.0esr-1~deb12u1",
      summary: "Mozilla Firefox web browser - Extended Support Release",
      priority: "optional",
      pinPriority: 500,
      section: "web",
      component: "main",
      installed,
      resolution: "alias",
      selectionReason: "El alias «firefox» corresponde a firefox-esr en Debian 12.",
      alternatives: [],
    },
  };
}

describe("confirmed package installation flow", () => {
  test("keeps confirmation available for a non-interactive source", async () => {
    const confirmations = createConfirmationStore({
      rootDir: mkdtempSync(join(tmpdir(), "agenos-package-confirm-")),
      idFactory: () => "conf_firefox",
      now: () => new Date("2026-08-13T10:00:00.000Z"),
    });
    const installs: unknown[] = [];
    const installer = {
      async install(input: unknown, onProgress?: (message: string) => void) {
        installs.push(input);
        onProgress?.("Descargando los paquetes…");
        return {
          ok: true,
          status: "installed" as const,
          packageName: "firefox-esr",
          displayName: "Firefox ESR",
          message: "Firefox ESR se ha instalado correctamente (firefox-esr).",
        };
      },
    };
    const runner = createToolRunner({
      confirmations,
      handlers: {
        "packages.install": (input, context) => installer.install(input, context.onProgress),
      },
    });
    const service = createPackageService({
      resolver: { resolve: async () => resolved(), clearCache() {} },
      installer: installer as never,
      toolRunner: runner,
      confirmations,
      openApp: async (app) => ({ ok: true, message: `Abriendo ${app}.` }),
    });

    await expect(service.requestInstall("firefox", undefined, "openclaw")).resolves.toMatchObject({
      ok: false,
      status: "confirmation_required",
      confirmationId: "conf_firefox",
      packageName: "firefox-esr",
      message: "Voy a instalar Firefox ESR (firefox-esr). ¿Sigo?",
    });
    expect(installs).toEqual([]);
    expect(confirmations.get("conf_firefox")).toMatchObject({
      status: "pending",
      summary: "Voy a instalar Firefox ESR (firefox-esr), ¿sigo?",
      tool: "packages.install",
    });

    const progress: string[] = [];
    await expect(service.confirmInstall("conf_firefox", (message) => progress.push(message))).resolves.toMatchObject({
      ok: true,
      status: "installed",
      packageName: "firefox-esr",
      opened: { ok: true, message: "Abriendo Firefox ESR." },
      message: expect.stringContaining("Abriendo Firefox ESR."),
    });
    expect(progress).toEqual(["Descargando los paquetes…"]);
    expect(installs).toHaveLength(1);

    await expect(service.confirmInstall("conf_firefox")).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("ya fue confirmada"),
    });
    expect(installs).toHaveLength(1);
  });

  test("does not ask for confirmation or elevate when the package is already installed", async () => {
    const confirmations = createConfirmationStore({ rootDir: mkdtempSync(join(tmpdir(), "agenos-package-installed-")) });
    const opened: string[] = [];
    const service = createPackageService({
      resolver: { resolve: async () => resolved(true), clearCache() {} },
      installer: { install: async () => { throw new Error("must not run"); } } as never,
      toolRunner: createToolRunner(),
      confirmations,
      openApp: async (app) => {
        opened.push(app);
        return { ok: true, message: `Abriendo ${app}.` };
      },
    });

    await expect(service.requestInstall("firefox")).resolves.toMatchObject({
      ok: true,
      status: "already_installed",
      opened: { ok: true },
    });
    expect(confirmations.list()).toEqual([]);
    expect(opened).toEqual(["Firefox ESR"]);
  });

  test("returns not found without creating a meaningless confirmation", async () => {
    const confirmations = createConfirmationStore({ rootDir: mkdtempSync(join(tmpdir(), "agenos-package-missing-")) });
    const service = createPackageService({
      resolver: {
        clearCache() {},
        resolve: async () => ({
          ok: false as const,
          status: "not_found" as const,
          query: "unknown app",
          message: "No encuentro un paquete razonable.",
          index: { available: true },
        }),
      },
      installer: { install: async () => { throw new Error("must not run"); } } as never,
      toolRunner: createToolRunner(),
      confirmations,
    });

    await expect(service.requestInstall("unknown app")).resolves.toMatchObject({
      ok: false,
      status: "not_found",
    });
    expect(confirmations.list()).toEqual([]);
  });
});
