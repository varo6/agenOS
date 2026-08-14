import type { Tone } from "./tone";

/**
 * Traducción de fallos técnicos a avisos accionables.
 *
 * Antes los errores llegaban a la pantalla tal cual venían del cliente HTTP
 * ("Failed to fetch", "codex login --device-auth termino con codigo 1"), que no
 * le dicen nada a quien usa el portátil. Aquí se clasifican y se convierten en
 * "qué ha pasado" + "qué puedes hacer", guardando el texto original como
 * detalle para soporte.
 */

export type UserErrorKind =
  | "offline"
  | "unreachable"
  | "timeout"
  | "unauthorized"
  | "lostTurn"
  | "login"
  | "unknown";

/** Acción de recuperación que la pantalla puede ofrecer. */
export type UserErrorAction = "retry" | "reconnect" | "openNetwork" | "openSystem";

export type UserError = {
  kind: UserErrorKind;
  /** Qué ha pasado, en una frase y sin jerga. */
  title: string;
  /** Qué puede hacer la persona a continuación. */
  hint: string;
  tone: Tone;
  action: UserErrorAction;
  /** Mensaje original, plegado en la interfaz para soporte. */
  details: string | null;
};

/*
 * Un titular y una sola instrucción. El botón que arregla cada fallo va al
 * lado, así que la ayuda no tiene que explicar también cómo llegar hasta él.
 */
const COPY: Record<UserErrorKind, Pick<UserError, "title" | "hint" | "tone" | "action">> = {
  offline: {
    title: "Sin internet",
    hint: "Conéctate a una red wifi.",
    tone: "warning",
    action: "openNetwork",
  },
  unreachable: {
    title: "AgenOS no responde ahora mismo",
    hint: "Espera unos segundos y vuelve a intentarlo.",
    tone: "danger",
    action: "retry",
  },
  timeout: {
    title: "Pi ha tardado demasiado en contestar",
    hint: "Vuelve a pedírselo.",
    tone: "warning",
    action: "retry",
  },
  unauthorized: {
    title: "Tu cuenta se ha desconectado",
    hint: "Vuelve a conectar ChatGPT.",
    tone: "warning",
    action: "reconnect",
  },
  lostTurn: {
    title: "Se ha perdido la respuesta",
    hint: "Vuelve a pedírselo.",
    tone: "warning",
    action: "retry",
  },
  login: {
    title: "No se pudo conectar tu cuenta",
    hint: "Inténtalo otra vez.",
    tone: "danger",
    action: "reconnect",
  },
  unknown: {
    title: "Algo no ha salido bien",
    hint: "Vuelve a intentarlo.",
    tone: "danger",
    action: "openSystem",
  },
};

/** Quita tildes y baja a minúsculas para poder buscar frases sin depender del acento. */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Mensaje crudo de cualquier error, con un texto de respaldo en español. */
export function describeClientError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return "No se pudo completar la acción.";
}

function readStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }

  return undefined;
}

export function classifyError(error: unknown, status?: number): UserErrorKind {
  const httpStatus = status ?? readStatus(error);
  if (httpStatus === 401 || httpStatus === 403) {
    return "unauthorized";
  }
  if (httpStatus === 404) {
    return "lostTurn";
  }

  const message = normalize(describeClientError(error));

  if (/sin conexion|sin internet|conecta agenos a internet|no hay internet|captive/.test(message)) {
    return "offline";
  }
  if (/tiempo limite|timed out|timeout|abort/.test(message)) {
    return "timeout";
  }
  if (/failed to fetch|fetch failed|networkerror|load failed|econnrefused|connection refused|network request failed|no se pudo conectar/.test(message)) {
    return "unreachable";
  }
  if (/codex login|device-auth|inicio de sesion|autenticacion|no se pudo completar el login/.test(message)) {
    return "login";
  }
  if (/harness de desarrollo no disponible|broker|no responde|servicio local/.test(message)) {
    return "unreachable";
  }

  return "unknown";
}

export type ToUserErrorOptions = {
  status?: number;
  /** Fuerza una clasificación cuando quien llama ya sabe qué ha fallado. */
  kind?: UserErrorKind;
};

/** Convierte cualquier fallo en un aviso que la persona pueda entender y resolver. */
export function toUserError(error: unknown, options: ToUserErrorOptions = {}): UserError {
  const raw = describeClientError(error);
  const kind = options.kind ?? classifyError(error, options.status);
  const copy = COPY[kind];

  return {
    kind,
    ...copy,
    details: normalize(raw) === normalize(copy.title) ? null : raw,
  };
}
