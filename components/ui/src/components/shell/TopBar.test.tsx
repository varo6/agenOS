import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { TopBar } from "./TopBar";
import type { AgentWorkspace } from "../../lib/system-types";

const workspaces: AgentWorkspace[] = [
  { number: 1, name: "1:home", label: "Inicio" },
  { number: 2, name: "2:app", label: "Apps" },
];

function renderTopBar(overrides: Partial<React.ComponentProps<typeof TopBar>> = {}) {
  const props = {
    activeWorkspace: 1 as const,
    authState: "disconnected" as const,
    modelId: "gpt-5.4-mini",
    onChangeSection: vi.fn(),
    onFocusWorkspace: vi.fn(),
    section: "home" as const,
    workspaces,
    workspacesLive: false,
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

  test("dice en palabras el estado de la cuenta y oculta el modelo si no está conectada", () => {
    renderTopBar({ authState: "disconnected" });

    expect(screen.getByText("Sin conectar")).toBeInTheDocument();
    expect(screen.queryByText("gpt-5.4-mini")).not.toBeInTheDocument();
  });

  test("muestra el modelo en uso cuando la cuenta está conectada", () => {
    renderTopBar({ authState: "connected" });

    expect(screen.getByText("Conectado")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.4-mini")).toBeInTheDocument();
  });

  test("delega el cambio de escritorio en el conmutador", () => {
    const { onFocusWorkspace } = renderTopBar();

    fireEvent.click(screen.getByRole("button", { name: "Escritorio 2: Apps" }));

    expect(onFocusWorkspace).toHaveBeenCalledWith(2);
  });
});
