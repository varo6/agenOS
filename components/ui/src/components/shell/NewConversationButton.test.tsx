import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { NewConversationButton } from "./NewConversationButton";

describe("NewConversationButton", () => {
  test("se llama por lo que hace, no por su símbolo", () => {
    const onStart = vi.fn();
    render(<NewConversationButton busy={false} onStart={onStart} />);

    fireEvent.click(screen.getByRole("button", { name: "Empezar una conversación nueva" }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  // Cortar un turno a medias dejaría a Pi escribiendo en un hilo que ya no está
  // en pantalla, así que mientras responde el botón no actúa.
  test("mientras Pi responde no empieza otra conversación", () => {
    const onStart = vi.fn();
    render(<NewConversationButton busy onStart={onStart} />);

    const button = screen.getByRole("button", {
      name: "Espera a que Pi termine para empezar otra conversación",
    });
    // Sigue siendo alcanzable: así un lector de pantalla puede leer el motivo.
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(button);
    expect(onStart).not.toHaveBeenCalled();
  });

  // El "+" a secas no se entiende sin haber vivido en interfaces de chat.
  test("el símbolo va acompañado del nombre de lo que hace", () => {
    render(<NewConversationButton busy={false} onStart={vi.fn()} />);

    expect(screen.getByText("Conversación nueva")).toBeInTheDocument();
  });
});
