import { describe, expect, test } from "bun:test";

import { classifyError, describeClientError, toUserError } from "./user-errors";

describe("describeClientError", () => {
  test("devuelve el mensaje del error o un texto de respaldo", () => {
    expect(describeClientError(new Error("boom"))).toBe("boom");
    expect(describeClientError("  texto suelto  ")).toBe("texto suelto");
    expect(describeClientError(null)).toBe("No se pudo completar la acción.");
    expect(describeClientError({})).toBe("No se pudo completar la acción.");
  });
});

describe("classifyError", () => {
  test("usa el código HTTP cuando está disponible", () => {
    expect(classifyError(new Error("nope"), 401)).toBe("unauthorized");
    expect(classifyError(new Error("nope"), 403)).toBe("unauthorized");
    expect(classifyError(new Error("nope"), 404)).toBe("lostTurn");
  });

  test("lee el status del propio error", () => {
    const error = Object.assign(new Error("no autorizado"), { status: 401 });
    expect(classifyError(error)).toBe("unauthorized");
  });

  test("reconoce el servicio caído y el tiempo agotado", () => {
    expect(classifyError(new Error("Failed to fetch"))).toBe("unreachable");
    expect(classifyError(new Error("connect ECONNREFUSED 127.0.0.1:4173"))).toBe("unreachable");
    expect(classifyError(new Error("La solicitud al broker excedio el tiempo limite."))).toBe("timeout");
  });

  test("reconoce los fallos de login de Codex", () => {
    expect(classifyError(new Error("codex login --device-auth termino con codigo 1."))).toBe("login");
  });

  test("reconoce la falta de internet aunque el mensaje lleve tildes", () => {
    expect(classifyError(new Error("Sin conexión a internet."))).toBe("offline");
    expect(classifyError(new Error("Sin internet"))).toBe("offline");
  });

  test("lo que no encaja cae en desconocido", () => {
    expect(classifyError(new Error("algo raro ha pasado"))).toBe("unknown");
  });
});

describe("toUserError", () => {
  test("convierte un fallo técnico en qué ha pasado y qué hacer", () => {
    const userError = toUserError(new Error("Failed to fetch"));

    expect(userError.kind).toBe("unreachable");
    expect(userError.title).toBe("AgenOS no responde ahora mismo");
    expect(userError.hint.length).toBeGreaterThan(0);
    expect(userError.action).toBe("retry");
  });

  test("conserva el mensaje original como detalle para soporte", () => {
    expect(toUserError(new Error("Failed to fetch")).details).toBe("Failed to fetch");
  });

  test("no repite el detalle cuando coincide con el titular", () => {
    expect(toUserError("Sin internet").details).toBe(null);
  });

  test("respeta una clasificación forzada por quien llama", () => {
    const userError = toUserError(new Error("cualquier cosa"), { kind: "lostTurn" });

    expect(userError.kind).toBe("lostTurn");
    expect(userError.action).toBe("retry");
  });

  test("ninguna copia deja frases vacías ni nombres técnicos en el titular", () => {
    const samples = [
      new Error("Failed to fetch"),
      new Error("codex login --device-auth termino con codigo 1."),
      Object.assign(new Error("unauthorized"), { status: 401 }),
      new Error("Sin conexión a internet."),
      new Error("otra cosa"),
    ];

    for (const sample of samples) {
      const userError = toUserError(sample);
      expect(userError.title.trim().length).toBeGreaterThan(0);
      expect(userError.hint.trim().length).toBeGreaterThan(0);
      expect(userError.title).not.toContain("fetch");
      expect(userError.title).not.toContain("--");
    }
  });
});
