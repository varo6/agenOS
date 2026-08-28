import { describeTool } from "./agent-activity";
import type { Tone } from "./tone";

/**
 * Máquina de estados del ciclo de voz.
 *
 * En una interfaz voice-first lo más importante es que la persona sepa, sin
 * leer documentación, en qué punto está: si le estamos escuchando, si le hemos
 * entendido, si Pi está pensando, si está haciendo algo o si ha fallado.
 *
 * Este módulo es puro: recibe las señales sueltas (captura de audio, turno del
 * agente, motivos de bloqueo) y devuelve una sola fase con su texto. La capa de
 * render solo pinta lo que le llega, y el anuncio para lectores de pantalla
 * sale exactamente de la misma fuente que el texto visible.
 */

export type VoicePhase =
  | "unavailable"
  | "blocked"
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "working"
  | "done"
  | "error";

/** Estado del micrófono y de la transcripción local. */
export type VoiceCaptureState = "idle" | "listening" | "transcribing" | "error" | "unsupported";

/** Estado del turno del agente, independiente de si vino por voz o por texto. */
export type VoiceTurnState = "idle" | "thinking" | "working" | "done" | "error";

/** Por qué no se puede hablar ahora mismo, aunque el micrófono funcione. */
export type VoiceBlockedReason = "offline" | "disconnected" | "busy";

export type VoiceStatusInput = {
  capture: VoiceCaptureState;
  turn: VoiceTurnState;
  /** Herramienta que Pi está usando, si está en fase `working`. */
  currentTool?: string | null;
  blockedReason?: VoiceBlockedReason | null;
  /** Mensaje del fallo de captura, ya en lenguaje llano. */
  captureIssue?: string | null;
  /** Mensaje del fallo del turno, ya en lenguaje llano. */
  turnIssue?: string | null;
};

export type VoiceStatus = {
  phase: VoicePhase;
  /** Titular corto bajo el orbe. */
  title: string;
  /** Segunda línea: qué se espera de la persona o qué está pasando. */
  hint: string;
  tone: Tone;
  /** Texto que se anuncia por `aria-live` al cambiar de fase. */
  announcement: string;
  /** Hay trabajo en curso: el orbe late y el micro no acepta una nueva frase. */
  busy: boolean;
  /** El micrófono admite una frase nueva ahora mismo. */
  canListen: boolean;
};

/*
 * Una línea por motivo. Antes cada bloqueo explicaba la causa y el remedio en
 * frases largas; quien tiene el micrófono apagado solo necesita saber qué
 * falta, y el botón que lo arregla ya está en pantalla.
 */
const BLOCKED_COPY: Record<VoiceBlockedReason, { title: string; hint: string; tone: Tone }> = {
  offline: {
    title: "Sin internet",
    hint: "Conéctate a una red wifi.",
    tone: "warning",
  },
  disconnected: {
    title: "Falta conectar tu cuenta",
    hint: "Conecta ChatGPT para hablar.",
    tone: "warning",
  },
  busy: {
    title: "Pi está trabajando",
    hint: "Espera un momento.",
    tone: "accent",
  },
};

function build(
  phase: VoicePhase,
  title: string,
  hint: string,
  tone: Tone,
  options: { busy?: boolean; canListen?: boolean; announcement?: string } = {},
): VoiceStatus {
  return {
    phase,
    title,
    hint,
    tone,
    announcement: options.announcement ?? `${title}. ${hint}`,
    busy: options.busy ?? false,
    canListen: options.canListen ?? false,
  };
}

/**
 * Resuelve la fase visible. El orden de precedencia importa: lo que está
 * pasando ahora mismo (escuchar, transcribir, trabajar) manda sobre cualquier
 * motivo de bloqueo, porque durante un turno el sistema también está "ocupado".
 */
export function resolveVoiceStatus(input: VoiceStatusInput): VoiceStatus {
  const { capture, turn, currentTool, blockedReason, captureIssue, turnIssue } = input;

  if (capture === "unsupported") {
    return build(
      "unavailable",
      "El micrófono no funciona",
      captureIssue ?? "Escríbele a Pi aquí abajo.",
      "neutral",
    );
  }

  if (capture === "listening") {
    return build("listening", "Te escucho", "Habla con calma.", "info", {
      busy: true,
    });
  }

  if (capture === "transcribing") {
    return build("transcribing", "Estoy entendiéndote", "Un momento.", "info", { busy: true });
  }

  if (capture === "error") {
    return build("error", "No te he entendido", captureIssue ?? "Inténtalo otra vez.", "danger", {
      canListen: true,
    });
  }

  if (turn === "working") {
    const activity = currentTool ? describeTool(currentTool) : "trabajando en tu petición";
    return build("working", `Pi está ${activity}`, "Un momento.", "accent", {
      busy: true,
      announcement: `Pi está ${activity}.`,
    });
  }

  if (turn === "thinking") {
    return build("thinking", "Pi está pensando", "Un momento.", "accent", {
      busy: true,
      announcement: "Pi está pensando.",
    });
  }

  if (turn === "error") {
    return build("error", "Pi no ha podido terminar", turnIssue ?? "Vuelve a pedírselo.", "danger", {
      canListen: !blockedReason,
    });
  }

  if (turn === "done") {
    return build("done", "Listo", "Pulsa para hablar otra vez.", "positive", {
      canListen: !blockedReason,
      announcement: "Pi ha terminado.",
    });
  }

  if (blockedReason) {
    const copy = BLOCKED_COPY[blockedReason];
    return build("blocked", copy.title, copy.hint, copy.tone);
  }

  return build("idle", "Pulsa para hablar", "O escríbele aquí abajo.", "neutral", {
    canListen: true,
  });
}

/**
 * Etiqueta accesible del botón del micrófono. Cambia con la fase para que quien
 * navega con lector de pantalla sepa qué hace el botón en cada momento.
 */
export function voiceButtonLabel(status: VoiceStatus): string {
  switch (status.phase) {
    case "listening":
      return "Escuchando, pulsa para procesar el audio";
    case "transcribing":
      return "Estoy entendiéndote";
    case "thinking":
    case "working":
      return "Pi está trabajando";
    case "unavailable":
      return "Micrófono no disponible";
    case "blocked":
      return `Micrófono no disponible: ${status.title.toLowerCase()}`;
    default:
      return "Hablar con Pi";
  }
}
