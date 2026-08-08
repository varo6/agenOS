import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { Alert } from "./Alert";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { Field } from "./Field";
import { Panel } from "./Panel";
import { Pill } from "./Pill";

describe("Button", () => {
  test("es de tipo button por defecto para no enviar formularios sin querer", () => {
    render(<Button>Guardar</Button>);
    expect(screen.getByRole("button", { name: "Guardar" })).toHaveAttribute("type", "button");
  });

  test("al cargar se deshabilita y se anuncia como ocupado", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Conectar
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Conectar" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  test("aplica la clase de la variante pedida", () => {
    render(<Button variant="primary">Enviar</Button>);
    expect(screen.getByRole("button", { name: "Enviar" })).toHaveClass("btn-primary");
  });

  // Un botón por debajo de 44px es inalcanzable para un dedo poco preciso, así
  // que ningún tamaño puede quedarse corto: `sm` es secundario, no pequeño.
  test("ningún tamaño baja del objetivo táctil de 44px", () => {
    const heights: Record<string, string> = { sm: "min-h-11", md: "min-h-12", lg: "min-h-14" };

    for (const [size, expected] of Object.entries(heights)) {
      const { unmount } = render(<Button size={size as "sm" | "md" | "lg"}>Conectar</Button>);
      expect(screen.getByRole("button", { name: "Conectar" })).toHaveClass(expected);
      unmount();
    }
  });
});

describe("Field", () => {
  test("asocia etiqueta, ayuda y error con el input", () => {
    render(<Field error="Falta el código." hint="Lo encontrarás en el navegador." label="Código" />);

    const input = screen.getByLabelText("Código");
    expect(input).toHaveAttribute("aria-invalid", "true");

    const describedBy = input.getAttribute("aria-describedby") ?? "";
    expect(describedBy).not.toBe("");
    const described = describedBy
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent)
      .join(" ");
    expect(described).toContain("Lo encontrarás en el navegador.");
    expect(described).toContain("Falta el código.");
  });

  test("mantiene el nombre accesible aunque la etiqueta esté oculta", () => {
    render(<Field hideLabel label="Mensaje para Pi" />);
    expect(screen.getByLabelText("Mensaje para Pi")).toBeInTheDocument();
  });
});

describe("Alert", () => {
  test("los errores usan role alert y ofrecen cierre y detalle plegado", () => {
    const onDismiss = vi.fn();
    render(
      <Alert details="ECONNREFUSED 127.0.0.1:4173" onDismiss={onDismiss} title="Pi no responde">
        Vuelve a intentarlo en unos segundos.
      </Alert>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Pi no responde");
    expect(screen.getByText("Vuelve a intentarlo en unos segundos.")).toBeInTheDocument();
    expect(screen.getByText("Detalle técnico")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test("los tonos no urgentes usan role status", () => {
    render(<Alert tone="info" title="Modo simulado" />);
    expect(screen.getByRole("status")).toHaveTextContent("Modo simulado");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Panel", () => {
  test("expone la cabecera como encabezado de sección", () => {
    render(<Panel description="Cómo está el sistema" eyebrow="Sistema" title="Estado" />);
    expect(screen.getByRole("heading", { name: "Estado" })).toBeInTheDocument();
    expect(screen.getByText("Cómo está el sistema")).toBeInTheDocument();
  });
});

describe("Pill y EmptyState", () => {
  test("la pastilla muestra el texto además del color", () => {
    render(
      <Pill dot tone="positive">
        Conectado
      </Pill>,
    );
    expect(screen.getByText("Conectado")).toBeInTheDocument();
  });

  test("el estado vacío explica la situación y ofrece una salida", () => {
    render(
      <EmptyState
        actions={<button type="button">Hablar con Pi</button>}
        description="Pulsa el micrófono para empezar."
        title="Todavía no hay conversación"
      />,
    );

    expect(screen.getByText("Todavía no hay conversación")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hablar con Pi" })).toBeInTheDocument();
  });
});
