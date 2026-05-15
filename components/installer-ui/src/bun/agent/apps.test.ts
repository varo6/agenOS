import { describe, expect, test } from "bun:test";
import { sanitizeDesktopExec } from "./apps";

describe("app tool", () => {
  test("removes desktop field codes", () => {
    expect(sanitizeDesktopExec("chromium %U")).toEqual(["chromium"]);
  });

  test("preserves quoted arguments", () => {
    expect(sanitizeDesktopExec('chromium --new-window "https://netflix.com"')).toEqual([
      "chromium",
      "--new-window",
      "https://netflix.com",
    ]);
  });

  test("rejects empty exec lines", () => {
    expect(() => sanitizeDesktopExec("%U")).toThrow("El Exec del .desktop no contiene ningun comando ejecutable.");
  });
});
