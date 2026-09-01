import { describe, expect, test } from "bun:test";
import { createPackageInstallModelTool } from "./package-install-tool";

describe("apps_install model tool", () => {
  test("installs an explicit local request in one voice turn and streams progress", async () => {
    const calls: string[] = [];
    const updates: string[] = [];
    const tool = createPackageInstallModelTool({
      async requestInstall(query, onProgress) {
        calls.push(`request:${query}`);
        onProgress?.("Descargando los paquetes…");
        return {
          ok: true,
          status: "installed",
          packageName: "firefox-esr",
          displayName: "Firefox ESR",
          message: "Firefox ESR se ha instalado correctamente (firefox-esr).",
        };
      },
      async confirmInstall(confirmationId, onProgress) {
        calls.push(`confirm:${confirmationId}`);
        onProgress?.("Descargando los paquetes…");
        return {
          ok: true,
          status: "installed",
          packageName: "firefox-esr",
          message: "Firefox ESR se ha instalado correctamente (firefox-esr).",
        };
      },
      denyInstall: async () => ({ ok: true, status: "cancelled", message: "Instalación cancelada." }),
    });

    await expect(tool.execute(
      "call_request",
      { action: "request", app: "firefox" },
      undefined,
      (update) => updates.push(update.content[0]?.text ?? ""),
    )).resolves.toMatchObject({
      details: {
        ok: true,
        status: "installed",
      },
    });
    expect(calls).toEqual(["request:firefox"]);
    expect(updates).toEqual(["Buscando el paquete correcto en Debian…", "Descargando los paquetes…"]);
  });

  test("fails closed if the model tries to confirm during the original install turn", async () => {
    let confirmations = 0;
    const tool = createPackageInstallModelTool({
      requestInstall: async () => ({ ok: false, status: "confirmation_required", message: "¿Sigo?" }),
      confirmInstall: async () => {
        confirmations += 1;
        return { ok: true, status: "installed", message: "Instalado." };
      },
      denyInstall: async () => ({ ok: true, status: "cancelled", message: "Cancelado." }),
    });

    await expect(tool.execute("call_unsafe", { action: "confirm", confirmationId: "conf_1" }, undefined, undefined, {
      sessionManager: {
        getBranch: () => [{ type: "message", message: { role: "user", content: "Instala Firefox" } }],
      },
    })).resolves.toMatchObject({
      details: { ok: false, status: "confirmation_required" },
    });
    expect(confirmations).toBe(0);
  });
});
