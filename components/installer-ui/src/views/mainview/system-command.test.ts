import { describe, expect, test } from "vitest";

import { interpretSystemCommand, normalizeSystemCommand } from "./system-command";

describe("interpretSystemCommand", () => {
  test("recognizes the maintenance terminal command", () => {
    expect(interpretSystemCommand("abre terminal de mantenimiento")).toEqual({
      ok: true,
      intent: "open_maintenance_terminal",
      action: "terminal",
      summary: "Abrir terminal de mantenimiento",
    });
  });

  test("recognizes the short terminal command", () => {
    expect(interpretSystemCommand("terminal")).toEqual({
      ok: true,
      intent: "open_maintenance_terminal",
      action: "terminal",
      summary: "Abrir terminal de mantenimiento",
    });
  });

  test("normalizes accents and extra whitespace", () => {
    expect(normalizeSystemCommand("  Ábre   términal   de   mantenimiento  ")).toBe(
      "abre terminal de mantenimiento",
    );
  });

  test("rejects unsupported commands", () => {
    expect(interpretSystemCommand("abre fotos")).toEqual({
      ok: false,
      message: "No he entendido el comando. Prueba con 'abre terminal de mantenimiento'.",
    });
  });
});
