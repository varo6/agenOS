import { useCallback, useEffect, useMemo, useState } from "react";

import type { createAgentClient } from "../lib/agent-client";
import { classifyAgentCommand } from "../lib/agent-command";
import { PiClientError, type createPiClient } from "../lib/pi-client";
import type { PiChatSource, PiTurnState } from "../lib/pi-types";
import { turnPollDelayMs } from "../lib/turn-polling";
import { useLatest } from "./useLatest";
import type { AlertSink } from "./useSystemAlert";

type PiClient = ReturnType<typeof createPiClient>;
type AgentClient = ReturnType<typeof createAgentClient>;

const HISTORY_LIMIT = 20;
/** Turnos que se conservan en memoria; el historial completo vive en el equipo. */
const MAX_TURNS = 40;

export type ConversationState = "idle" | "processing" | "error";

export type Conversation = {
  turns: PiTurnState[];
  /** Turno en curso, si lo hay. */
  activeTurn: PiTurnState | null;
  state: ConversationState;
  /** Hay una petición en vuelo (incluye el servicio ocupado por otra vía). */
  draft: string;
  setDraft: (value: string) => void;
  send: (message: string, source: PiChatSource) => Promise<void>;
  stop: () => Promise<void>;
  restore: () => Promise<void>;
  /** Cierra el hilo actual y empieza uno nuevo, también para Pi. */
  startNew: () => Promise<void>;
  resetError: () => void;
};

export type UseConversationOptions = {
  piClient: PiClient;
  agentClient: AgentClient;
  alert: AlertSink;
  /** No hay internet: no se puede hablar con el modelo. */
  isOffline: () => boolean;
  /** La cuenta no está conectada: solo valen las órdenes locales del broker. */
  isDisconnected: () => boolean;
  onUnauthorized: () => void;
  onModelId: (modelId: string) => void;
  /** Se ha cerrado un turno: buen momento para refrescar estado y workspaces. */
  onSettled: () => void;
};

/**
 * Conversación con Pi: historial, envío y seguimiento del turno en curso.
 *
 * El sondeo del turno vive aquí y depende solo del identificador del turno
 * activo, de forma que los re-renders del shell no reinician el intervalo.
 */
