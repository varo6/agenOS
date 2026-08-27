import { useCallback, useEffect, useMemo, useState } from "react";
import { Brain, Check, Pencil, RefreshCcw, Trash2, X } from "lucide-react";

import type { createAgentAdminClient } from "../lib/agent-admin-client";
import type { AgentConfirmation, LearnedMemoryItem, LearningOverview } from "../lib/system-types";
import { Button, Panel, PanelInset } from "./ui";

type AgentAdminClient = ReturnType<typeof createAgentAdminClient>;

type LearningPanelProps = {
  client: AgentAdminClient;
};

type LearnedProposal = {
  confirmation: AgentConfirmation;
  statement: string;
  kind: LearnedMemoryItem["kind"];
  sourceSignalCount: number;
};

function learnedProposal(confirmation: AgentConfirmation): LearnedProposal | null {
  if (confirmation.tool !== "memory.write" || confirmation.status !== "pending" || !confirmation.input || typeof confirmation.input !== "object") {
    return null;
  }
  const learned = (confirmation.input as { learned?: unknown }).learned;
  if (!learned || typeof learned !== "object") {
    return null;
  }
  const record = learned as { statement?: unknown; kind?: unknown; sourceSignalIds?: unknown };
  if (typeof record.statement !== "string") {
    return null;
  }
  const kind = record.kind === "procedure" || record.kind === "avoidance" ? record.kind : "preference";
  return {
    confirmation,
    statement: record.statement,
    kind,
    sourceSignalCount: Array.isArray(record.sourceSignalIds) ? record.sourceSignalIds.length : 0,
  };
}

function kindLabel(kind: LearnedMemoryItem["kind"]): string {
  if (kind === "avoidance") return "Precaución";
  if (kind === "procedure") return "Forma de trabajar";
  return "Preferencia";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" }).format(date)
    : value;
}

