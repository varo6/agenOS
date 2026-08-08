import type { PiAuthState } from "./pi-types";
import type { AgentAdminStatus } from "./system-types";
import type { VoiceBlockedReason, VoiceTurnState } from "./voice-status";

/**
 * Estado derivado del shell.
 *
 * App reúne señales de cinco hooks distintos (red, sesión, salud del backend,
 * conversación y voz) y todas ellas se cruzan para decidir tres cosas: qué fase
 * enseña el orbe, por qué no se puede hablar y si la pantalla principal debe
 * pedir algo antes de dejar usar a Pi. Ese cruce vive aquí, puro y probado, en
 * vez de repartido por el JSX.
 */

/** Fase del turno que entiende el ciclo de voz (`VoiceAgentState` del hook). */
export type ShellAgentState = Exclude<VoiceTurnState, "done">;

/** Estado de la conversación (`ConversationState` del hook). */
export type ShellConversationState = "idle" | "processing" | "error";

export type AgentActivity = {
  conversationState: ShellConversationState;
  /** El servicio de Pi está atendiendo otra petición (p. ej. otra ventana). */
  sessionBusy: boolean;
  /** Herramienta en uso del turno en curso, si la hay. */
  currentTool: string | null;
};

/** Hay trabajo en vuelo, venga de esta pantalla o del propio servicio. */
export function isAgentBusy(activity: AgentActivity): boolean {
  return activity.conversationState === "processing" || activity.sessionBusy;
}

/**
 * Traduce la conversación a la fase del orbe. "Ejecutando" solo se afirma
 * cuando hay una herramienta concreta en marcha: decirlo sin saberlo sería
 * prometer más de lo que se sabe.
 */
export function resolveAgentState(activity: AgentActivity): ShellAgentState {
  if (isAgentBusy(activity)) {
    return activity.currentTool ? "working" : "thinking";
  }

  return activity.conversationState === "error" ? "error" : "idle";
}

export type AccessSignals = {
  /** `null` mientras no se ha comprobado la red. */
  online: boolean | null;
  authState: PiAuthState;
  busy: boolean;
};

/**
 * Por qué no se puede hablar ahora mismo. El orden es el de la cadena real de
 * dependencias: sin red no hay cuenta, y sin cuenta no hay turno.
 */
export function resolveBlockedReason(signals: AccessSignals): VoiceBlockedReason | null {
  if (signals.online !== true) {
    return "offline";
  }

  if (signals.authState !== "connected") {
    return "disconnected";
  }

  return signals.busy ? "busy" : null;
}

/**
 * Ayuda bajo el campo de texto cuando está deshabilitado. Un campo apagado sin
 * explicación es el peor estado posible: parece que la interfaz está rota.
 */
export function describeComposerBlock(
  reason: VoiceBlockedReason | null,
  serviceReady: boolean,
): string | null {
  if (!serviceReady) {
    return "Pi no responde ahora mismo.";
  }

  switch (reason) {
    case "offline":
      return "Sin internet no puedo enviarle nada a Pi.";
    case "disconnected":
      return "Conecta tu cuenta de ChatGPT.";
    case "busy":
      return "Pi está respondiendo, espera un momento.";
    default:
      return null;
  }
}

export type ShellReadiness = "checking" | "blocked" | "ready";

export type ReadinessSignals = {
  /** El servicio local de Pi responde. */
  harnessAvailable: boolean;
  backendError: string | null;
  adminStatus: Pick<AgentAdminStatus, "readiness"> | null;
  authState: PiAuthState;
};

/**
 * Si la pantalla principal tiene que pedir algo antes de poder usar a Pi.
 *
 * `checking` es deliberado: mientras no hay lectura del backend no se acusa a
 * nadie de estar mal configurado, para no enseñar un aviso que desaparece solo
 * un segundo después.
 */
/**
 * Si merece la pena mirar Sistema. Sirve para marcar la pestaña cuando algo va
 * mal sin llegar a impedir la conversación: sin esta señal, un fallo que no
 * bloquea sería invisible hasta que alguien entrase por casualidad.
 */
export function needsSystemAttention(signals: ReadinessSignals): boolean {
  if (!signals.harnessAvailable || signals.backendError) {
    return true;
  }

  // Sin lectura todavía no se acusa a nadie, igual que en la readiness.
  if (!signals.adminStatus) {
    return false;
  }

  return signals.adminStatus.readiness !== "ready" || signals.authState !== "connected";
}

export function resolveShellReadiness(signals: ReadinessSignals): ShellReadiness {
  if (!signals.harnessAvailable || signals.backendError) {
    return "blocked";
  }

  if (!signals.adminStatus) {
    return "checking";
  }

  if (signals.adminStatus.readiness !== "ready" || signals.authState !== "connected") {
    return "blocked";
  }

  return "ready";
}