export function useConversation({
  piClient,
  agentClient,
  alert,
  isOffline,
  isDisconnected,
  onUnauthorized,
  onModelId,
  onSettled,
}: UseConversationOptions): Conversation {
  const [turns, setTurns] = useState<PiTurnState[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [state, setState] = useState<ConversationState>("idle");
  const [draft, setDraft] = useState("");

  const guards = useLatest({ isOffline, isDisconnected, onUnauthorized, onModelId, onSettled });

  const upsertTurn = useCallback((turn: PiTurnState) => {
    setTurns((current) => {
      const index = current.findIndex((candidate) => candidate.turnId === turn.turnId);
      if (index === -1) {
        return [...current, turn].slice(-MAX_TURNS);
      }

      const next = [...current];
      next[index] = turn;
      return next;
    });
  }, []);

  /** Respuesta resuelta en local (memoria, tarea de fondo): no pasa por el modelo. */
  const appendLocalTurn = useCallback(
    (input: string, reply: string) => {
      const timestamp = new Date().toISOString();
      upsertTurn({
        turnId: `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        status: "succeeded",
        source: "text",
        input,
        startedAt: timestamp,
        finishedAt: timestamp,
        progress: { startedAt: timestamp, streamedText: "", currentTool: null, completedTools: [] },
        reply,
      });
    },
    [upsertTurn],
  );

  const send = useCallback(
    async (message: string, source: PiChatSource) => {
      const trimmed = message.trim();
      if (!trimmed) {
        return;
      }

      if (guards.current.isOffline()) {
        setState("idle");
        alert.raise("Sin conexión a internet.", { kind: "offline" });
        return;
      }

      const command = classifyAgentCommand(trimmed);

      setState("processing");
      alert.clear();
      if (source === "text") {
        setDraft("");
      }

      if (command.kind === "memory") {
        try {
          const response = await agentClient.appendMemory(command.namespace, command.content);
          appendLocalTurn(trimmed, response.message ?? "Lo he guardado en tu memoria.");
          setState("idle");
        } catch (error) {
          setState("error");
          alert.raise(error);
        }
        return;
      }

      if (command.kind === "background") {
        try {
          const response = await agentClient.delegateBackgroundTask(command.message);
          appendLocalTurn(
            trimmed,
            response.message ?? "Se lo he pasado al trabajador de fondo.",
          );
          setState("idle");
        } catch (error) {
          setState("error");
          alert.raise(error);
        }
        return;
      }

      if (guards.current.isDisconnected()) {
        setState("idle");
        guards.current.onUnauthorized();
        alert.raise("Conecta ChatGPT antes de enviar mensajes.", { kind: "unauthorized" });
        return;
      }

      try {
        const turn = await piClient.startTurn(trimmed, source);
        upsertTurn(turn);
        setActiveTurnId(turn.turnId);
      } catch (error) {
        setState("error");
        const raised = alert.raise(error);
        if (raised.kind === "unauthorized") {
          guards.current.onUnauthorized();
        }
        guards.current.onSettled();
      }
    },
    [agentClient, alert, appendLocalTurn, guards, piClient, upsertTurn],
  );

  const applyFinishedTurn = useCallback(
    (turn: PiTurnState) => {
      setActiveTurnId(null);

      if (turn.status === "succeeded" || turn.status === "cancelled") {
        if (turn.modelId) {
          guards.current.onModelId(turn.modelId);
        }
        setState("idle");
        return;
      }

      setState("error");
      alert.raise(turn.error ?? "Pi no ha podido terminar la respuesta.", {
        status: turn.errorStatus,
      });
      if (turn.errorStatus === 401) {
        guards.current.onUnauthorized();
      }
    },
    [alert, guards],
  );

  const pollTurn = useCallback(async () => {
    if (!activeTurnId) {
      return;
    }

    try {
      const turn = await piClient.getTurn(activeTurnId);
      upsertTurn(turn);

      if (turn.status !== "processing") {
        applyFinishedTurn(turn);
        guards.current.onSettled();
      }
    } catch (error) {
      // El turno sigue corriendo en el servicio aunque falle una consulta
      // puntual; solo un 404 significa que el turno ya no existe.
      if (error instanceof PiClientError && error.status === 404) {
        setActiveTurnId(null);
        setState("error");
        alert.raise(error, { kind: "lostTurn" });
      }
    }
  }, [activeTurnId, alert, applyFinishedTurn, guards, piClient, upsertTurn]);

  const stop = useCallback(async () => {
    if (!activeTurnId) {
      return;
    }

    try {
      const turn = await piClient.cancelTurn(activeTurnId);
      upsertTurn(turn);
      if (turn.status !== "processing") {
        applyFinishedTurn(turn);
        guards.current.onSettled();
      }
    } catch (error) {
      alert.raise(error);
    }
  }, [activeTurnId, alert, applyFinishedTurn, guards, piClient, upsertTurn]);

  const pollTurnRef = useLatest(pollTurn);

  useEffect(() => {
    if (!activeTurnId) {
      return;
    }

    let cancelled = false;
    let inFlight = false;
    let timeoutId: number | null = null;
    const startedAt = performance.now();

    const schedule = () => {
      if (cancelled) {
        return;
      }
      const delay = turnPollDelayMs(
        performance.now() - startedAt,
        document.visibilityState === "hidden",
      );
      timeoutId = window.setTimeout(() => void tick(), delay);
    };

    const tick = async () => {
      if (cancelled || inFlight) {
        return;
      }
      inFlight = true;
      try {
        await pollTurnRef.current();
      } finally {
        inFlight = false;
        schedule();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" || inFlight) {
        return;
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      void tick();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void tick();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeTurnId, pollTurnRef]);

  /** Recupera el historial guardado y reengancha un turno que siguiera vivo. */
  const restore = useCallback(async () => {
    try {
      const history = await piClient.listTurns(HISTORY_LIMIT);
      if (!Array.isArray(history) || history.length === 0) {
        return;
      }

      setTurns(history.slice(-MAX_TURNS));
      const latest = history[history.length - 1];
      if (latest?.status === "processing") {
        setState("processing");
        setActiveTurnId(latest.turnId);
      }
    } catch {
      // Recuperar el historial es opcional; el resto de la interfaz funciona igual.
    }
  }, [piClient]);

  /**
   * Empieza una conversación nueva.
   *
   * Vaciar los turnos de aquí no bastaría: el historial vive en el equipo y
   * `restore` lo traería de vuelta al siguiente arranque, y sobre todo Pi
   * seguiría con el hilo cargado. Por eso el corte lo da el servicio y la
   * pantalla solo se limpia si ese corte ha salido bien; si falla, más vale
   * conservar la conversación y decirlo que fingir que ha pasado algo.
   */
  const startNew = useCallback(async () => {
    try {
      await piClient.startNewConversation();
    } catch (error) {
      alert.raise(error);
      return;
    }

    setTurns([]);
    setActiveTurnId(null);
    setState("idle");
    setDraft("");
    alert.clear();
  }, [alert, piClient]);

  const resetError = useCallback(() => {
    setState((current) => (current === "error" ? "idle" : current));
  }, []);

  const activeTurn = useMemo(
    () => (activeTurnId ? turns.find((turn) => turn.turnId === activeTurnId) ?? null : null),
    [activeTurnId, turns],
  );

  return { turns, activeTurn, state, draft, setDraft, send, stop, restore, startNew, resetError };
}
