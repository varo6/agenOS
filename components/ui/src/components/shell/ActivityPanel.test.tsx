import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ActivityPanel } from "./ActivityPanel";
import { useActivity } from "../../hooks/useActivity";
import type { ActivityClient, ConfirmationResult, WorkerTask } from "../../lib/activity-client";
import type { AgentConfirmation } from "../../lib/system-types";

const approval: AgentConfirmation = {
  schemaVersion: 1, confirmationId: "c1", correlationId: "corr1", taskId: "t1",
  timestamp: "2026-09-07T12:00:00Z", source: "ui", status: "pending", tool: "google.send",
  summary: "Enviar el informe a Ana", input: { action: "sendMessage", input: {
    to: "ana@example.com", subject: "Informe", body: "Este es el informe completo.", bcc: "archivo@example.com",
    accessToken: "secret-never-render",
  } },
};
const task: WorkerTask = {
  schemaVersion: 1, taskId: "t1", correlationId: "corr1", timestamp: approval.timestamp,
  source: "ui", message: "Prepara y envía el informe", status: "waiting_confirmation", progress: 50, lastError: null,
};

function setup(options: Partial<ActivityClient> = {}) {
  const client = {
    listConfirmations: vi.fn(async () => [approval]),
    listTasks: vi.fn(async () => [task]),
    taskEvents: vi.fn(async () => [{ schemaVersion: 1 as const, taskId: "t1", correlationId: "corr1", timestamp: approval.timestamp, type: "completed" as const, message: "Informe enviado a Ana." }]),
    resolve: vi.fn(async (): Promise<ConfirmationResult> => ({ ok: true, message: "Correo enviado." })),
    ...options,
  };
  function Harness() { return <ActivityPanel activity={useActivity(client)} />; }
  return { client, ...render(<Harness />) };
}

describe("Actividad en Inicio", () => {
  test("presenta el contenido y la tarea sin exponer credenciales ni pedir IDs", async () => {
    setup();
    expect(await screen.findByRole("region", { name: "Tareas y aprobaciones" })).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeVisible();
    expect(screen.getByText("archivo@example.com")).toBeVisible();
    expect(screen.getByText("Este es el informe completo.")).toBeVisible();
    expect(screen.getByText(`Para: ${task.message}`)).toBeVisible();
    expect(screen.queryByText("secret-never-render")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  test("una doble pulsación ejecuta una sola decisión y conserva el resultado", async () => {
    let finish!: (result: ConfirmationResult) => void;
    const resolve = vi.fn(() => new Promise<ConfirmationResult>((done) => { finish = done; }));
    const { client } = setup({ resolve });
    const button = await screen.findByRole("button", { name: "Aprobar: Enviar correo" });
    button.focus();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(resolve).toHaveBeenCalledExactlyOnceWith("c1", "confirm");
    expect(screen.getByRole("button", { name: "Rechazar: Enviar correo" })).toBeDisabled();
    vi.mocked(client.listConfirmations).mockResolvedValue([{ ...approval, status: "confirmed" }]);
    await act(async () => finish({ ok: true, message: "Correo enviado a Ana." }));
    expect(await screen.findByText("Correo enviado a Ana.")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Aprobar: Enviar correo" })).not.toBeInTheDocument();
  });

  test("rechazar llama a deny y muestra el resultado real", async () => {
    const resolve = vi.fn(async () => ({ ok: true, message: "Acción denegada; no se ejecutó ningún efecto." }));
    setup({ resolve });
    fireEvent.click(await screen.findByRole("button", { name: "Rechazar: Enviar correo" }));
    expect(await screen.findByText("Acción denegada; no se ejecutó ningún efecto.")).toBeVisible();
    expect(resolve).toHaveBeenCalledExactlyOnceWith("c1", "deny");
  });

  test("un fallo de ejecución nunca se anuncia como éxito", async () => {
    setup({ resolve: vi.fn(async () => ({ ok: false, message: "Google ha rechazado la sesión." })) });
    fireEvent.click(await screen.findByRole("button", { name: "Aprobar: Enviar correo" }));
    expect(await screen.findByText("Google ha rechazado la sesión.")).toHaveClass("text-danger");
    expect(screen.queryByText("Acción aprobada.")).not.toBeInTheDocument();
  });

  test("una desconexión tras aprobar no repite un posible envío", async () => {
    const resolve = vi.fn(async () => { throw new Error("Conexión perdida."); });
    setup({ resolve });
    fireEvent.click(await screen.findByRole("button", { name: "Aprobar: Enviar correo" }));
    expect(await screen.findByText(/No se pudo confirmar el resultado/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Actualizar actividad" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Actualizar actividad" })).toBeEnabled());
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Aprobar: Enviar correo" })).not.toBeInTheDocument();
  });

  test("recoge una decisión hecha fuera del panel sin afirmar que terminó", async () => {
    const { client } = setup();
    await screen.findByRole("button", { name: "Aprobar: Enviar correo" });
    vi.mocked(client.listConfirmations).mockResolvedValue([{ ...approval, status: "confirmed" }]);
    fireEvent.click(screen.getByRole("button", { name: "Actualizar actividad" }));
    expect(await screen.findByText(/Esta acción ya fue aprobada/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Aprobar: Enviar correo" })).not.toBeInTheDocument();
  });

  test("si falla el sondeo conserva las tarjetas y bloquea decisiones hasta refrescar", async () => {
    const { client } = setup();
    await screen.findByRole("button", { name: "Aprobar: Enviar correo" });
    vi.mocked(client.listConfirmations).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Actualizar actividad" }));
    await screen.findByText(/No se pudo actualizar la actividad/);
    expect(screen.getByRole("button", { name: "Aprobar: Enviar correo" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Actualizar actividad" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Aprobar: Enviar correo" })).toBeEnabled());
  });

  test("muestra el resultado registrado de una tarea anterior", async () => {
    const { client } = setup({ listTasks: vi.fn(async () => [{ ...task, status: "succeeded" as const, progress: 100 }]) });
    const previous = await screen.findByText("Tareas anteriores (1)");
    fireEvent.click(previous);
    const details = screen.getByText("Ver actividad y resultado").closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(await screen.findByText("Informe enviado a Ana.")).toBeInTheDocument();
    expect(client.taskEvents).toHaveBeenCalledWith("t1");
  });

  test("no añade paneles vacíos ni propuestas de aprendizaje al inicio", async () => {
    const { client } = setup({ listConfirmations: vi.fn(async () => [{ ...approval, tool: "memory.write", input: { learned: { statement: "Prefiere letra grande" } } }]), listTasks: vi.fn(async () => []) });
    await waitFor(() => expect(client.listTasks).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Tareas y aprobaciones" })).not.toBeInTheDocument();
    expect(within(document.body).queryByRole("button", { name: /Aprobar/ })).not.toBeInTheDocument();
  });
});
