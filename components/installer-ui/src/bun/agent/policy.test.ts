import { describe, expect, test } from "bun:test";
import { decidePolicy } from "./policy";

describe("agent policy", () => {
  test("allows low-risk app and browser tools", () => {
    expect(decidePolicy({ tool: "apps.open", source: "ui" }).decision).toBe("allow");
    expect(decidePolicy({ tool: "browser.open_url", source: "ui" }).decision).toBe("allow");
  });

  test("allows explicit UI memory writes but asks OpenClaw to confirm memory writes", () => {
    expect(decidePolicy({ tool: "memory.write", source: "ui", explicitUserIntent: true }).decision).toBe("allow");
    expect(decidePolicy({ tool: "memory.write", source: "openclaw", explicitUserIntent: false }).decision).toBe("confirm");
  });

  test("requires confirmation for outbound sends and denies shell", () => {
    expect(decidePolicy({ tool: "mail.send", source: "openclaw" }).decision).toBe("confirm");
    expect(decidePolicy({ tool: "shell.exec", source: "openclaw" })).toEqual({
      decision: "deny",
      reason: "La ejecucion shell arbitraria no esta permitida en este MVP.",
    });
  });
});
