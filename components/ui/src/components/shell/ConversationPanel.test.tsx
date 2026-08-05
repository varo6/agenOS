import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { ConversationPanel } from "./ConversationPanel";
import type { PiTurnState } from "../../lib/pi-types";

function turn(overrides: Partial<PiTurnState> & Pick<PiTurnState, "turnId" | "status">): PiTurnState {
  return {
    input: "abre Chrome",
    source: "voice",
    startedAt: "2026-07-03T12:00:00.000Z",
    progress: {
      startedAt: "2026-07-03T12:00:00.000Z",
      streamedText: "",
      currentTool: null,
      completedTools: [],
    },
    ...overrides,
  };
}

describe("ConversationPanel", () => {
  test("sin turnos explica cómo empezar en vez de dejar un hueco", () => {
    render(<ConversationPanel turns={[]} />);

    expect(screen.getByText("Todavía no habéis hablado")).toBeInTheDocument();
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
  });

  test("el historial es un log navegable, no una región en vivo", () => {
    render(<ConversationPanel turns={[turn({ turnId: "t1", status: "succeeded", reply: "Listo." })]} />);

    const log = screen.getByRole("log");
    expect(log).toHaveAttribute("aria-label", "Conversación con Pi");
    expect(log).toHaveAttribute("tabindex", "0");
  });

  test("un turno en curso dice qué está haciendo Pi, no solo que espera", () => {
    render(
      <ConversationPanel
        turns={[
          turn({
            turnId: "t1",
            status: "processing",
            progress: {
              startedAt: "2026-07-03T12:00:00.000Z",
              streamedText: "Voy a abrirlo.",
              currentTool: "apps_open",
              completedTools: [],
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Pi está abriendo una aplicación…")).toBeInTheDocument();
    expect(screen.getByText("Voy a abrirlo.")).toBeInTheDocument();
  });

  test("un turno en curso sin texto todavía no finge una respuesta", () => {
    render(<ConversationPanel turns={[turn({ turnId: "t1", status: "processing" })]} />);

    expect(screen.getByText("Esperando la primera respuesta de Pi…")).toBeInTheDocument();
  });

  test("un turno fallido cuenta el motivo en su sitio", () => {
    render(
      <ConversationPanel
        turns={[turn({ turnId: "t1", status: "failed", error: "El servicio no respondió." })]}
      />,
    );

    expect(screen.getByText("El servicio no respondió.")).toBeInTheDocument();
  });

  test("solo se anuncia la última respuesta terminada, no el streaming", () => {
    render(
      <ConversationPanel
        turns={[
          turn({ turnId: "t1", status: "succeeded", reply: "Primera." }),
          turn({ turnId: "t2", status: "succeeded", reply: "Segunda." }),
          turn({ turnId: "t3", status: "processing" }),
        ]}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Pi responde: Segunda.");
  });
});
