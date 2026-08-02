import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createPreferredSpeechRecognitionController,
  type SpeechRecognitionCallbacks,
  type SpeechRecognitionController,
} from "../lib/speech-recognition";
import {
  resolveVoiceStatus,
  voiceButtonLabel,
  type VoiceBlockedReason,
  type VoiceCaptureState,
  type VoiceStatus,
} from "../lib/voice-status";
import { useLatest } from "./useLatest";

/** Cuánto se mantiene visible el "Listo" antes de volver al reposo. */
const DONE_HOLD_MS = 2_600;

/** Lo que el hook necesita saber del turno del agente. */
export type VoiceAgentState = "idle" | "thinking" | "working" | "error";

export type VoiceController = {
  status: VoiceStatus;
  /** Etiqueta accesible del botón, coherente con la fase actual. */
  buttonLabel: string;
  engine: SpeechRecognitionController["engine"] | null;
  start: () => void;
  cancel: () => void;
  /** Vuelve al reposo tras cerrar sesión o resolver un fallo. */
  reset: () => void;
};

export type UseVoiceOptions = {
  onTranscript: (transcript: string) => void;
  /** Qué está haciendo el agente ahora mismo. */
  agentState: VoiceAgentState;
  currentTool?: string | null;
  blockedReason?: VoiceBlockedReason | null;
  agentIssue?: string | null;
  /** Inyectable para poder simular el micrófono en tests. */
  createController?: (
    callbacks: SpeechRecognitionCallbacks,
  ) => Promise<SpeechRecognitionController>;
};

/**
 * Ciclo de voz completo, de la captura a la respuesta.
 *
 * Junta las dos mitades que antes vivían separadas en App.tsx (el estado del
 * micrófono y el del turno) y las resuelve en una sola fase con su texto, para
 * que la persona sepa siempre en qué punto está.
 */
export function useVoice({
  onTranscript,
  agentState,
  currentTool = null,
  blockedReason = null,
  agentIssue = null,
  createController = createPreferredSpeechRecognitionController,
}: UseVoiceOptions): VoiceController {
  const [capture, setCapture] = useState<VoiceCaptureState>("idle");
  const [captureIssue, setCaptureIssue] = useState<string | null>(null);
  const [engine, setEngine] = useState<SpeechRecognitionController["engine"] | null>(null);
  const [recentlyDone, setRecentlyDone] = useState(false);

  const controllerRef = useRef<SpeechRecognitionController | null>(null);
  const onTranscriptRef = useLatest(onTranscript);

  useEffect(() => {
    let cancelled = false;
    let controller: SpeechRecognitionController | null = null;

    void createController({
      onResult: (transcript) => {
        setCapture("idle");
        setCaptureIssue(null);
        onTranscriptRef.current(transcript);
      },
      onError: (error) => {
        setCaptureIssue(error.message);
        setCapture(error.disableVoice ? "unsupported" : "error");
      },
      onEnd: () => {
        // Un fallo ya ha fijado su propia fase: no lo pisamos.
        setCapture((current) =>
          current === "listening" || current === "transcribing" ? "idle" : current,
        );
      },
      onPhase: (phase) => {
        setCapture((current) =>
          current === "unsupported" || current === "error" ? current : phase,
        );
      },
    }).then((next) => {
      if (cancelled) {
        next.dispose();
        return;
      }

      controller = next;
      controllerRef.current = next;
      setEngine(next.engine);

      if (!next.supported) {
        setCapture("unsupported");
        setCaptureIssue("Este equipo no tiene el micrófono preparado. Puedes escribirle a Pi.");
      }
    });

    return () => {
      cancelled = true;
      controller?.dispose();
      controllerRef.current = null;
    };
  }, [createController, onTranscriptRef]);

  /*
   * "Listo" es un estado de cortesía: confirma que Pi ha terminado y se
   * desvanece solo, sin dejar la pantalla anclada en un mensaje viejo.
   */
  const previousAgentStateRef = useRef<VoiceAgentState>("idle");

  useEffect(() => {
    const previous = previousAgentStateRef.current;
    previousAgentStateRef.current = agentState;

    if (agentState !== "idle") {
      setRecentlyDone(false);
      return;
    }

    if (previous !== "thinking" && previous !== "working") {
      return;
    }

    setRecentlyDone(true);
    const timer = window.setTimeout(() => setRecentlyDone(false), DONE_HOLD_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [agentState]);

  const status = useMemo(
    () =>
      resolveVoiceStatus({
        capture,
        turn: recentlyDone && agentState === "idle" ? "done" : agentState,
        currentTool,
        blockedReason,
        captureIssue,
        turnIssue: agentIssue,
      }),
    [agentIssue, agentState, blockedReason, capture, captureIssue, currentTool, recentlyDone],
  );

  const canListen = status.canListen;

  const start = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller?.supported || !canListen) {
      return;
    }

    setCaptureIssue(null);
    setCapture("listening");

    if (!controller.start()) {
      setCapture("error");
    }
  }, [canListen]);

  const cancel = useCallback(() => {
    controllerRef.current?.stop();
    setCapture((current) =>
      current === "listening" || current === "transcribing" ? "idle" : current,
    );
  }, []);

  const reset = useCallback(() => {
    setCapture((current) => (current === "unsupported" ? current : "idle"));
    setCaptureIssue(null);
  }, []);

  return {
    status,
    buttonLabel: voiceButtonLabel(status),
    engine,
    start,
    cancel,
    reset,
  };
}
