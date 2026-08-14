type PiCustomToolLike = {
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
    onUpdate?: unknown,
    ctx?: unknown,
  ): Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }>;
};

export type AgentTaskSummary = {
  taskId: string;
  status: string;
  progress: number;
  message: string;
  lastError: string | null;
  timestamp?: string;
  source?: string;
};

export type AgentTaskEvent = {
  type: string;
  message: string;
  timestamp: string;
  progress?: number;
};

export type AgentTaskEnqueueResult = {
  ok: boolean;
  taskId?: string;
  message?: string;
};

export type AgentWorkerHealthSummary = {
  ok: boolean;
  mode: string;
  serviceActive?: boolean;
  queueDepth?: number;
  degradedReason?: string | null;
  lastError?: string | null;
};

export type AgentTaskClient = {
  enqueue(message: string): Promise<AgentTaskEnqueueResult>;
  status(taskId: string): Promise<AgentTaskSummary | null>;
  events(taskId: string): Promise<AgentTaskEvent[]>;
  list(limit?: number): Promise<AgentTaskSummary[]>;
  health(): Promise<AgentWorkerHealthSummary>;
};

export type HttpAgentTaskClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
};

const AGENT_API_BASE_DEFAULT = "http://127.0.0.1:4173";
const HTTP_TIMEOUT_MS = 10_000;

export function resolveAgentApiBase(env: Record<string, string | undefined> = process.env): string {
  return env.AGENOS_AGENT_API_BASE?.trim() || AGENT_API_BASE_DEFAULT;
}

export function createHttpAgentTaskClient(options: HttpAgentTaskClientOptions = {}): AgentTaskClient {
  const baseUrl = options.baseUrl ?? resolveAgentApiBase(options.env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? HTTP_TIMEOUT_MS;

  async function requestJson<T>(path: string, init?: RequestInit): Promise<{ status: number; payload: T | undefined }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(new URL(path, `${baseUrl}/`).toString(), {
        ...init,
        signal: controller.signal,
      });
      const text = await response.text();
      return {
        status: response.status,
        payload: text ? JSON.parse(text) as T : undefined,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("La solicitud al broker de agenOS excedio el tiempo limite.");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async enqueue(message) {
      const { payload } = await requestJson<AgentTaskEnqueueResult>("/api/agent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, source: "ui" }),
      });
      return payload ?? { ok: false, message: "El broker no devolvio respuesta." };
    },
    async status(taskId) {
      const { status, payload } = await requestJson<AgentTaskSummary>(`/api/agent/tasks/${encodeURIComponent(taskId)}`);
      return status === 404 ? null : payload ?? null;
    },
    async events(taskId) {
      const { payload } = await requestJson<AgentTaskEvent[]>(`/api/agent/tasks/${encodeURIComponent(taskId)}/events`);
      return Array.isArray(payload) ? payload : [];
    },
    async list(limit = 10) {
      const { payload } = await requestJson<AgentTaskSummary[]>(`/api/agent/tasks?limit=${encodeURIComponent(String(limit))}`);
      return Array.isArray(payload) ? payload : [];
    },
    async health() {
      const { payload } = await requestJson<AgentWorkerHealthSummary>("/api/agent/worker/health");
      return payload ?? { ok: false, mode: "unknown", degradedReason: "El broker no devolvio estado del worker." };
    },
  };
}

const AGENT_TASK_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["delegate", "status", "list", "health"],
      description: "delegate: envia una tarea al backend OpenClaw. status: consulta una tarea por taskId. list: lista tareas recientes. health: estado del worker OpenClaw.",
    },
    message: {
      type: "string",
      description: "Instruccion completa y autocontenida de la tarea a delegar. Solo para action delegate.",
    },
    taskId: {
      type: "string",
      description: "Identificador de la tarea a consultar. Solo para action status.",
    },
    waitSeconds: {
      type: "number",
      description: "Segundos maximos a esperar el resultado antes de dejar la tarea en background. Solo para delegate. Por defecto 15, maximo 120.",
    },
    limit: {
      type: "number",
      description: "Numero de tareas a listar. Solo para action list. Por defecto 10.",
    },
  },
  required: ["action"],
  additionalProperties: false,
};

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const DEFAULT_WAIT_SECONDS = 15;
const MAX_WAIT_SECONDS = 120;
const POLL_INTERVAL_MS = 1_500;
const EVENT_TAIL = 5;

export type AgentTaskToolOptions = {
  pollIntervalMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      signal?.removeEventListener("abort", finish);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", finish, { once: true });
  });
}

function describeStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "en cola";
    case "running":
      return "en ejecucion";
    case "waiting_confirmation":
      return "esperando confirmacion del usuario";
    case "succeeded":
      return "completada";
    case "failed":
      return "fallida";
    case "cancelled":
      return "cancelada";
    default:
      return status;
  }
}

function describeEvents(events: AgentTaskEvent[]): string {
  if (events.length === 0) {
    return "";
  }

  const tail = events.slice(-EVENT_TAIL);
  return `\neventos recientes:\n${tail.map((event) => `- ${event.type}: ${event.message}`).join("\n")}`;
}

function describeTask(task: AgentTaskSummary, events: AgentTaskEvent[]): string {
  const lines = [
    `Tarea ${task.taskId}: ${describeStatusLabel(task.status)} (progreso ${Math.round(task.progress)}%).`,
    `instruccion: ${task.message}`,
  ];

  if (task.lastError) {
    lines.push(`ultimo error: ${task.lastError}`);
  }

  if (task.status === "waiting_confirmation") {
    lines.push("La tarea necesita que el usuario confirme una accion pendiente antes de continuar.");
  }

  return lines.join("\n") + describeEvents(events);
}

