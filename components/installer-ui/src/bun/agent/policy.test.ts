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
      ruleId: "agent.ui.superuser.allow",
    });
    expect(decidePolicy({ tool: "memory.write", source: "openclaw", explicitUserIntent: false })).toMatchObject({
      decision: "confirm",
      ruleId: "agent.memory.background.confirm",
    });
  });

  test("requires confirmation for outbound sends and allows ordinary local shell", () => {
    expect(decidePolicy({ tool: "outbound.send", source: "openclaw" })).toMatchObject({
      decision: "confirm",
      ruleId: "agent.outbound.background.confirm",
    });
    expect(decidePolicy({ tool: "shell.exec", source: "openclaw", input: { command: "systemctl status ssh" } })).toMatchObject({
      decision: "allow",
      ruleId: "agent.shell.local.allow",
    });
  });

  test("requires confirmation for destructive worker shell commands", () => {
    expect(decidePolicy({ tool: "shell.exec", source: "openclaw", input: { command: "rm -rf ~/Documentos" } })).toMatchObject({
      decision: "confirm",
      ruleId: "agent.shell.destructive.confirm",
    });
  });

  test("allows admin mutations from the frontend superuser", () => {
    expect(decidePolicy({ tool: "admin.config.write", source: "ui" })).toMatchObject({
      decision: "allow",
      ruleId: "agent.ui.superuser.allow",
    });
    expect(decidePolicy({ tool: "admin.service.restart", source: "ui" })).toMatchObject({
      decision: "allow",
      ruleId: "agent.ui.superuser.allow",
    });
    expect(decidePolicy({ tool: "admin.queue.clear", source: "ui" })).toMatchObject({
      decision: "allow",
      ruleId: "agent.ui.superuser.allow",
    });
  });

  test("allows shell from the frontend superuser", () => {
    expect(decidePolicy({ tool: "shell.exec", source: "ui", explicitUserIntent: true })).toMatchObject({
      decision: "allow",
      ruleId: "agent.ui.superuser.allow",
    });
  });
});
