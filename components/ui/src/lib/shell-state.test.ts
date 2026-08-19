import { describe, expect, test } from "bun:test";

import {
  describeComposerBlock,
  isAgentBusy,
  needsSystemAttention,
  resolveAgentState,
  resolveBlockedReason,
  resolveShellReadiness,
} from "./shell-state";

const idle = { conversationState: "idle" as const, sessionBusy: false, currentTool: null };

describe("resolveAgentState", () => {
  test("en reposo no hay nada que anunciar", () => {
    expect(resolveAgentState(idle)).toBe("idle");
  });

  test("procesar sin herramienta es pensar", () => {
    expect(resolveAgentState({ ...idle, conversationState: "processing" })).toBe("thinking");
  });

  test("procesar con herramienta es ejecutar", () => {
    expect(
      resolveAgentState({ ...idle, conversationState: "processing", currentTool: "apps_open" }),
    ).toBe("working");
  });

  test("el servicio ocupado por otra vía también cuenta como trabajo", () => {
    expect(resolveAgentState({ ...idle, sessionBusy: true })).toBe("thinking");
    expect(isAgentBusy({ ...idle, sessionBusy: true })).toBe(true);
  });

  test("un turno fallido se queda en error hasta que se reintenta", () => {
    expect(resolveAgentState({ ...idle, conversationState: "error" })).toBe("error");
  });

  test("un turno nuevo tapa el error anterior", () => {
    expect(resolveAgentState({ ...idle, conversationState: "processing" })).toBe("thinking");
  });
});

describe("resolveBlockedReason", () => {
  test("sin red comprobada se asume bloqueo, no permiso", () => {
    expect(resolveBlockedReason({ online: null, authState: "connected", busy: false })).toBe(
      "offline",
    );
  });

  test("la red manda sobre la cuenta", () => {
    expect(resolveBlockedReason({ online: false, authState: "disconnected", busy: true })).toBe(
      "offline",
    );
  });

  test("con red pero sin cuenta el bloqueo es la sesión", () => {
    expect(resolveBlockedReason({ online: true, authState: "disconnected", busy: false })).toBe(
      "disconnected",
    );
  });

  test("con todo listo y un turno en curso el bloqueo es temporal", () => {
    expect(resolveBlockedReason({ online: true, authState: "connected", busy: true })).toBe("busy");
  });

  test("con todo listo no hay bloqueo", () => {
    expect(resolveBlockedReason({ online: true, authState: "connected", busy: false })).toBeNull();
  });
});

describe("describeComposerBlock", () => {
  test("un servicio caído se explica antes que cualquier otra causa", () => {
    expect(describeComposerBlock("busy", false)).toContain("no responde");
  });

  test("cada motivo de bloqueo dice qué hacer", () => {
    expect(describeComposerBlock("offline", true)).toContain("Sin internet");
    expect(describeComposerBlock("disconnected", true)).toContain("Conecta tu cuenta");
    expect(describeComposerBlock("busy", true)).toContain("espera");
  });

  test("sin bloqueo no se añade ruido bajo el campo", () => {
    expect(describeComposerBlock(null, true)).toBeNull();
  });
});

describe("resolveShellReadiness", () => {
  const ready = {
    harnessAvailable: true,
    backendError: null,
    adminStatus: { readiness: "ready" as const },
    authState: "connected" as const,
  };

  test("todo en orden deja la pantalla libre para hablar", () => {
    expect(resolveShellReadiness(ready)).toBe("ready");
  });

  test("sin lectura del backend todavía no se acusa a nadie", () => {
    expect(resolveShellReadiness({ ...ready, adminStatus: null })).toBe("checking");
  });

  test("el servicio caído bloquea aunque no haya lectura del backend", () => {
    expect(resolveShellReadiness({ ...ready, adminStatus: null, harnessAvailable: false })).toBe(
      "blocked",
    );
    expect(resolveShellReadiness({ ...ready, adminStatus: null, backendError: "Failed to fetch" })).toBe(
      "blocked",
    );
  });

  test("un worker por configurar no bloquea el Pi foreground conectado", () => {
    expect(resolveShellReadiness({ ...ready, adminStatus: { readiness: "needs_setup" } })).toBe(
      "ready",
    );
  });

  // Degradado no es fatal: el servicio sigue atendiendo turnos, así que quitar
  // la pantalla de hablar por eso castigaría a la persona sin motivo.
  test("un servicio degradado no impide hablar con Pi", () => {
    expect(resolveShellReadiness({ ...ready, adminStatus: { readiness: "degraded" } })).toBe(
      "ready",
    );
  });

  test("falta conectar la cuenta aunque el backend esté listo", () => {
    expect(resolveShellReadiness({ ...ready, authState: "disconnected" })).toBe("blocked");
  });
});

describe("needsSystemAttention", () => {
  const ready = {
    harnessAvailable: true,
    backendError: null,
    adminStatus: { readiness: "ready" as const },
    authState: "connected" as const,
  };

  test("con todo en orden el botón de Sistema no avisa de nada", () => {
    expect(needsSystemAttention(ready)).toBe(false);
  });

  test("mientras no hay lectura tampoco se avisa: sería una alarma falsa", () => {
    expect(needsSystemAttention({ ...ready, adminStatus: null })).toBe(false);
  });

  // Es el caso que justifica la señal: no bloquea, pero nadie entraría a verlo.
  test("un servicio degradado se señala aunque deje hablar", () => {
    expect(needsSystemAttention({ ...ready, adminStatus: { readiness: "degraded" } })).toBe(true);
  });

  test("el servicio caído y la cuenta sin conectar también se señalan", () => {
    expect(needsSystemAttention({ ...ready, harnessAvailable: false, adminStatus: null })).toBe(true);
    expect(needsSystemAttention({ ...ready, authState: "disconnected" })).toBe(true);
  });
});
