import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { VoiceConsole } from "./VoiceConsole";
import { resolveVoiceStatus, voiceButtonLabel, type VoiceStatusInput } from "../../lib/voice-status";

function renderConsole(input: VoiceStatusInput, handlers: { onActivate?: () => void; onCancel?: () => void } = {}) {
  const status = resolveVoiceStatus(input);
  const onActivate = handlers.onActivate ?? vi.fn();
  const onCancel = handlers.onCancel ?? vi.fn();

  render(
    <VoiceConsole
      buttonLabel={voiceButtonLabel(status)}
      onActivate={onActivate}
      onCancel={onCancel}
      status={status}
    />,
  );

  return { status, onActivate, onCancel };
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

  test("mientras escucha, pulsar cancela en vez de volver a empezar", () => {
    const onActivate = vi.fn();
    const onCancel = vi.fn();
    renderConsole({ capture: "listening", turn: "idle" }, { onActivate, onCancel });

    fireEvent.click(screen.getByRole("button"));
    expect(onCancel).toHaveBeenCalledTimes(1);
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

  test("mientras Pi trabaja explica la acción en lenguaje llano", () => {
    renderConsole({ capture: "idle", turn: "working", currentTool: "files_open" });

    expect(screen.getByText("Pi está abriendo un archivo")).toBeInTheDocument();
    expect(screen.queryByText(/files_open/)).not.toBeInTheDocument();
  });
});
