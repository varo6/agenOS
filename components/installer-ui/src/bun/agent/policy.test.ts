import { describe, expect, test } from "bun:test";
import { decidePolicy } from "./policy";

describe("agent policy", () => {
  test("allows low-risk app and browser tools", () => {
    expect(decidePolicy({ tool: "apps.open", source: "ui" }).decision).toBe("allow");
    expect(decidePolicy({ tool: "browser.open_url", source: "ui" }).decision).toBe("allow");
    expect(decidePolicy({ tool: "workspaces.focus", source: "openclaw" }).decision).toBe("allow");
  });

  test("allows explicit UI memory writes but asks OpenClaw to confirm memory writes", () => {
    expect(decidePolicy({ tool: "memory.write", source: "ui", explicitUserIntent: true })).toMatchObject({
      decision: "allow",
      ruleId: "agent.memory.ui.allow",
    });
    expect(decidePolicy({ tool: "memory.write", source: "openclaw", explicitUserIntent: false })).toMatchObject({
      decision: "confirm",
      ruleId: "agent.memory.background.confirm",
    });
    expect(decidePolicy({ tool: "memory.write", source: "system", explicitUserIntent: false })).toMatchObject({
      decision: "confirm",
      ruleId: "agent.memory.learning.confirm",
    });
  });

  test("requires confirmation for outbound sends and denies agent shell", () => {
    expect(decidePolicy({ tool: "outbound.send", source: "openclaw" })).toMatchObject({
      decision: "confirm",
      ruleId: "agent.outbound.background.confirm",
    });
    expect(decidePolicy({ tool: "shell.exec", source: "openclaw", input: { command: "systemctl status ssh" } })).toMatchObject({
      decision: "deny",
      ruleId: "agent.shell.agent.deny",
    });
  });

  test("denies destructive worker shell commands instead of creating an executable request", () => {
    expect(decidePolicy({ tool: "shell.exec", source: "openclaw", input: { command: "rm -rf ~/Documentos" } })).toMatchObject({
      decision: "deny",
      ruleId: "agent.shell.agent.deny",
    });
  });

  test("requires confirmation for admin mutations even when they come from the UI", () => {
    expect(decidePolicy({ tool: "admin.config.write", source: "ui" })).toMatchObject({
      decision: "confirm",
      ruleId: "agent.admin.config.confirm",
    });
    expect(decidePolicy({ tool: "admin.service.restart", source: "ui" })).toMatchObject({
      decision: "confirm",
      ruleId: "agent.admin.restart.confirm",
    });
    expect(decidePolicy({ tool: "admin.queue.clear", source: "ui" })).toMatchObject({
      decision: "confirm",
      ruleId: "agent.admin.queue.clear.confirm",
    });
  });

  test("installs directly for explicit local requests and confirms non-interactive requests", () => {
    expect(decidePolicy({ tool: "packages.install", source: "ui", explicitUserIntent: true })).toMatchObject({
      decision: "allow",
      ruleId: "agent.packages.install.ui.allow",
    });
    for (const source of ["ui", "openclaw", "system"] as const) {
      expect(decidePolicy({ tool: "packages.install", source })).toMatchObject({
        decision: "confirm",
        ruleId: "agent.packages.install.confirm",
      });
    }
  });

  test("allows ordinary UI shell but still confirms destructive UI shell", () => {
    expect(decidePolicy({ tool: "shell.exec", source: "ui", input: { command: "id" }, explicitUserIntent: true })).toMatchObject({
      decision: "allow",
      ruleId: "agent.shell.local.allow",
    });
    expect(decidePolicy({ tool: "shell.exec", source: "ui", input: { command: "rm -rf ~/Documentos" }, explicitUserIntent: true })).toMatchObject({
      decision: "confirm",
      ruleId: "agent.shell.destructive.confirm",
    });
  });

  test("denies unknown UI tools instead of treating the frontend as superuser", () => {
    expect(decidePolicy({ tool: "packages.add-repository", source: "ui", explicitUserIntent: true })).toMatchObject({
      decision: "deny",
      ruleId: "agent.default.deny",
    });
  });

  test("lets the user drive keyboard and mouse but never a background agent", () => {
    expect(decidePolicy({ tool: "desktop.input", source: "ui" })).toMatchObject({
      decision: "allow",
      ruleId: "agent.desktop.input.ui.allow",
    });
    expect(decidePolicy({ tool: "desktop.input", source: "openclaw" })).toMatchObject({
      decision: "deny",
      ruleId: "agent.desktop.input.agent.deny",
    });
    expect(decidePolicy({ tool: "desktop.inspect", source: "ui" }).decision).toBe("allow");
    expect(decidePolicy({ tool: "desktop.screenshot", source: "ui" }).decision).toBe("allow");
  });

  test("allows writing inside the user's home and confirms writing outside it", () => {
    expect(decidePolicy({ tool: "files.write", source: "ui", input: { path: "~/Documentos/carta.txt" } })).toMatchObject({
      decision: "allow",
      ruleId: "agent.files.write.home.allow",
    });
    expect(decidePolicy({ tool: "files.write", source: "ui", input: { path: "notas.txt" } }).decision).toBe("allow");
    expect(decidePolicy({ tool: "files.write", source: "ui", input: { path: "/etc/passwd" } })).toMatchObject({
      decision: "confirm",
      ruleId: "agent.files.write.outside-home.confirm",
    });
    expect(decidePolicy({ tool: "files.write", source: "ui", input: { path: "../../etc/hosts" } }).decision).toBe("confirm");
  });

  test("reads Google data freely but confirms anything sent on the user's behalf", () => {
    expect(decidePolicy({ tool: "google.read", source: "ui" }).decision).toBe("allow");
    expect(decidePolicy({ tool: "google.auth", source: "ui" }).decision).toBe("allow");
    expect(decidePolicy({ tool: "google.send", source: "ui" })).toMatchObject({
      decision: "confirm",
      ruleId: "agent.google.send.confirm",
    });
    expect(decidePolicy({ tool: "google.send", source: "openclaw" }).decision).toBe("confirm");
  });

  test("allows web control from the user session", () => {
    expect(decidePolicy({ tool: "web.control", source: "ui" }).decision).toBe("allow");
  });
});
