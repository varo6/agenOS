import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityClient, ConfirmationDecision, WorkerTask } from "../lib/activity-client";
import type { AgentConfirmation } from "../lib/system-types";

export type ApprovalReceipt = { confirmation: AgentConfirmation; message: string; failed: boolean };

export function useActivity(client: ActivityClient) {
  const [confirmations, setConfirmations] = useState<AgentConfirmation[]>([]);
  const [tasks, setTasks] = useState<WorkerTask[]>([]);
  const [receipts, setReceipts] = useState<Record<string, ApprovalReceipt>>({});
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(new Set<string>());
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++generation.current;
    setChecking(true);
    const results = await Promise.allSettled([client.listConfirmations(), client.listTasks()]);
    if (version !== generation.current) return;
    const [approvals, work] = results;
    if (approvals.status === "fulfilled") setConfirmations((current) => {
      const observed = new Map(current.map((item) => [item.confirmationId, item]));
      for (const item of approvals.value) {
        if (item.status === "pending" || observed.has(item.confirmationId)) observed.set(item.confirmationId, item);
      }
      return Array.from(observed.values());
    });
    if (work.status === "fulfilled") setTasks(work.value);
    setError(results.some((result) => result.status === "rejected")
      ? "No se pudo actualizar la actividad. Los datos pueden haber cambiado. Comprueba el estado antes de decidir."
      : null);
    setChecking(false);
  }, [client]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(() => void poll(), document.hidden ? 15_000 : 3_000);
    };
    void poll();
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      generation.current++;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const resolve = useCallback(async (confirmation: AgentConfirmation, decision: ConfirmationDecision) => {
    const id = confirmation.confirmationId;
    if (inFlight.current.has(id) || confirmation.status !== "pending" || receipts[id] || error) return;
    inFlight.current.add(id);
    setBusyIds(new Set(inFlight.current));
    try {
      const result = await client.resolve(id, decision);
      setReceipts((current) => ({ ...current, [id]: {
        confirmation,
        failed: !result.ok,
        message: result.message ?? (result.ok
          ? decision === "confirm" ? "Acción aprobada. Consulta el estado de la tarea." : "Acción rechazada."
          : "La acción no pudo completarse. Comprueba el estado antes de volver a solicitarla."),
      } }));
    } catch (cause) {
      // Un corte de transporte no significa que el efecto no haya ocurrido.
      // Nunca repetimos automáticamente una aprobación.
      setReceipts((current) => ({ ...current, [id]: {
        confirmation, failed: true,
        message: `No se pudo confirmar el resultado. ${cause instanceof Error ? cause.message : "Se perdió la conexión."} Comprueba el estado antes de volver a solicitar la acción.`,
      } }));
    } finally {
      await refresh();
      inFlight.current.delete(id);
      setBusyIds(new Set(inFlight.current));
    }
  }, [client, error, receipts, refresh]);

  return { confirmations, tasks, receipts, busyIds, error, checking, refresh, resolve, client };
}

export type Activity = ReturnType<typeof useActivity>;