export function createAgentTaskModelTool(
  client: AgentTaskClient = createHttpAgentTaskClient(),
  options: AgentTaskToolOptions = {},
): PiCustomToolLike {
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const sleep = options.sleep ?? defaultSleep;

  async function delegate(params: Record<string, unknown>, signal?: AbortSignal) {
    const message = typeof params.message === "string" ? params.message.trim() : "";
    if (!message) {
      return {
        content: [{ type: "text" as const, text: "Error: se necesita message con la instruccion de la tarea a delegar." }],
        details: { error: "Missing message" },
      };
    }

    const enqueued = await client.enqueue(message);
    if (!enqueued.ok || !enqueued.taskId) {
      return {
        content: [{
          type: "text" as const,
          text: `No se pudo delegar la tarea al backend OpenClaw: ${enqueued.message ?? "error desconocido"}. Puedes revisar el worker con action health o intentar resolverla tu mismo en primer plano.`,
        }],
        details: enqueued,
      };
    }

    const waitSecondsRaw = typeof params.waitSeconds === "number" && Number.isFinite(params.waitSeconds)
      ? params.waitSeconds
      : DEFAULT_WAIT_SECONDS;
    const waitMs = Math.max(0, Math.min(waitSecondsRaw, MAX_WAIT_SECONDS)) * 1000;
    const deadline = Date.now() + waitMs;

    let task = await client.status(enqueued.taskId);
    while (
      task
      && !TERMINAL_STATUSES.has(task.status)
      && task.status !== "waiting_confirmation"
      && Date.now() < deadline
      && !signal?.aborted
    ) {
      await sleep(pollIntervalMs, signal);
      task = await client.status(enqueued.taskId);
    }

    if (!task) {
      return {
        content: [{
          type: "text" as const,
          text: `Tarea delegada con taskId ${enqueued.taskId}, pero el broker aun no reporta su estado. Consulta mas tarde con action status.`,
        }],
        details: enqueued,
      };
    }

    const events = await client.events(task.taskId);
    const stillRunning = !TERMINAL_STATUSES.has(task.status) && task.status !== "waiting_confirmation";
    const text = stillRunning
      ? `${describeTask(task, events)}\nLa tarea sigue ejecutandose en background en OpenClaw; el usuario puede seguir usando agenOS. Consulta el avance con action status y taskId ${task.taskId} cuando el usuario lo pida.`
      : describeTask(task, events);

    return {
      content: [{ type: "text" as const, text }],
      details: { task, events },
    };
  }

  return {
    name: "agent_task",
    label: "Delegar en OpenClaw",
    description: "Delegar tareas largas o de background al backend OpenClaw de agenOS y consultar su progreso.",
    promptSnippet: "agent_task: delega tareas largas o de background al backend OpenClaw (el mismo que atiende Telegram) y consulta su progreso.",
    promptGuidelines: [
      "Usa agent_task con action delegate para tareas largas, autonomas o de background que no necesiten la pantalla del usuario; escribe message como una instruccion completa y autocontenida.",
      "Sigue resolviendo tu mismo en primer plano lo interactivo e inmediato que cubran tus tools mediadas: abrir apps o archivos y responder preguntas.",
      "Si el usuario pide algo 'en background', 'mientras tanto', 'aunque me vaya' o menciona OpenClaw o Telegram, delega con agent_task.",
      "Tras delegar, informa al usuario del taskId y consulta el avance con action status cuando lo pida; no bloquees la conversacion esperando tareas largas.",
      "Si delegate falla o el worker esta degradado (action health), dilo claramente y ofrece hacer la tarea en primer plano si es viable.",
    ],
    parameters: AGENT_TASK_TOOL_PARAMETERS,
    async execute(_toolCallId, params, signal) {
      const action = params.action as string;

      switch (action) {
        case "delegate":
          return delegate(params, signal);
        case "status": {
          const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
          if (!taskId) {
            return {
              content: [{ type: "text", text: "Error: se necesita taskId para consultar una tarea." }],
              details: { error: "Missing taskId" },
            };
          }

          const task = await client.status(taskId);
          if (!task) {
            return {
              content: [{ type: "text", text: `No existe ninguna tarea con taskId ${taskId}.` }],
              details: { taskId },
            };
          }

          const events = await client.events(taskId);
          return {
            content: [{ type: "text", text: describeTask(task, events) }],
            details: { task, events },
          };
        }
        case "list": {
          const limit = typeof params.limit === "number" && Number.isFinite(params.limit)
            ? Math.max(1, Math.min(Math.floor(params.limit), 50))
            : 10;
          const tasks = await client.list(limit);
          if (tasks.length === 0) {
            return {
              content: [{ type: "text", text: "No hay tareas delegadas en el backend OpenClaw." }],
              details: { tasks },
            };
          }

          const text = `Tareas recientes en OpenClaw:\n${tasks
            .map((task) => `- ${task.taskId}: ${describeStatusLabel(task.status)} — ${task.message}`)
            .join("\n")}`;
          return {
            content: [{ type: "text", text }],
            details: { tasks },
          };
        }
        case "health": {
          const health = await client.health();
          const lines = [
            `Worker OpenClaw: ${health.ok ? "operativo" : "degradado o no disponible"} (modo ${health.mode}).`,
            typeof health.queueDepth === "number" ? `tareas en cola: ${health.queueDepth}` : "",
            health.degradedReason ? `motivo de degradacion: ${health.degradedReason}` : "",
            health.lastError ? `ultimo error: ${health.lastError}` : "",
          ].filter(Boolean);
          return {
            content: [{ type: "text", text: lines.join("\n") }],
            details: health,
          };
        }
        default:
          return {
            content: [{ type: "text", text: `Error: accion desconocida '${action}'.` }],
            details: { error: "Unknown action" },
          };
      }
    },
  };
}
