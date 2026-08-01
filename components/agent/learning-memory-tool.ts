import type { HarnessTraceRecord } from "./harness-trace";
import { resolveAgentApiBase } from "./agent-task-tool";

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

export type LearnedMemorySummary = {
  itemId: string;
  kind: "preference" | "procedure" | "avoidance";
  statement: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  sourceSignalIds: string[];
  userEdited: boolean;
};

export type LearnedContextResponse = {
  text: string;
  itemIds: string[];
  estimatedTokens: number;
  tokenBudget: number;
  truncated: boolean;
};

export type LearningMemoryClient = {
  list(includeDeleted?: boolean): Promise<LearnedMemorySummary[]>;
  correct(itemId: string, statement: string): Promise<LearnedMemorySummary | null>;
  forget(itemId: string): Promise<LearnedMemorySummary | null>;
  context(query: string, tokenBudget?: number): Promise<LearnedContextResponse>;
  captureTrace(trace: HarnessTraceRecord): Promise<void>;
};

export type HttpLearningMemoryClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
};

const HTTP_TIMEOUT_MS = 10_000;

export function createHttpLearningMemoryClient(options: HttpLearningMemoryClientOptions = {}): LearningMemoryClient {
  const baseUrl = options.baseUrl ?? resolveAgentApiBase(options.env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? HTTP_TIMEOUT_MS;

  async function request<T>(path: string, init?: RequestInit): Promise<{ status: number; payload?: T }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(new URL(path, `${baseUrl}/`).toString(), { ...init, signal: controller.signal });
      const body = await response.text();
      return { status: response.status, payload: body ? JSON.parse(body) as T : undefined };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async list(includeDeleted = false) {
      const { payload } = await request<LearnedMemorySummary[]>(`/api/agent/learning/memories?includeDeleted=${includeDeleted ? "true" : "false"}`);
      return Array.isArray(payload) ? payload : [];
    },
    async correct(itemId, statement) {
      const { status, payload } = await request<LearnedMemorySummary>(`/api/agent/learning/memories/${encodeURIComponent(itemId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statement, explicitUserIntent: true }),
      });
      return status === 404 ? null : payload ?? null;
    },
    async forget(itemId) {
      const { status, payload } = await request<LearnedMemorySummary>(`/api/agent/learning/memories/${encodeURIComponent(itemId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ explicitUserIntent: true }),
      });
      return status === 404 ? null : payload ?? null;
    },
    async context(query, tokenBudget = 256) {
      const params = new URLSearchParams({ query, tokenBudget: String(tokenBudget) });
      const { payload } = await request<LearnedContextResponse>(`/api/agent/learning/context?${params.toString()}`);
      return payload ?? { text: "", itemIds: [], estimatedTokens: 0, tokenBudget, truncated: false };
    },
    async captureTrace(trace) {
      await request("/api/agent/learning/signals/harness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trace),
      });
    },
  };
}

const PARAMETERS = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["list", "correct", "forget"],
      description: "list: muestra lo aprendido. correct: corrige una entrada. forget: borra una entrada.",
    },
    itemId: { type: "string", description: "ID visible de la memoria; necesario para correct y forget." },
    statement: { type: "string", description: "Texto corregido; necesario para correct." },
    includeDeleted: { type: "boolean", description: "Incluye el historial de entradas borradas al listar." },
  },
  required: ["action"],
  additionalProperties: false,
};

export function createLearningMemoryModelTool(client: LearningMemoryClient = createHttpLearningMemoryClient()): PiCustomToolLike {
  return {
    name: "learning_memory",
    label: "Memoria aprendida",
    description: "Muestra, corrige o elimina preferencias y lecciones aprendidas por Pi.",
    promptSnippet: "learning_memory: permite al usuario auditar, corregir y olvidar lo que Pi ha aprendido.",
    promptGuidelines: [
      "Usa action list cuando el usuario pregunte que has aprendido, que recuerdas o que preferencias guardas.",
      "Usa action correct solo cuando el usuario pida corregir una entrada concreta; conserva y menciona su itemId.",
      "Usa action forget cuando el usuario pida olvidar o borrar una entrada concreta. La accion es explicita y auditable.",
      "No afirmes que una propuesta pendiente ya fue aprendida: solo las memorias confirmadas aparecen en list.",
    ],
    parameters: PARAMETERS,
    async execute(_toolCallId, params) {
      const action = params.action;
      if (action === "list") {
        const memories = await client.list(params.includeDeleted === true);
        const text = memories.length === 0
          ? "Pi no tiene memorias aprendidas activas. Las propuestas pendientes requieren confirmacion del usuario."
          : `Memorias aprendidas:\n${memories.map((item) => `- ${item.itemId} [${item.kind}, caduca ${item.expiresAt}]: ${item.statement}`).join("\n")}`;
        return { content: [{ type: "text", text }], details: { memories } };
      }

      const itemId = typeof params.itemId === "string" ? params.itemId.trim() : "";
      if (!itemId) {
        return { content: [{ type: "text", text: "Error: se necesita itemId." }], details: { error: "Missing itemId" } };
      }
      if (action === "correct") {
        const statement = typeof params.statement === "string" ? params.statement.trim() : "";
        if (!statement) {
          return { content: [{ type: "text", text: "Error: se necesita statement con la correccion." }], details: { error: "Missing statement" } };
        }
        const memory = await client.correct(itemId, statement);
        return memory
          ? { content: [{ type: "text", text: `Memoria ${itemId} corregida: ${memory.statement}` }], details: { memory } }
          : { content: [{ type: "text", text: `No existe una memoria activa con itemId ${itemId}.` }], details: { itemId } };
      }
      if (action === "forget") {
        const memory = await client.forget(itemId);
        return memory
          ? { content: [{ type: "text", text: `Memoria ${itemId} eliminada. Ya no se inyectara en el contexto de Pi.` }], details: { memory } }
          : { content: [{ type: "text", text: `No existe una memoria activa con itemId ${itemId}.` }], details: { itemId } };
      }
      return { content: [{ type: "text", text: "Error: action debe ser list, correct o forget." }], details: { error: "Invalid action" } };
    },
  };
}
