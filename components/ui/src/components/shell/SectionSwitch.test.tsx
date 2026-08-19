import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { SectionSwitch } from "./SectionSwitch";

function renderSwitch(overrides: Partial<React.ComponentProps<typeof SectionSwitch>> = {}) {
  const props = {
    onChangeSection: vi.fn(),
    section: "home" as const,
    ...overrides,
  };

  render(<SectionSwitch {...props} />);
  return props;
}

describe("SectionSwitch", () => {
  // Inicio no es un destino, es la pantalla: no hay pestaña que lo anuncie.
  test("desde Inicio solo ofrece un camino: Sistema", () => {
    renderSwitch();

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Sistema" })).toBeInTheDocument();
  });

  test("lleva a Sistema", () => {
    const { onChangeSection } = renderSwitch();

    fireEvent.click(screen.getByRole("button", { name: "Sistema" }));

    expect(onChangeSection).toHaveBeenCalledWith("system");
  });

  test("desde Sistema el mismo sitio es la vuelta a Inicio", () => {
    const { onChangeSection } = renderSwitch({ section: "system" });

    fireEvent.click(screen.getByRole("button", { name: "Inicio" }));

    expect(onChangeSection).toHaveBeenCalledWith("home");
  });

  // Antes la barra llevaba escritorios, modelo y estado de cuenta encima de la
  // pantalla de hablar. Ahora no hay barra: lo demás vive en Sistema.
  test("no carga estado del equipo", () => {
    renderSwitch();

    expect(screen.queryByText("gpt-5.4-mini")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Escritorios")).not.toBeInTheDocument();
  });

  test("cuando algo necesita atención lo dice con palabras, no solo con un punto", () => {
    renderSwitch({ needsAttention: true });

    expect(screen.getByRole("button", { name: "Sistema, necesita atención" })).toBeInTheDocument();
  });

  // Ya estás mirando la máquina: repetir el aviso encima de la flecha de volver
  // no añade nada y ensucia el único botón que queda.
  test("dentro de Sistema el aviso ya no insiste", () => {
    renderSwitch({ needsAttention: true, section: "system" });

    expect(screen.getByRole("button", { name: "Inicio" })).toBeInTheDocument();
  });

  test("sin nada que revisar el botón no avisa de nada", () => {
    renderSwitch();

    expect(screen.getByRole("button", { name: "Sistema" })).toBeInTheDocument();
  });
});
