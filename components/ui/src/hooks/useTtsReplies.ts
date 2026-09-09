import { useCallback, useEffect, useRef, useState } from "react";
import type { PiTurnState } from "../lib/pi-types";
import { getTtsBridge } from "../lib/tts-bridge";
import { createTtsNarrator } from "../lib/tts-narrator";

export type UseTtsRepliesOptions = { turns: PiTurnState[]; getBridge?: typeof getTtsBridge };
export type TtsRepliesController = { speaking: boolean; stop: () => void };

/** Narra frases nuevas durante la ejecución, sin releer el historial. */
export function useTtsReplies({ turns, getBridge = getTtsBridge }: UseTtsRepliesOptions): TtsRepliesController {
  const narrator = useRef<ReturnType<typeof createTtsNarrator> | null>(null);
  const mountedAt = useRef(Date.now());
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    const controller = createTtsNarrator({ getBridge, onSpeaking: setSpeaking, mountedAt: mountedAt.current });
    narrator.current = controller;
    return () => { controller.dispose(); narrator.current = null; };
  }, [getBridge]);
  useEffect(() => { narrator.current?.update(turns); }, [getBridge, turns]);
  const stop = useCallback(() => narrator.current?.stop(), []);
  return { speaking, stop };
}