export function LearningPanel({ client }: LearningPanelProps) {
  const [memories, setMemories] = useState<LearnedMemoryItem[]>([]);
  const [overview, setOverview] = useState<LearningOverview | null>(null);
  const [confirmations, setConfirmations] = useState<AgentConfirmation[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextMemories, nextOverview, nextConfirmations] = await Promise.all([
        client.listLearnedMemories(),
        client.getLearningOverview(),
        client.listConfirmations(),
      ]);
      setMemories(nextMemories.filter((item) => item.status === "active"));
      setOverview(nextOverview);
      setConfirmations(nextConfirmations);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "No se pudo leer el aprendizaje de Pi.");
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const proposals = useMemo(
    () => confirmations.map(learnedProposal).filter((proposal): proposal is LearnedProposal => proposal !== null),
    [confirmations],
  );

  async function runAction(id: string, action: () => Promise<unknown>, successMessage: string) {
    setBusyId(id);
    try {
      await action();
      setMessage(successMessage);
      setError(null);
      setEditingId(null);
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "No se pudo completar la acción.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel
      actions={(
        <Button aria-label="Actualizar aprendizaje" icon={<RefreshCcw aria-hidden="true" className="h-4 w-4" />} onClick={() => void refresh()} size="sm" variant="ghost">
          Actualizar
        </Button>
      )}
      description="Pi detecta preferencias y errores repetidos, pero no guarda nada nuevo sin preguntarte. Aquí puedes revisar y corregir lo que usa."
      eyebrow="Bajo tu control"
      title="Lo que Pi aprende"
    >
      {overview ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <PanelInset>
            <p className="text-2xl font-medium text-ink">{overview.activeMemories}</p>
            <p className="mt-1 text-xs text-ink-faint">recuerdos activos</p>
          </PanelInset>
          <PanelInset>
            <p className="text-2xl font-medium text-ink">{overview.turnsWithMemory}</p>
            <p className="mt-1 text-xs text-ink-faint">turnos que usaron memoria</p>
          </PanelInset>
          <PanelInset>
            <p className="text-2xl font-medium text-ink">{overview.pendingProposals}</p>
            <p className="mt-1 text-xs text-ink-faint">propuestas por revisar</p>
          </PanelInset>
        </div>
      ) : null}

      {proposals.length > 0 ? (
        <section aria-labelledby="learning-proposals" className="mt-5">
          <h3 className="font-medium text-ink" id="learning-proposals">Pi propone recordar</h3>
          <p className="mt-1 text-sm text-ink-muted">Lee cada frase. Aceptarla cambiará el contexto de conversaciones futuras.</p>
          <div className="mt-3 grid gap-3">
            {proposals.map((proposal) => (
              <PanelInset className="bg-surface" key={proposal.confirmation.confirmationId}>
                <div className="flex items-start gap-3">
                  <Brain aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-accent-light" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-ink-faint">{kindLabel(proposal.kind)} · basada en {proposal.sourceSignalCount || 1} señal{(proposal.sourceSignalCount || 1) === 1 ? "" : "es"}</p>
                    <p className="mt-2 text-sm leading-6 text-ink">{proposal.statement}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        icon={<Check aria-hidden="true" className="h-4 w-4" />}
                        loading={busyId === proposal.confirmation.confirmationId}
                        onClick={() => void runAction(proposal.confirmation.confirmationId, () => client.confirm(proposal.confirmation.confirmationId), "Pi podrá usar este aprendizaje.")}
                        size="sm"
                        variant="primary"
                      >
                        Recordar
                      </Button>
                      <Button
                        icon={<X aria-hidden="true" className="h-4 w-4" />}
                        loading={busyId === proposal.confirmation.confirmationId}
                        onClick={() => void runAction(proposal.confirmation.confirmationId, () => client.deny(proposal.confirmation.confirmationId), "Propuesta descartada.")}
                        size="sm"
                      >
                        Descartar
                      </Button>
                    </div>
                  </div>
                </div>
              </PanelInset>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="active-learning" className="mt-5">
        <h3 className="font-medium text-ink" id="active-learning">Memoria activa</h3>
        {memories.length === 0 ? (
          <p className="mt-2 text-sm text-ink-faint">Pi todavía no tiene aprendizajes confirmados.</p>
        ) : (
          <div className="mt-3 grid gap-3">
            {memories.map((memory) => {
              const usage = overview?.usageByItem[memory.itemId];
              const editing = editingId === memory.itemId;
              return (
                <PanelInset key={memory.itemId}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-ink-faint">
                        {kindLabel(memory.kind)} · usada {usage?.count ?? 0} {usage?.count === 1 ? "vez" : "veces"} · caduca {formatDate(memory.expiresAt)}
                      </p>
                      {editing ? (
                        <textarea
                          aria-label={`Corregir ${memory.itemId}`}
                          className="field-input mt-2 min-h-24 resize-y"
                          maxLength={400}
                          onChange={(event) => setDraft(event.target.value)}
                          value={draft}
                        />
                      ) : (
                        <p className="mt-2 text-sm leading-6 text-ink">{memory.statement}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {editing ? (
                        <>
                          <Button
                            disabled={!draft.trim()}
                            loading={busyId === memory.itemId}
                            onClick={() => void runAction(memory.itemId, () => client.correctLearnedMemory(memory.itemId, draft.trim()), "Aprendizaje corregido.")}
                            size="sm"
                            variant="primary"
                          >
                            Guardar
                          </Button>
                          <Button onClick={() => setEditingId(null)} size="sm" variant="ghost">Cancelar</Button>
                        </>
                      ) : (
                        <>
                          <Button
                            aria-label={`Corregir aprendizaje ${memory.itemId}`}
                            icon={<Pencil aria-hidden="true" className="h-4 w-4" />}
                            onClick={() => {
                              setEditingId(memory.itemId);
                              setDraft(memory.statement);
                            }}
                            size="sm"
                            variant="ghost"
                          >
                            Corregir
                          </Button>
                          <Button
                            aria-label={`Olvidar aprendizaje ${memory.itemId}`}
                            icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
                            loading={busyId === memory.itemId}
                            onClick={() => void runAction(memory.itemId, () => client.forgetLearnedMemory(memory.itemId), "Pi ha olvidado este aprendizaje.")}
                            size="sm"
                            variant="danger"
                          >
                            Olvidar
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </PanelInset>
              );
            })}
          </div>
        )}
      </section>

      {message ? <p aria-live="polite" className="mt-4 text-sm text-ink-muted">{message}</p> : null}
      {error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p> : null}
    </Panel>
  );
}
