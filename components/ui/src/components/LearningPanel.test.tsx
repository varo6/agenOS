import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { LearningPanel } from "./LearningPanel";

const client = {
  listLearnedMemories: vi.fn(),
  getLearningOverview: vi.fn(),
  listConfirmations: vi.fn(),
  confirm: vi.fn(),
  deny: vi.fn(),
  correctLearnedMemory: vi.fn(),
  forgetLearnedMemory: vi.fn(),
};

const overview = {
  signalsCaptured: 8,
  turnsObserved: 4,
  turnsWithMemory: 2,
  memoryUses: 2,
  activeMemories: 1,
  pendingProposals: 1,
  acceptedProposals: 1,
  deniedProposals: 0,
  acceptanceRate: 1,
  lastLearningAt: "2026-08-25T10:00:00.000Z",
  usageByItem: { learn_1: { count: 2, lastUsedAt: "2026-08-25T10:00:00.000Z" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  client.getLearningOverview.mockResolvedValue(overview);
  client.listLearnedMemories.mockResolvedValue([{
    schemaVersion: 1,
    itemId: "learn_1",
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    status: "active",
    kind: "preference",
    statement: "Prefiero resúmenes en tres viñetas",
    confidence: 0.75,
    expiresAt: "2026-11-20T10:00:00.000Z",
    sourceSignalIds: ["sig_1"],
    userEdited: false,
  }]);
  client.listConfirmations.mockResolvedValue([{
    schemaVersion: 1,
    confirmationId: "conf_1",
    correlationId: "corr_1",
    timestamp: "2026-08-25T10:00:00.000Z",
    status: "pending",
    source: "system",
    tool: "memory.write",
    summary: "Guardar aprendizaje",
    input: {
      learned: {
        kind: "avoidance",
        statement: "Comprobar el resultado antes de repetir apps_open",
        sourceSignalIds: ["sig_2", "sig_3"],
      },
    },
  }]);
  client.confirm.mockResolvedValue({ ok: true });
  client.correctLearnedMemory.mockResolvedValue({});
  client.forgetLearnedMemory.mockResolvedValue({});
});

describe("LearningPanel", () => {
  test("explains proposals and shows actual memory use", async () => {
    render(<LearningPanel client={client as never} />);

    expect(await screen.findByText("Comprobar el resultado antes de repetir apps_open")).toBeInTheDocument();
    expect(screen.getByText("basada en 2 señales", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("usada 2 veces", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("2", { selector: "p" })).toBeInTheDocument();
  });

  test("accepts a proposal only after an explicit click", async () => {
    render(<LearningPanel client={client as never} />);
    fireEvent.click(await screen.findByRole("button", { name: "Recordar" }));

    await waitFor(() => expect(client.confirm).toHaveBeenCalledWith("conf_1"));
    expect(await screen.findByText("Pi podrá usar este aprendizaje.")).toBeInTheDocument();
  });

  test("lets the user correct an active memory", async () => {
    render(<LearningPanel client={client as never} />);
    fireEvent.click(await screen.findByRole("button", { name: "Corregir aprendizaje learn_1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Corregir learn_1" }), {
      target: { value: "Prefiero resúmenes en dos viñetas" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(client.correctLearnedMemory).toHaveBeenCalledWith("learn_1", "Prefiero resúmenes en dos viñetas"));
  });
});
