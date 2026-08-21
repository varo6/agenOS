import { useEffect, useRef } from "react";

import type { PiTurnState } from "../lib/pi-types";
import { getTtsBridge } from "../lib/tts-bridge";

export type UseTtsRepliesOptions = {
  turns: PiTurnState[];
  getBridge?: typeof getTtsBridge;
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
export function useTtsReplies({ turns, getBridge = getTtsBridge }: UseTtsRepliesOptions): void {
  const seenTurnIdsRef = useRef<Set<string> | null>(null);
  const mountedAtRef = useRef(Date.now());

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
      void bridge.speak(reply).catch(() => {
        // La lectura es auxiliar: la respuesta ya esta visible en pantalla.
      });
    }
  }, [getBridge, turns]);
}
