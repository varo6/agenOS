import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ConversationPanel, type ConversationPanelProps } from "./ConversationPanel";
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

function renderPanel(props: Partial<ConversationPanelProps> = {}) {
  const onSaveToMemory = vi.fn();

  render(
    <ConversationPanel
      onSaveToMemory={onSaveToMemory}
      savedTurnIds={new Set()}
      savingTurnIds={new Set()}
      failedTurnIds={new Set()}
      turns={[]}
      {...props}
    />,
  );

  return { onSaveToMemory };
}

describe("ConversationPanel", () => {
  test("sin turnos explica cómo empezar en vez de dejar un hueco", () => {
    renderPanel();

    expect(screen.getByText("Todavía no habéis hablado")).toBeInTheDocument();
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
  });

  test("el historial es un log navegable, no una región en vivo", () => {
    renderPanel({ turns: [turn({ turnId: "t1", status: "succeeded", reply: "Listo." })] });

    const log = screen.getByRole("log");
    expect(log).toHaveAttribute("aria-label", "Conversación con Pi");
    expect(log).toHaveAttribute("tabindex", "0");
    expect(log).not.toHaveAttribute("aria-live");
  });

  test("un turno en curso dice qué está haciendo Pi, no solo que espera", () => {
    renderPanel({
      turns: [
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
      ],
    });

    expect(screen.getByText("Pi está abriendo una aplicación…")).toBeInTheDocument();
    expect(screen.getByText("Voy a abrirlo.")).toBeInTheDocument();
  });

  test("un turno en curso sin texto todavía no finge una respuesta", () => {
    renderPanel({ turns: [turn({ turnId: "t1", status: "processing" })] });

    expect(screen.getByText("Esperando la primera respuesta de Pi…")).toBeInTheDocument();
  });

  test("un turno fallido cuenta el motivo en su sitio", () => {
    renderPanel({
      turns: [turn({ turnId: "t1", status: "failed", error: "El servicio no respondió." })],
    });

    expect(screen.getByText("El servicio no respondió.")).toBeInTheDocument();
  });

  // El anuncio para lectores de pantalla lo hace `LatestReply`: dos regiones en
  // vivo con el mismo texto lo dirían todo dos veces.
  test("el historial no anuncia nada por su cuenta", () => {
    renderPanel({
      turns: [
        turn({ turnId: "t1", status: "succeeded", reply: "Primera." }),
        turn({ turnId: "t2", status: "succeeded", reply: "Segunda." }),
      ],
    });

    // Los acuses de los botones existen desde el principio, porque una región
    // en vivo que aparece con texto ya dentro no se anuncia; están vacíos hasta
    // que el usuario guarda algo.
    for (const status of screen.getAllByRole("status")) {
      expect(status).toHaveTextContent("");
    }
  });

  describe("guardar en memoria", () => {
    test("solo se ofrece bajo una respuesta terminada con éxito", () => {
      renderPanel({
        turns: [
          turn({ turnId: "t1", status: "succeeded", reply: "Ya está abierto." }),
          turn({ turnId: "t2", status: "processing" }),
          turn({ turnId: "t3", status: "failed", error: "No pude." }),
          turn({ turnId: "t4", status: "cancelled" }),
          turn({ turnId: "t5", status: "succeeded" }),
        ],
      });

      expect(screen.getAllByRole("button", { name: /Guardar en memoria/ })).toHaveLength(1);
    });

    test("al pulsarlo marca ese turno y no otro", () => {
      const { onSaveToMemory } = renderPanel({
        turns: [
          turn({ turnId: "t1", input: "abre Chrome", status: "succeeded", reply: "Hecho." }),
          turn({ turnId: "t2", input: "pon música", status: "succeeded", reply: "Suena." }),
        ],
      });

      fireEvent.click(screen.getByRole("button", { name: /respuesta a “pon música”/ }));

      expect(onSaveToMemory).toHaveBeenCalledTimes(1);
      expect(onSaveToMemory).toHaveBeenCalledWith("t2");
    });

    test("cada botón se llama por lo que se pidió, no todos igual", () => {
      renderPanel({
        turns: [
          turn({ turnId: "t1", input: "abre Chrome", status: "succeeded", reply: "Hecho." }),
          turn({
            turnId: "t2",
            input: "escríbele a Pablo que llego tarde a la cena de mañana",
            status: "succeeded",
            reply: "Enviado.",
          }),
        ],
      });

      expect(
        screen.getByRole("button", { name: "Guardar en memoria la respuesta a “abre Chrome”" }),
      ).toBeInTheDocument();
      // Peticiones largas se recortan: la etiqueta tiene que poder oírse.
      expect(
        screen.getByRole("button", {
          name: "Guardar en memoria la respuesta a “escríbele a Pablo que llego tarde…”",
        }),
      ).toBeInTheDocument();
    });

    test("mientras vuela dice que está guardando y no admite otra pulsación", () => {
      const { onSaveToMemory } = renderPanel({
        turns: [turn({ turnId: "t1", status: "succeeded", reply: "Hecho." })],
        savingTurnIds: new Set(["t1"]),
      });

      const button = screen.getByRole("button", { name: /Guardando en memoria/ });
      expect(button).toHaveTextContent("Guardando…");
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-busy", "true");

      fireEvent.click(button);
      expect(onSaveToMemory).not.toHaveBeenCalled();
    });

    test("una vez guardado lo dice en cristiano y se anuncia", () => {
      renderPanel({
        turns: [turn({ turnId: "t1", input: "abre Chrome", status: "succeeded", reply: "Hecho." })],
        savedTurnIds: new Set(["t1"]),
      });

      const button = screen.getByRole("button", { name: /Ya guardada en memoria/ });
      expect(button).toHaveTextContent("Lo tendré en cuenta");
      expect(button).toBeDisabled();

      const status = screen.getByRole("status");
      expect(status).toHaveAttribute("aria-live", "polite");
      expect(status).toHaveTextContent("Guardado. Tendré en cuenta cómo resolví “abre Chrome”.");
    });

    test("un fallo se muestra con discreción y permite reintentar", () => {
      const { onSaveToMemory } = renderPanel({
        turns: [turn({ turnId: "t1", status: "succeeded", reply: "Hecho." })],
        failedTurnIds: new Set(["t1"]),
      });

      expect(screen.getByText("No se pudo guardar. Puedes intentarlo de nuevo.")).toBeInTheDocument();
      const button = screen.getByRole("button", { name: /Guardar en memoria/ });
      expect(button).toBeEnabled();
      fireEvent.click(button);
      expect(onSaveToMemory).toHaveBeenCalledWith("t1");
    });

    test("el objetivo táctil no encoge por ser una acción secundaria", () => {
      renderPanel({ turns: [turn({ turnId: "t1", status: "succeeded", reply: "Hecho." })] });

      expect(screen.getByRole("button", { name: /Guardar en memoria/ })).toHaveClass("min-h-12");
    });
  });
});
