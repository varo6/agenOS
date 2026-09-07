import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SavedRepliesPanel } from "./SavedRepliesPanel";
import type { createImprovementsClient } from "../lib/improvements-client";

test("permite encontrar, releer y borrar una respuesta guardada", async () => {
  const listSavedReplies = vi.fn().mockResolvedValue([{ turnId: "t1", input: "Cómo abrir el editor", reply: "Abre el menú de aplicaciones.", savedAt: "2026-09-05T00:00:00Z" }]);
  const forgetSavedReply = vi.fn().mockImplementation(async () => { listSavedReplies.mockResolvedValue([]); return { ok: true }; });
  render(<SavedRepliesPanel client={{ listSavedReplies, forgetSavedReply } as unknown as ReturnType<typeof createImprovementsClient>} />);
  expect(await screen.findByText("Cómo abrir el editor")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "editor" } });
  await waitFor(() => expect(listSavedReplies).toHaveBeenLastCalledWith("editor", 0));
  fireEvent.click(screen.getByText("Cómo abrir el editor"));
  expect(screen.getByText("Abre el menú de aplicaciones.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Borrar respuesta guardada" }));
  await waitFor(() => expect(forgetSavedReply).toHaveBeenCalledWith("t1"));
  expect(await screen.findByText("No hay respuestas guardadas que mostrar.")).toBeInTheDocument();
});
