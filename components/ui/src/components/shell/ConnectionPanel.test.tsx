import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ConnectionPanel, type ConnectionPanelProps } from "./ConnectionPanel";
import type { PiPendingAttempt } from "../../lib/pi-types";

const deviceAttempt: PiPendingAttempt = {
  attemptId: "att_1",
  method: "device",
  url: "https://auth.openai.com/codex/device",
  instructions: "Abre el enlace y escribe el código.",
  expiresAt: "2026-04-21T00:10:00.000Z",
  userCode: "ABCD-EFGH",
};

function renderPanel(overrides: Partial<ConnectionPanelProps> = {}) {
  const props: ConnectionPanelProps = {
    authState: "disconnected",
    busy: false,
    manualCode: "",
    modelId: "gpt-5.4-mini",
    onCancelAuth: vi.fn(),
    onConnect: vi.fn(),
    onLogout: vi.fn(),
    onManualCodeChange: vi.fn(),
    onRefresh: vi.fn(),
    onSubmitManualCode: vi.fn(),
    pendingAttempt: null,
    providerName: "ChatGPT/Codex",
    ready: true,
    ...overrides,
  };

  render(<ConnectionPanel {...props} />);
  return props;
}

describe("ConnectionPanel", () => {
  test("explica en llano qué falta cuando la cuenta no está conectada", () => {
    const props = renderPanel();

    expect(screen.getByText("Conecta ChatGPT para empezar.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Conectar ChatGPT" }));
    expect(props.onConnect).toHaveBeenCalledTimes(1);
  });

  test("con la cuenta conectada la acción principal es reconectar", () => {
    renderPanel({ authState: "connected" });

    expect(screen.getByText("Ya puedes hablar con Pi.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconectar ChatGPT" })).toBeInTheDocument();
  });

  // El proveedor y el modelo salieron de la barra fija: son ficha técnica y su
  // sitio es esta tarjeta, al margen y no en el titular.
  test("la ficha técnica de la cuenta acompaña al panel, no a la pantalla de hablar", () => {
    renderPanel({ authState: "connected" });

    expect(screen.getByRole("heading", { name: "Tu cuenta" })).toBeInTheDocument();
    expect(screen.getByText(/gpt-5\.4-mini/)).toBeInTheDocument();
    expect(screen.getByText(/ChatGPT\/Codex/)).toBeInTheDocument();
  });

  test("mientras autoriza, el botón se anuncia como ocupado y no se puede repetir", () => {
    const props = renderPanel({ authState: "authorizing", pendingAttempt: deviceAttempt });

    const connect = screen.getByRole("button", { name: "Conectar ChatGPT" });
    expect(connect).toHaveAttribute("aria-busy", "true");
    fireEvent.click(connect);
    expect(props.onConnect).not.toHaveBeenCalled();
  });

  test("guía el login por código en dos pasos y deja copiarlo", () => {
    const writeText = vi.fn();
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderPanel({ authState: "authorizing", pendingAttempt: deviceAttempt });

    expect(screen.getByText("Abre el enlace y escribe el código.")).toBeInTheDocument();
    expect(screen.getByText("Paso 1: abre este enlace")).toBeInTheDocument();
    expect(screen.getByText("ABCD-EFGH")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /auth\.openai\.com/ })).toHaveAttribute(
      "href",
      deviceAttempt.url,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copiar" }));
    expect(writeText).toHaveBeenCalledWith("ABCD-EFGH");
  });

  test("espera al código sin dejar copiar un hueco vacío", () => {
    renderPanel({
      authState: "authorizing",
      pendingAttempt: { ...deviceAttempt, userCode: undefined },
    });

    expect(screen.getByText("Esperando código…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar" })).toBeDisabled();
  });

  test("el fallback manual tiene campo etiquetado y envía el código", () => {
    const props = renderPanel({
      authState: "authorizing",
      pendingAttempt: { ...deviceAttempt, method: "browser", userCode: undefined },
      manualCode: "abc",
    });

    const field = screen.getByLabelText("Pegar el enlace o el código");
    expect(field).toHaveValue("abc");

    fireEvent.change(field, { target: { value: "http://localhost:1455/auth/callback?code=1" } });
    expect(props.onManualCodeChange).toHaveBeenCalledWith(
      "http://localhost:1455/auth/callback?code=1",
    );

    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }));
    expect(props.onSubmitManualCode).toHaveBeenCalledTimes(1);
  });

  test("cancelar solo existe mientras hay un login en curso", () => {
    const props = renderPanel({ authState: "authorizing", pendingAttempt: deviceAttempt });

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(props.onCancelAuth).toHaveBeenCalledTimes(1);
  });

  test("sin login en curso no se ofrece cancelar", () => {
    renderPanel();

    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
  });

  test("con el servicio caído no se ofrece ninguna acción de cuenta", () => {
    renderPanel({ ready: false });

    expect(screen.getByRole("button", { name: "Conectar ChatGPT" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Actualizar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeDisabled();
  });

  test("refrescar y cerrar sesión llegan a sus manejadores", () => {
    const props = renderPanel({ authState: "connected" });

    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    expect(props.onLogout).toHaveBeenCalledTimes(1);
  });
});
