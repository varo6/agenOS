import { describe, expect, test } from "bun:test";

import { createBrokerPiTools } from "./broker-pi-tools";

describe("broker-mediated Pi tools", () => {
  test("exposes no native shell, edit, write, or package-install capabilities", () => {
    const tools = createBrokerPiTools({
      toolRunner: { run: async () => ({ ok: false, decision: "deny" as const }) } as never,
      captureTrace: async () => undefined,
    });

    expect(tools.modelTools).toEqual([
      "browser_open",
      "apps_open",
      "files_open",
      "openclaw_setup",
      "agent_task",
      "learning_memory",
    ]);
    expect(tools.modelTools).not.toContain("bash");
    expect(tools.modelTools).not.toContain("edit");
    expect(tools.modelTools).not.toContain("write");
    expect(tools.modelTools).not.toContain("apps_install");
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
      captureTrace: async () => undefined,
    });
    const fileTool = tools.customTools.find((tool) => tool.name === "files_open");

    await expect(fileTool?.execute("call_2", { path: "/etc/shadow" })).rejects.toThrow("Tool no permitida.");
  });
});
