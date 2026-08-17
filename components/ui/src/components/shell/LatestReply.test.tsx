import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { LatestReply } from "./LatestReply";
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

describe("LatestReply", () => {
  test("sin turnos no ocupa sitio", () => {
    const { container } = render(<LatestReply turns={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  test("destaca la respuesta del último turno, no la primera del historial", () => {
    render(
      <LatestReply
        turns={[
          turn({ turnId: "t1", status: "succeeded", reply: "Primera." }),
          turn({ turnId: "t2", status: "succeeded", reply: "Segunda." }),
        ]}
      />,
    );

    const destacado = screen.getByLabelText("Lo último que ha dicho Pi");
    expect(destacado).toHaveTextContent("Segunda.");
    expect(destacado).not.toHaveTextContent("Primera.");
  });

  test("mientras Pi trabaja se ve lo que lleva dicho y qué está haciendo", () => {
    render(
      <LatestReply
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
    render(<LatestReply turns={[turn({ turnId: "t1", status: "processing" })]} />);

    expect(screen.getByText("Pi está preparando lo que va a decir…")).toBeInTheDocument();
  });

  test("un fallo se lee igual de grande que una respuesta", () => {
    render(
      <LatestReply
        turns={[turn({ turnId: "t1", status: "failed", error: "El servicio no respondió." })]}
      />,
    );

    expect(screen.getByText("El servicio no respondió.")).toBeInTheDocument();
  });

  // El streaming no se anuncia: cada fragmento cortaría al anterior y el lector
  // de pantalla se volvería inservible mientras Pi responde.
  test("solo se anuncia la última respuesta terminada, no el streaming", () => {
    render(
      <LatestReply
        turns={[
          turn({ turnId: "t1", status: "succeeded", reply: "Primera." }),
          turn({ turnId: "t2", status: "succeeded", reply: "Segunda." }),
          turn({
            turnId: "t3",
            status: "processing",
            progress: {
              startedAt: "2026-07-03T12:00:00.000Z",
              streamedText: "Estoy en ello",
              currentTool: null,
              completedTools: [],
            },
          }),
        ]}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Pi responde: Segunda.");
  });
});
