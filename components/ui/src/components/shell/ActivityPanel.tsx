import { useEffect, useId, useRef, useState } from "react";
import type { Activity } from "../../hooks/useActivity";
import type { WorkerTask, WorkerProgressEvent } from "../../lib/activity-client";
import type { AgentConfirmation } from "../../lib/system-types";
import { confirmationDetails, isLearningProposal } from "../../lib/confirmation-details";
import { Button, Panel } from "../ui";

const STATUS: Record<WorkerTask["status"], string> = {
  queued: "En cola", running: "En curso", waiting_confirmation: "Necesita tu aprobación",
  succeeded: "Terminada", failed: "No se pudo completar", cancelled: "Cancelada",
};

function ApprovalCard({ confirmation, activity }: { confirmation: AgentConfirmation; activity: Activity }) {
  const headingId = useId();
  const resultRef = useRef<HTMLParagraphElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const hadFocus = useRef(false);
  const { title, fields } = confirmationDetails(confirmation);
  const receipt = activity.receipts[confirmation.confirmationId];
  const busy = activity.busyIds.has(confirmation.confirmationId);
  const task = activity.tasks.find((candidate) => candidate.taskId === confirmation.taskId);
  useEffect(() => {
    if (receipt && hadFocus.current && (cardRef.current?.contains(document.activeElement) || document.activeElement === document.body)) resultRef.current?.focus();
  }, [receipt]);
  const decide = (decision: "confirm" | "deny") => {
    hadFocus.current = Boolean(cardRef.current?.contains(document.activeElement));
    void activity.resolve(confirmation, decision);
  };

  return (
    <article ref={cardRef} aria-labelledby={headingId} className="panel-inset p-4">
      <h3 id={headingId} className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-ink-faint">{task ? `Para: ${task.message}`
        : confirmation.source === "ui" ? "Solicitada desde tu sesión" : "Solicitada en segundo plano"}</p>
      <p className="mt-2 whitespace-pre-wrap break-words">{confirmation.summary}</p>
      <dl className="mt-3 space-y-3">
        {fields.map(({ label, value }) => <div key={label}>
          <dt className="text-sm font-semibold text-ink-faint">{label}</dt>
          <dd className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words" tabIndex={0}>{value}</dd>
        </div>)}
      </dl>
      {receipt ? (
        <p ref={resultRef} tabIndex={-1} role="status" className={`mt-3 whitespace-pre-wrap ${receipt.failed ? "text-danger" : "text-ink"}`}>
          {receipt.message}
        </p>
      ) : confirmation.status !== "pending" && !busy ? (
        <p role="status" className="mt-3">{confirmation.status === "denied" ? "Acción rechazada." : "Esta acción ya fue aprobada. Consulta su resultado antes de repetirla."}</p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-3">
          <Button aria-label={`Aprobar: ${title}`} disabled={busy || Boolean(activity.error)} loading={busy} onClick={() => decide("confirm")}>
            {busy ? "Procesando decisión…" : "Aprobar"}
          </Button>
          <Button aria-label={`Rechazar: ${title}`} disabled={busy || Boolean(activity.error)} onClick={() => decide("deny")} variant="ghost">Rechazar</Button>
        </div>
      )}
    </article>
  );
}

function TaskCard({ task, activity }: { task: WorkerTask; activity: Activity }) {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<WorkerProgressEvent[]>([]);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!expanded) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const result = await activity.client.taskEvents(task.taskId);
        if (!disposed) { setEvents(result); setError(false); }
      } catch { if (!disposed) setError(true); }
      if (!disposed && ["queued", "running", "waiting_confirmation"].includes(task.status)) timer = setTimeout(() => void read(), 3_000);
    };
    void read();
    return () => { disposed = true; clearTimeout(timer); };
  }, [activity.client, expanded, task.taskId, task.status, attempt]);
  return <article className="panel-inset p-4">
    <h3 className="font-semibold whitespace-pre-wrap break-words">{task.message}</h3>
    <p className="mt-2 text-sm">{STATUS[task.status]}</p>
    {task.status === "running" ? <progress aria-label={`Avance: ${task.message}`} className="mt-2 w-full" max={100} value={Math.max(0, Math.min(100, task.progress))} /> : null}
    {task.lastError ? <p className="mt-2 text-danger whitespace-pre-wrap">{task.lastError}</p> : null}
    <details className="mt-3" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary className="cursor-pointer py-2">Ver actividad y resultado</summary>
      {error ? <div><p role="status">No se pudo leer el resultado.</p><Button onClick={() => setAttempt((value) => value + 1)}>Reintentar lectura</Button></div>
        : events.length ? <ol className="mt-2 space-y-2">{events.map((event, index) => <li className="whitespace-pre-wrap break-words" key={`${event.timestamp}-${index}`}>{event.message}</li>)}</ol>
        : <p className="mt-2 text-sm">Sin detalles disponibles todavía.</p>}
    </details>
  </article>;
}

export function ActivityPanel({ activity }: { activity: Activity }) {
  const pending = activity.confirmations.filter((item) => item.status === "pending" && !isLearningProposal(item));
  const approvals = new Map(activity.confirmations.filter((item) => !isLearningProposal(item)).map((item) => [item.confirmationId, item]));
  for (const receipt of Object.values(activity.receipts)) approvals.set(receipt.confirmation.confirmationId, receipt.confirmation);
  const activeTasks = activity.tasks.filter((task) => ["queued", "running", "waiting_confirmation"].includes(task.status));
  const finishedTasks = activity.tasks.filter((task) => !activeTasks.includes(task));
  const status = pending.length ? `${pending.length} acciones necesitan tu aprobación.` : "";

  return <div className="w-full">
    <p className="sr-only" role="status" aria-live="polite">{status}</p>
    {approvals.size || activity.tasks.length || activity.error ? (
      <Panel title="Tu actividad" ariaLabel="Tareas y aprobaciones" className="w-full"
        actions={<Button size="sm" loading={activity.checking} onClick={() => void activity.refresh()}>Actualizar actividad</Button>}>
        {activity.error ? <p role="status" className="mb-3 text-danger">{activity.error}</p> : null}
        <div className="grid gap-3">
          {Array.from(approvals.values()).map((confirmation) => <ApprovalCard key={confirmation.confirmationId} confirmation={confirmation} activity={activity} />)}
          {activeTasks.map((task) => <TaskCard key={task.taskId} task={task} activity={activity} />)}
        </div>
        {finishedTasks.length ? <details className="mt-4">
          <summary className="cursor-pointer py-2">Tareas anteriores ({finishedTasks.length})</summary>
          <div className="mt-3 grid gap-3">{finishedTasks.map((task) => <TaskCard key={task.taskId} task={task} activity={activity} />)}</div>
        </details> : null}
      </Panel>
    ) : null}
  </div>;
}
