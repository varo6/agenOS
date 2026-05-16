import { describe, expect, test } from "bun:test";
import { decidePolicy } from "./policy";

describe("agent policy", () => {
  test("allows low-risk app and browser tools", () => {
    expect(decidePolicy({ tool: "apps.open", source: "ui" }).decision).toBe("allow");
    expect(decidePolicy({ tool: "browser.open_url", source: "ui" }).decision).toBe("allow");
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
  });

  test("requires confirmation for outbound sends and denies shell", () => {
    expect(decidePolicy({ tool: "outbound.send", source: "openclaw" })).toMatchObject({
      decision: "confirm",
      ruleId: "agent.outbound.background.confirm",
    });
    expect(decidePolicy({ tool: "shell.exec", source: "openclaw" })).toMatchObject({
      decision: "deny",
      ruleId: "agent.shell.deny",
    });
  });

  test("requires confirmation for admin mutations", () => {
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
});
