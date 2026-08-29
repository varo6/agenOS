import { describe, expect, test } from "bun:test";

import { createBrokerPiTools } from "./broker-pi-tools";

function unavailablePackageService() {
  return {
    requestInstall: async () => ({ ok: false, status: "not_found", message: "No encontrado." }),
    confirmInstall: async () => ({ ok: false, status: "failed", message: "Sin confirmación." }),
    denyInstall: () => ({ ok: true, status: "cancelled", message: "Cancelado." }),
  };
}

function stubGoogleSend() {
  return {
    request: async () => ({ ok: true, status: "completed" as const, message: "ok" }),
    confirm: async () => ({ ok: true, status: "completed" as const, message: "ok" }),
    deny: () => ({ ok: true, status: "cancelled" as const, message: "cancelado" }),
  } as never;
}

describe("broker-mediated Pi tools", () => {
  test("exposes the full set of broker-mediated computer tools", () => {
    const tools = createBrokerPiTools({
      toolRunner: { run: async () => ({ ok: false, decision: "deny" as const }) } as never,
      googleSend: stubGoogleSend(),
      packageService: unavailablePackageService(),
      captureTrace: async () => undefined,
    });

    expect(tools.modelTools).toEqual([
      "browser_open",
      "apps_open",
      "apps_install",
      "files_open",
      "files_manage",
      "computer_run",
      "web_control",
      "desktop_control",
      "google_workspace",
      "openclaw_setup",
      "agent_task",
      "learning_memory",
      "improvements",
    ]);
    // Las capacidades nativas del harness siguen fuera: todo efecto pasa por el
    // broker, incluida la shell, que se expone como computer_run y no como bash.
    expect(tools.modelTools).not.toContain("bash");
    expect(tools.modelTools).not.toContain("edit");
    expect(tools.modelTools).not.toContain("write");
  });

  test("routes app opening through the broker runner with a fixed UI identity", async () => {
    const calls: unknown[] = [];
    const tools = createBrokerPiTools({
      toolRunner: {
        run: async (input: unknown) => {
          calls.push(input);
          return {
            ok: true,
            decision: "allow" as const,
            output: { ok: true, appId: "photos", message: "Fotos abierta." },
          };
        },
      } as never,
      googleSend: stubGoogleSend(),
      packageService: unavailablePackageService(),
      captureTrace: async () => undefined,
    });
    const appTool = tools.customTools.find((tool) => tool.name === "apps_open");

    await expect(appTool?.execute("call_1", { app: "Fotos", workspace: 4, focus: true })).resolves.toMatchObject({
      details: { ok: true, appId: "photos" },
    });
    expect(calls).toEqual([{
      source: "ui",
      tool: "apps.open",
      input: { app: "Fotos", workspace: 4, focus: true },
      explicitUserIntent: false,
    }]);
  });

  test("does not execute past a broker denial", async () => {
    const tools = createBrokerPiTools({
      toolRunner: {
        run: async () => ({
          ok: false,
          decision: "deny" as const,
          message: "Tool no permitida.",
        }),
      } as never,
      googleSend: stubGoogleSend(),
      packageService: unavailablePackageService(),
      captureTrace: async () => undefined,
    });
    const fileTool = tools.customTools.find((tool) => tool.name === "files_open");

    await expect(fileTool?.execute("call_2", { path: "/etc/shadow" })).rejects.toThrow("Tool no permitida.");
  });

  test("routes package requests through the broker package service", async () => {
    const calls: string[] = [];
    const tools = createBrokerPiTools({
      toolRunner: { run: async () => ({ ok: false, decision: "deny" as const }) } as never,
      googleSend: stubGoogleSend(),
      packageService: {
        ...unavailablePackageService(),
        async requestInstall(query: string) {
          calls.push(query);
          return {
            ok: false,
            status: "confirmation_required",
            confirmationId: "conf_firefox",
            message: "Voy a instalar Firefox ESR (firefox-esr). ¿Sigo?",
          };
        },
      },
      captureTrace: async () => undefined,
    });
    const installTool = tools.customTools.find((tool) => tool.name === "apps_install");

    await expect(installTool?.execute("call_install", { action: "request", app: "firefox" })).resolves.toMatchObject({
      details: { status: "confirmation_required", confirmationId: "conf_firefox" },
    });
    expect(calls).toEqual(["firefox"]);
  });
});
