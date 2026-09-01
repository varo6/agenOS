import { useCallback, useEffect, useRef, useState } from "react";

import type { PiTurnState } from "../lib/pi-types";
import { getTtsBridge } from "../lib/tts-bridge";

export type UseTtsRepliesOptions = {
  turns: PiTurnState[];
  getBridge?: typeof getTtsBridge;
};

export type TtsRepliesController = {
  speaking: boolean;
  stop: () => void;
};

function completedReply(turn: PiTurnState): string | null {
  if (turn.status !== "succeeded") {
    return null;
  }

  const reply = turn.reply?.trim();
  return reply || null;
}

/**
 * Lee en voz alta solo respuestas nuevas.
 *
 * Al arrancar, `restore()` puede cargar historial antiguo: esos turnos se
 * marcan como vistos para no despertar la maquina leyendo una conversacion
 * pasada. A partir de ahi cada turno completado se habla una vez.
 */
export function useTtsReplies({ turns, getBridge = getTtsBridge }: UseTtsRepliesOptions): TtsRepliesController {
  const seenTurnIdsRef = useRef<Set<string> | null>(null);
  const mountedAtRef = useRef(Date.now());
  const activeRef = useRef<{ bridge: NonNullable<ReturnType<typeof getTtsBridge>>; id: symbol } | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const stop = useCallback(() => {
    const active = activeRef.current;
    if (!active) {
      return;
    }

    activeRef.current = null;
    setSpeaking(false);
    void active.bridge.stop().catch(() => {
      // La respuesta sigue visible aunque el motor no acepte la parada.
    });
  }, []);

  useEffect(() => {
    if (seenTurnIdsRef.current === null) {
      seenTurnIdsRef.current = new Set(
        turns
          .filter((turn) => completedReply(turn))
          .map((turn) => turn.turnId),
      );
      return;
    }

    const seenTurnIds = seenTurnIdsRef.current;
    const bridge = getBridge();

    for (const turn of turns) {
      const reply = completedReply(turn);
      if (!reply || seenTurnIds.has(turn.turnId)) {
        continue;
      }

      const finishedAtMs = turn.finishedAt ? Date.parse(turn.finishedAt) : Number.NaN;
      if (Number.isFinite(finishedAtMs) && finishedAtMs <= mountedAtRef.current) {
        seenTurnIds.add(turn.turnId);
        continue;
      }

      if (!bridge?.isAvailable()) {
        continue;
      }

      seenTurnIds.add(turn.turnId);
      const id = Symbol(turn.turnId);
      activeRef.current = { bridge, id };
      setSpeaking(true);
      void bridge.speak(reply)
        .catch(() => {
          // La lectura es auxiliar: la respuesta ya esta visible en pantalla.
        })
        .finally(() => {
          if (activeRef.current?.id === id) {
            activeRef.current = null;
            setSpeaking(false);
          }
        });
    }
  }, [getBridge, turns]);

  useEffect(() => () => {
    const active = activeRef.current;
    activeRef.current = null;
    if (active) {
      void active.bridge.stop().catch(() => undefined);
    }
  }, []);

  return { speaking, stop };
}
