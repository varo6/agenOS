import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { Composer, type ComposerProps } from "./Composer";

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  const props: ComposerProps = {
    busy: false,
    disabled: false,
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    value: "",
    ...overrides,
  };

  render(<Composer {...props} />);
  return props;
}

describe("Composer", () => {
  test("el campo tiene nombre accesible aunque la etiqueta no se vea", () => {
    renderComposer();

    expect(screen.getByLabelText("Escribe a Pi")).toBeInTheDocument();
  });

  test("no se puede enviar un mensaje vacío ni en blanco", () => {
    renderComposer({ value: "   " });

    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
  });

  test("enviar el formulario manda el borrador una sola vez", () => {
    const props = renderComposer({ value: "abre Chrome" });

    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  test("escribir informa del borrador sin enviarlo", () => {
    const props = renderComposer();

    fireEvent.change(screen.getByLabelText("Escribe a Pi"), { target: { value: "hola" } });

    expect(props.onChange).toHaveBeenCalledWith("hola");
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  test("mientras Pi responde el botón se anuncia como ocupado", () => {
    renderComposer({ busy: true, value: "hola" });

    expect(screen.getByRole("button", { name: "Enviar" })).toHaveAttribute("aria-busy", "true");
  });

  test("un campo deshabilitado explica por qué y lo asocia al input", () => {
    renderComposer({
      disabled: true,
      disabledReason: "Conecta tu cuenta de ChatGPT para escribirle a Pi.",
      value: "hola",
    });

    const input = screen.getByLabelText("Escribe a Pi");
    expect(input).toBeDisabled();

    const hintId = input.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(hintId)?.textContent).toBe(
      "Conecta tu cuenta de ChatGPT para escribirle a Pi.",
    );
  });

  test("deshabilitado no envía aunque se fuerce el submit", () => {
    const props = renderComposer({ disabled: true, value: "hola" });

    fireEvent.submit(screen.getByLabelText("Escribe a Pi").closest("form")!);

    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  test("sin motivo de bloqueo no añade ayuda bajo el campo", () => {
    renderComposer();

    expect(screen.getByLabelText("Escribe a Pi")).not.toHaveAttribute("aria-describedby");
  });
});
