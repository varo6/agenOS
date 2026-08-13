export type PackageInstallToolResult = {
  ok: boolean;
  status: string;
  message: string;
  confirmationId?: string;
  packageName?: string;
  displayName?: string;
  selectionReason?: string;
};

export type PackageInstallToolService = {
  requestInstall(query: string): Promise<PackageInstallToolResult>;
  confirmInstall(confirmationId: string, onProgress?: (message: string) => void): Promise<PackageInstallToolResult>;
  denyInstall(confirmationId: string): PackageInstallToolResult | Promise<PackageInstallToolResult>;
};

type ToolUpdate = (update: {
  content: Array<{ type: "text"; text: string }>;
  details: unknown;
}) => void;

export type PackageInstallModelTool = {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
  parameters: unknown;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: ToolUpdate,
    context?: unknown,
  ): Promise<{ content: Array<{ type: "text"; text: string }>; details: PackageInstallToolResult }>;
};

const PARAMETERS = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["request", "confirm", "deny"],
      description: "request resuelve la app y prepara una confirmación; confirm/deny responden a una confirmación anterior después de la respuesta del usuario.",
    },
    app: {
      type: "string",
      description: "Nombre humano de la aplicación o paquete pedido por el usuario, por ejemplo Firefox, Chrome, VLC o editor de imágenes.",
    },
    confirmationId: {
      type: "string",
      description: "Identificador devuelto por request. Solo se usa en un turno posterior cuando el usuario ya ha dicho sí o no.",
    },
  },
  required: ["action"],
  additionalProperties: false,
};

export function createPackageInstallModelTool(service: PackageInstallToolService): PackageInstallModelTool {
  return {
    name: "apps_install",
    label: "Instalar aplicación",
    description: "Resuelve nombres humanos contra el catálogo Debian e instala una aplicación mediante el broker después de una confirmación.",
    promptSnippet: "apps_install: busca e instala aplicaciones Debian; siempre requiere una confirmación de un solo paso antes del cambio.",
    promptGuidelines: [
      "Cuando el usuario pida instalar una aplicación, llama action=request con el nombre que haya usado; no adivines tú el nombre del paquete Debian.",
      "Si request devuelve confirmation_required, explica brevemente qué paquete eligió y formula exactamente su pregunta de confirmación.",
      "No llames action=confirm en el mismo turno que action=request. Solo confirma en un turno posterior si el usuario responde afirmativamente de forma explícita.",
      "Si el usuario responde que no, llama action=deny. No vuelvas a solicitar la misma instalación.",
      "Durante confirm, comunica el progreso recibido y termina con el resultado exacto: instalado, ya estaba, no encontrado o fallo.",
    ],
    parameters: PARAMETERS,
    async execute(_toolCallId, params, _signal, onUpdate, context) {
      const action = params.action;
      let result: PackageInstallToolResult;
      if (action === "request") {
        onUpdate?.({
          content: [{ type: "text", text: "Buscando el paquete correcto en Debian…" }],
          details: { ok: true, status: "resolving" },
        });
        result = await service.requestInstall(typeof params.app === "string" ? params.app : "");
      } else if (action === "confirm") {
        if (!latestUserMessageIsAffirmative(context)) {
          result = {
            ok: false,
            status: "confirmation_required",
            message: "Aún no hay un sí explícito del usuario en un turno posterior; no se instaló nada.",
          };
        } else {
          result = await service.confirmInstall(
            typeof params.confirmationId === "string" ? params.confirmationId : "",
            (message) => onUpdate?.({
              content: [{ type: "text", text: message }],
              details: { ok: true, status: "installing", message },
            }),
          );
        }
      } else if (action === "deny") {
        result = await service.denyInstall(typeof params.confirmationId === "string" ? params.confirmationId : "");
      } else {
        result = { ok: false, status: "failed", message: "Acción de instalación no válida." };
      }

      return {
        content: [{ type: "text", text: result.message }],
        details: result,
      };
    },
  };
}

function latestUserMessageIsAffirmative(context: unknown): boolean {
  if (!context || typeof context !== "object") {
    return false;
  }
  const getBranch = (context as { sessionManager?: { getBranch?: unknown } }).sessionManager?.getBranch;
  if (typeof getBranch !== "function") {
    return false;
  }

  let entries: unknown;
  try {
    entries = getBranch.call((context as { sessionManager: object }).sessionManager);
  } catch {
    return false;
  }
  if (!Array.isArray(entries)) {
    return false;
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || typeof entry !== "object" || (entry as { type?: unknown }).type !== "message") {
      continue;
    }
    const message = (entry as { message?: unknown }).message;
    if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "user") {
      continue;
    }
    const text = messageText((message as { content?: unknown }).content);
    return isAffirmative(text);
  }
  return false;
}

function messageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map((item) => (
    item && typeof item === "object" && (item as { type?: unknown }).type === "text" && typeof (item as { text?: unknown }).text === "string"
      ? (item as { text: string }).text
      : ""
  )).join(" ");
}

function isAffirmative(value: string): boolean {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return new Set([
    "si",
    "si adelante",
    "si hazlo",
    "si instalalo",
    "si instala",
    "vale",
    "vale adelante",
    "de acuerdo",
    "adelante",
    "hazlo",
    "instalalo",
    "procede",
    "continua",
    "confirmo",
    "yes",
    "yes install it",
    "go ahead",
  ]).has(normalized);
}
