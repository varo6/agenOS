import { describe, expect, test } from "bun:test";
import { classifyAgentCommand, isBrokerCommand } from "./agent-command";

describe("agent command classifier", () => {
  test("detects explicit memory writes", () => {
    expect(classifyAgentCommand("recuerda que Pablo Lopez es mi profesor")).toEqual({
      kind: "memory",
      namespace: "facts",
      content: "Pablo Lopez es mi profesor",
    });
  });

  test("detects background delegation", () => {
    expect(classifyAgentCommand("manda esto al trabajador de fondo: prepara un email")).toEqual({
      kind: "background",
      message: "prepara un email",
    });
  });

  test("detects OpenClaw setup requests", () => {
    expect(classifyAgentCommand("haz un setup de openclaw")).toEqual({ kind: "openclaw-setup" });
    expect(classifyAgentCommand("configura OpenClaw para telegram")).toEqual({ kind: "openclaw-setup" });
    expect(classifyAgentCommand("quiero conectar telegram al backend")).toEqual({ kind: "openclaw-setup" });
  });

  test("leaves app launch requests for the foreground agent", () => {
    expect(classifyAgentCommand("abre Chrome")).toEqual({ kind: "foreground" });
    expect(classifyAgentCommand("ábreme el navegador")).toEqual({ kind: "foreground" });
  });

  test("falls back to foreground chat", () => {
    expect(classifyAgentCommand("hola")).toEqual({ kind: "foreground" });
  });

  test("distinguishes broker commands from foreground chat", () => {
    expect(isBrokerCommand(classifyAgentCommand("recuerda que Pablo Lopez es mi profesor"))).toBe(true);
    expect(isBrokerCommand(classifyAgentCommand("manda esto al trabajador de fondo: prepara un email"))).toBe(true);
    expect(isBrokerCommand(classifyAgentCommand("haz un setup de openclaw"))).toBe(true);
    expect(isBrokerCommand(classifyAgentCommand("abre Chrome"))).toBe(false);
    expect(isBrokerCommand(classifyAgentCommand("hola"))).toBe(false);
  });
});
