import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { TopBar } from "./TopBar";

function renderTopBar(overrides: Partial<React.ComponentProps<typeof TopBar>> = {}) {
  const props = {
    onChangeSection: vi.fn(),
    section: "home" as const,
    ...overrides,
  };

  render(<TopBar {...props} />);
  return props;
}

describe("TopBar", () => {
  test("marca la sección activa de forma programática, no solo por color", () => {
    renderTopBar({ section: "system" });

    expect(screen.getByRole("button", { name: "Sistema" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Inicio" })).not.toHaveAttribute("aria-current");
  });

  test("navega entre secciones", () => {
    const { onChangeSection } = renderTopBar();

    fireEvent.click(screen.getByRole("button", { name: "Sistema" }));

    expect(onChangeSection).toHaveBeenCalledWith("system");
  });

  // Antes la barra llevaba escritorios, modelo y estado de cuenta encima de la
  // pantalla de hablar. Ahora es solo navegación: lo demás vive en Sistema.
  test("no carga estado del equipo: solo los dos destinos", () => {
    renderTopBar();

    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByText("gpt-5.4-mini")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Escritorios")).not.toBeInTheDocument();
  });

  test("cuando algo necesita atención lo dice con palabras, no solo con un punto", () => {
    renderTopBar({ needsAttention: true });

    expect(screen.getByRole("button", { name: "Sistema, necesita atención" })).toBeInTheDocument();
  });

  test("sin nada que revisar la pestaña no avisa de nada", () => {
    renderTopBar();

    expect(screen.getByRole("button", { name: "Sistema" })).toBeInTheDocument();
  });
});
