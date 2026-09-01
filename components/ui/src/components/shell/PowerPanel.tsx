import { useMemo, useState, type ReactNode } from "react";
import { Power, RotateCcw } from "lucide-react";

import { createSystemClient, describeSystemClientFailure, type SystemClient } from "../../lib/system-client";
import type { MaintenanceAction } from "../../lib/system-types";
import { Button, Panel } from "../ui";

type PowerAction = Extract<MaintenanceAction, "poweroff" | "reboot">;

type PowerActionCopy = {
  action: PowerAction;
  label: string;
  question: string;
  confirmLabel: string;
  pending: string;
  icon: ReactNode;
};

const POWER_ACTIONS: PowerActionCopy[] = [
  {
    action: "poweroff",
    label: "Apagar el equipo",
    question: "¿Apagar el equipo? Se cerrará todo lo que esté abierto.",
    confirmLabel: "Sí, apagar",
    pending: "Pidiendo al sistema que se apague…",
    icon: <Power aria-hidden="true" className="h-5 w-5" />,
  },
  {
    action: "reboot",
    label: "Reiniciar el equipo",
    question: "¿Reiniciar el equipo? Se cerrará todo lo que esté abierto.",
    confirmLabel: "Sí, reiniciar",
    pending: "Pidiendo al sistema que se reinicie…",
    icon: <RotateCcw aria-hidden="true" className="h-5 w-5" />,
  },
];

export type PowerPanelProps = {
  client?: SystemClient;
};

export function PowerPanel({ client }: PowerPanelProps) {
  const systemClient = useMemo(() => client ?? createSystemClient(), [client]);
  const [confirming, setConfirming] = useState<PowerAction | null>(null);
  const [running, setRunning] = useState<PowerAction | null>(null);
  const [status, setStatus] = useState<{
    text: string;
    failed: boolean;
  } | null>(null);

  async function run(copy: PowerActionCopy) {
    setConfirming(null);
    setRunning(copy.action);
    setStatus({ text: copy.pending, failed: false });

    try {
      const response = await systemClient.runMaintenance(copy.action);
      setStatus({
        text: response.message ?? "El sistema ha aceptado la orden.",
        failed: false,
      });
    } catch (error) {
      setStatus({ text: describeSystemClientFailure(error), failed: true });
    } finally {
      setRunning(null);
    }
  }

  const pending = POWER_ACTIONS.find((copy) => copy.action === confirming) ?? null;

  return (
    <Panel description="Apaga o reinicia el equipo. Se pide confirmación antes de hacer nada." title="Encendido">
      <div className="grid gap-4">
        {pending ? (
          <div className="grid gap-3" role="group" aria-label={pending.label}>
            <p className="text-sm text-ink">{pending.question}</p>
            <div className="flex flex-wrap gap-2">
              <Button autoFocus icon={pending.icon} onClick={() => void run(pending)} variant="danger">
                {pending.confirmLabel}
              </Button>
              <Button onClick={() => setConfirming(null)} variant="ghost">
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {POWER_ACTIONS.map((copy) => (
              <Button
                disabled={running !== null}
                icon={copy.icon}
                key={copy.action}
                loading={running === copy.action}
                onClick={() => {
                  setStatus(null);
                  setConfirming(copy.action);
                }}
              >
                {copy.label}
              </Button>
            ))}
          </div>
        )}

        {status ? (
          <p
            aria-live="polite"
            className={status.failed ? "text-sm text-danger" : "text-sm text-ink-muted"}
            role="status"
          >
            {status.text}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
