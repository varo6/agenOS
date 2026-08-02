import { describe, expect, test } from "bun:test";

import { resolveVoiceStatus, voiceButtonLabel, type VoiceStatusInput } from "./voice-status";

function input(overrides: Partial<VoiceStatusInput> = {}): VoiceStatusInput {
  return { capture: "idle", turn: "idle", ...overrides };
}

describe("resolveVoiceStatus", () => {
  test("en reposo invita a hablar y permite escuchar", () => {
    const status = resolveVoiceStatus(input());

    expect(status.phase).toBe("idle");
    expect(status.canListen).toBe(true);
    expect(status.busy).toBe(false);
    expect(status.title).toBe("Pulsa para hablar");
  });

  test("recorre el ciclo escuchar, transcribir, pensar, ejecutar y terminar", () => {
    expect(resolveVoiceStatus(input({ capture: "listening" })).phase).toBe("listening");
    expect(resolveVoiceStatus(input({ capture: "transcribing" })).phase).toBe("transcribing");
    expect(resolveVoiceStatus(input({ turn: "thinking" })).phase).toBe("thinking");
    expect(resolveVoiceStatus(input({ turn: "working" })).phase).toBe("working");
    expect(resolveVoiceStatus(input({ turn: "done" })).phase).toBe("done");
  });

  test("las fases en curso marcan ocupado y cierran el micrófono", () => {
    for (const state of [
      input({ capture: "listening" }),
      input({ capture: "transcribing" }),
      input({ turn: "thinking" }),
      input({ turn: "working" }),
    ]) {
      const status = resolveVoiceStatus(state);
      expect(status.busy).toBe(true);
      expect(status.canListen).toBe(false);
    }
  });

  test("al ejecutar una herramienta explica la acción sin nombrarla técnicamente", () => {
    const status = resolveVoiceStatus(input({ turn: "working", currentTool: "apps_open" }));

    expect(status.title).toBe("Pi está abriendo una aplicación");
    expect(status.title).not.toContain("apps_open");
  });

  test("una herramienta desconocida no filtra su nombre interno", () => {
    const status = resolveVoiceStatus(input({ turn: "working", currentTool: "quantum_flux" }));

    expect(status.title).toBe("Pi está trabajando en tu petición");
    expect(status.title).not.toContain("quantum_flux");
  });

  test("lo que ocurre ahora tiene prioridad sobre el motivo de bloqueo", () => {
    const status = resolveVoiceStatus(
      input({ turn: "working", currentTool: "files_open", blockedReason: "busy" }),
    );

    expect(status.phase).toBe("working");
  });

  test("sin conexión o sin cuenta explica el motivo y qué hacer", () => {
    const offline = resolveVoiceStatus(input({ blockedReason: "offline" }));
    expect(offline.phase).toBe("blocked");
    expect(offline.canListen).toBe(false);
    expect(offline.hint).toContain("wifi");

    const disconnected = resolveVoiceStatus(input({ blockedReason: "disconnected" }));
    expect(disconnected.phase).toBe("blocked");
    expect(disconnected.hint).toContain("ChatGPT");
  });

  test("el micrófono ausente gana a cualquier otro estado", () => {
    const status = resolveVoiceStatus(
      input({ capture: "unsupported", turn: "thinking", blockedReason: "offline" }),
    );

    expect(status.phase).toBe("unavailable");
    expect(status.canListen).toBe(false);
  });

  test("un fallo de captura muestra el motivo y deja reintentar", () => {
    const status = resolveVoiceStatus(
      input({ capture: "error", captureIssue: "No se detectó voz." }),
    );

    expect(status.phase).toBe("error");
    expect(status.hint).toBe("No se detectó voz.");
    expect(status.canListen).toBe(true);
  });

  test("un fallo del turno no deja reintentar si además hay bloqueo", () => {
    const status = resolveVoiceStatus(
      input({ turn: "error", turnIssue: "Se cortó la conexión.", blockedReason: "offline" }),
    );

    expect(status.phase).toBe("error");
    expect(status.canListen).toBe(false);
  });

  test("cada fase anuncia algo no vacío para aria-live", () => {
    const states: VoiceStatusInput[] = [
      input(),
      input({ capture: "listening" }),
      input({ capture: "transcribing" }),
      input({ turn: "thinking" }),
      input({ turn: "working", currentTool: "bash" }),
      input({ turn: "done" }),
      input({ capture: "error" }),
      input({ capture: "unsupported" }),
      input({ blockedReason: "offline" }),
    ];

    for (const state of states) {
      expect(resolveVoiceStatus(state).announcement.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("voiceButtonLabel", () => {
  test("describe la acción disponible en cada fase", () => {
    expect(voiceButtonLabel(resolveVoiceStatus(input()))).toBe("Hablar con Pi");
    expect(voiceButtonLabel(resolveVoiceStatus(input({ capture: "listening" })))).toContain("Escuchando");
    expect(voiceButtonLabel(resolveVoiceStatus(input({ turn: "thinking" })))).toContain("trabajando");
    expect(voiceButtonLabel(resolveVoiceStatus(input({ capture: "unsupported" })))).toContain(
      "no disponible",
    );
  });
});
