import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { VoiceConsole } from "./VoiceConsole";
import { resolveVoiceStatus, voiceButtonLabel, type VoiceStatusInput } from "../../lib/voice-status";

function renderConsole(
  input: VoiceStatusInput,
  handlers: { onActivate?: () => void; onFinish?: () => void; size?: "full" | "compact" } = {},
) {
  const status = resolveVoiceStatus(input);
  const onActivate = handlers.onActivate ?? vi.fn();
  const onFinish = handlers.onFinish ?? vi.fn();

  render(
    <VoiceConsole
      buttonLabel={voiceButtonLabel(status)}
      onActivate={onActivate}
      onFinish={onFinish}
      size={handlers.size}
      status={status}
    />,
  );

  return { status, onActivate, onFinish };
}

describe("VoiceConsole", () => {
  test("muestra la fase con texto, no solo con color", () => {
    renderConsole({ capture: "listening", turn: "idle" });

    expect(screen.getByText("Te escucho")).toBeInTheDocument();
    expect(screen.getByText("Habla con calma.")).toBeInTheDocument();
  });

  test("anuncia cada fase por aria-live para quien no ve la pantalla", () => {
    const { status } = renderConsole({ capture: "transcribing", turn: "idle" });

    const live = screen.getByRole("status");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent(status.announcement);
  });

  test("el botón se nombra según lo que hace en cada momento", () => {
    renderConsole({ capture: "idle", turn: "idle" });
    expect(screen.getByRole("button", { name: "Hablar con Pi" })).toBeInTheDocument();
  });

  test("en reposo activa el micrófono", () => {
    const onActivate = vi.fn();
    renderConsole({ capture: "idle", turn: "idle" }, { onActivate });

    fireEvent.click(screen.getByRole("button"));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  test("mientras escucha, pulsar termina la captura para procesarla", () => {
    const onActivate = vi.fn();
    const onFinish = vi.fn();
    renderConsole({ capture: "listening", turn: "idle" }, { onActivate, onFinish });

    fireEvent.click(screen.getByRole("button"));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  test("cuando no se puede hablar sigue siendo alcanzable pero no actúa", () => {
    const onActivate = vi.fn();
    renderConsole({ capture: "idle", turn: "idle", blockedReason: "offline" }, { onActivate });

    const button = screen.getByRole("button");
    // Permanece enfocable para que un lector de pantalla pueda leer el motivo.
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(button);
    expect(onActivate).not.toHaveBeenCalled();
    expect(screen.getByText("Sin internet")).toBeInTheDocument();
  });

  // Encogido cede las dos líneas al texto de la respuesta, pero no la fase: esa
  // la sigue anunciando, y quien lo coloca la pinta a su lado.
  test("encogido sigue siendo el mismo botón y sigue anunciando la fase", () => {
    const onActivate = vi.fn();
    const { status } = renderConsole(
      { capture: "idle", turn: "idle" },
      { onActivate, size: "compact" },
    );

    const button = screen.getByRole("button", { name: "Hablar con Pi" });
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledTimes(1);

    expect(screen.getByRole("status")).toHaveTextContent(status.announcement);
    expect(screen.queryByText("O escríbele aquí abajo.")).not.toBeInTheDocument();
  });

  test("mientras Pi trabaja explica la acción en lenguaje llano", () => {
    renderConsole({ capture: "idle", turn: "working", currentTool: "files_open" });

    expect(screen.getByText("Pi está abriendo un archivo")).toBeInTheDocument();
    expect(screen.queryByText(/files_open/)).not.toBeInTheDocument();
  });
});
