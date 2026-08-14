import { describe, expect, test } from "bun:test";

import { describeTool, describeTurnActivity, hasToolLabel } from "./agent-activity";
import type { PiTurnProgress } from "./pi-types";

function progress(overrides: Partial<PiTurnProgress> = {}): PiTurnProgress {
  return {
    startedAt: "2026-08-13T10:00:00.000Z",
    streamedText: "",
    currentTool: null,
    completedTools: [],
    ...overrides,
  };
}

describe("describeTool", () => {
  test("traduce las herramientas conocidas a lenguaje llano", () => {
    expect(describeTool("apps_open")).toBe("abriendo una aplicación");
    expect(describeTool("files_open")).toBe("abriendo un archivo");
    expect(hasToolLabel("apps_open")).toBe(true);
  });

  test("una herramienta desconocida no expone su nombre interno", () => {
    expect(describeTool("internal_thing")).toBe("trabajando en tu petición");
    expect(hasToolLabel("internal_thing")).toBe(false);
  });
});

describe("describeTurnActivity", () => {
  test("sin turno no hay actividad", () => {
    expect(describeTurnActivity(null)).toBe(null);
    expect(describeTurnActivity(undefined)).toBe(null);
  });

  test("prioriza la herramienta en curso", () => {
    expect(describeTurnActivity(progress({ currentTool: "bash" }))).toBe(
      "Pi está ejecutando una tarea del sistema…",
    );
  });

  test("tras usar herramientas indica que está revisando resultados", () => {
    expect(describeTurnActivity(progress({ completedTools: ["read"] }))).toBe(
      "Pi está revisando lo que ha encontrado…",
    );
  });

  test("sin herramientas está pensando", () => {
    expect(describeTurnActivity(progress())).toBe("Pi está pensando…");
  });
});
