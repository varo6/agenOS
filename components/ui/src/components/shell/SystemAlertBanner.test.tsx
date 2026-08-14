import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { SystemAlertBanner } from "./SystemAlertBanner";
import { toUserError } from "../../lib/user-errors";

function renderBanner(alert: ReturnType<typeof toUserError>) {
  const handlers = {
    onCheckNetwork: vi.fn(),
    onDismiss: vi.fn(),
    onOpenSystem: vi.fn(),
    onReconnect: vi.fn(),
    onRetry: vi.fn(),
  };

  render(<SystemAlertBanner alert={alert} {...handlers} />);
  return handlers;
}

describe("SystemAlertBanner", () => {
  test("cuenta qué ha pasado y guarda el mensaje técnico como detalle", () => {
    renderBanner(toUserError(new Error("Failed to fetch")));

    expect(screen.getByText("AgenOS no responde ahora mismo")).toBeInTheDocument();
    expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
  });

  test("un fallo grave se anuncia como alerta", () => {
    renderBanner(toUserError(new Error("Failed to fetch")));

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  test("ofrece reconectar la cuenta cuando la sesión ha caducado", () => {
    const handlers = renderBanner(toUserError(new Error("no autorizado"), { status: 401 }));

    fireEvent.click(screen.getByRole("button", { name: "Conectar ChatGPT" }));

    expect(handlers.onReconnect).toHaveBeenCalledTimes(1);
    expect(handlers.onRetry).not.toHaveBeenCalled();
  });

  test("ofrece revisar la red cuando no hay internet", () => {
    const handlers = renderBanner(toUserError("Sin conexión a internet.", { kind: "offline" }));

    fireEvent.click(screen.getByRole("button", { name: "Comprobar la red" }));

    expect(handlers.onCheckNetwork).toHaveBeenCalledTimes(1);
  });

  test("ofrece abrir Sistema cuando el fallo no se puede clasificar", () => {
    const handlers = renderBanner(toUserError(new Error("boom")));

    fireEvent.click(screen.getByRole("button", { name: "Abrir Sistema" }));

    expect(handlers.onOpenSystem).toHaveBeenCalledTimes(1);
  });

  test("reintenta por defecto y se puede descartar", () => {
    const handlers = renderBanner(toUserError(new Error("tiempo limite agotado")));

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));

    expect(handlers.onRetry).toHaveBeenCalledTimes(1);
    expect(handlers.onDismiss).toHaveBeenCalledTimes(1);
  });
});
