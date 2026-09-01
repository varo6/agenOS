import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { SystemClient } from "../../lib/system-client";
import { PowerPanel } from "./PowerPanel";

function stubClient(overrides: Partial<SystemClient> = {}) {
  return {
    getPreflight: vi.fn(),
    runMaintenance: vi.fn().mockResolvedValue({
      ok: true,
      message: "El sistema ha aceptado la orden de apagado.",
    }),
    switchMode: vi.fn(),
    getRuntimeInfo: vi.fn(),
    ...overrides,
  } as unknown as SystemClient;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

describe("PowerPanel", () => {
  test("ofrece apagar y reiniciar sin ejecutar nada al llegar", () => {
    const client = stubClient();
    render(<PowerPanel client={client} />);

    expect(screen.getByRole("button", { name: "Apagar el equipo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reiniciar el equipo" })).toBeInTheDocument();
    expect(client.runMaintenance).not.toHaveBeenCalled();
  });

  // Lo más caro de la pantalla no puede estar a un clic de distancia.
  test("el primer clic pregunta, no apaga", () => {
    const client = stubClient();
    render(<PowerPanel client={client} />);

    fireEvent.click(screen.getByRole("button", { name: "Apagar el equipo" }));

    expect(client.runMaintenance).not.toHaveBeenCalled();
    expect(screen.getByText("¿Apagar el equipo? Se cerrará todo lo que esté abierto.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sí, apagar" })).toBeInTheDocument();
  });

  test("la confirmación manda la acción tipada, nunca un comando", async () => {
    const client = stubClient();
    render(<PowerPanel client={client} />);

    fireEvent.click(screen.getByRole("button", { name: "Apagar el equipo" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, apagar" }));

    await waitFor(() => expect(client.runMaintenance).toHaveBeenCalledWith("poweroff"));
    expect(client.runMaintenance).toHaveBeenCalledTimes(1);
  });

  test("reiniciar recorre el mismo camino con su propia acción", async () => {
    const client = stubClient({
      runMaintenance: vi.fn().mockResolvedValue({
        ok: true,
        message: "El sistema ha aceptado la orden de reinicio.",
      }),
    });
    render(<PowerPanel client={client} />);

    fireEvent.click(screen.getByRole("button", { name: "Reiniciar el equipo" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, reiniciar" }));

    await waitFor(() => expect(client.runMaintenance).toHaveBeenCalledWith("reboot"));
    expect(await screen.findByText("El sistema ha aceptado la orden de reinicio.")).toBeInTheDocument();
  });

  test("cancelar deja el equipo como estaba", () => {
    const client = stubClient();
    render(<PowerPanel client={client} />);

    fireEvent.click(screen.getByRole("button", { name: "Apagar el equipo" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(client.runMaintenance).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Apagar el equipo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sí, apagar" })).not.toBeInTheDocument();
  });

  // Mientras el servicio no conteste, lo único honesto es decir que se ha
  // pedido. Dar por hecho el apagado antes de tiempo es mentir en la pantalla.
  test("mientras el servicio no contesta no da nada por hecho", async () => {
    const pendingCall = deferred<{ ok: true; message: string }>();
    const client = stubClient({
      runMaintenance: vi.fn().mockReturnValue(pendingCall.promise),
    });
    render(<PowerPanel client={client} />);

    fireEvent.click(screen.getByRole("button", { name: "Apagar el equipo" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, apagar" }));

    expect(await screen.findByText("Pidiendo al sistema que se apague…")).toBeInTheDocument();
    expect(screen.queryByText(/ha aceptado/)).not.toBeInTheDocument();
    // Y nadie puede pedir un segundo apagado por el camino.
    expect(screen.getByRole("button", { name: "Reiniciar el equipo" })).toBeDisabled();

    pendingCall.resolve({
      ok: true,
      message: "El sistema ha aceptado la orden de apagado.",
    });

    expect(await screen.findByText("El sistema ha aceptado la orden de apagado.")).toBeInTheDocument();
  });

  test("si el servicio falla lo dice y no finge que se apagó", async () => {
    const client = stubClient({
      runMaintenance: vi.fn().mockRejectedValue(new Error("El helper salió con código 126.")),
    });
    render(<PowerPanel client={client} />);

    fireEvent.click(screen.getByRole("button", { name: "Apagar el equipo" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, apagar" }));

    expect(await screen.findByText("El helper salió con código 126.")).toBeInTheDocument();
    expect(screen.queryByText(/ha aceptado/)).not.toBeInTheDocument();
    // Y se puede volver a intentar.
    expect(screen.getByRole("button", { name: "Apagar el equipo" })).toBeEnabled();
  });

  test("el resultado se anuncia solo, sin tener que ir a buscarlo", async () => {
    const client = stubClient();
    render(<PowerPanel client={client} />);

    fireEvent.click(screen.getByRole("button", { name: "Apagar el equipo" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, apagar" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });
});
