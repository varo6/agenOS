import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";

import {
  PI_PROVIDER_ID,
  resolvePiHarnessPaths,
  writePiCustomModels,
} from "../../../../ui/dev/pi-harness";
import {
  IMPROVEMENT_CATEGORIES,
  isImprovementCategory,
  MAX_IMPROVEMENT_BODY_LENGTH,
  MAX_IMPROVEMENT_TITLE_LENGTH,
  MAX_IMPROVEMENT_TRIGGERS,
  type Improvement,
  type ImprovementConfidence,
  type ImprovementDistiller,
  type ImprovementDraft,
  type ImprovementSourceTurn,
} from "../../../../agent/improvements-types";
import { redactHarnessTraceText } from "../../../../agent/harness-trace";

/*
 * El destilador es un subagente de Pi, no un proceso de Codex aparte.
 *
 * Antes esto lanzaba `codex exec`, que trae su propio `~/.codex/auth.json`: el
 * usuario ya habia conectado ChatGPT en la pantalla de Pi y aun asi el boton
 * "Guardar en memoria" se quedaba mudo, porque el binario pedia un login que
 * nadie iba a completar desde un trabajo de fondo. Reusando el AuthStorage del
 * harness, destilar cuesta exactamente el mismo inicio de sesion que hablar
 * con Pi: ninguno adicional.
 *
 * Es un subagente y no la sesion de Pi: sesion propia y en memoria, sin
 * herramientas y con su propio prompt de sistema. Escribir en el hilo del
 * usuario para pedir un JSON le cambiaria el contexto a mitad de conversacion.
 */
export const IMPROVEMENT_DISTILLER_MODEL_ID = "gpt-5.6-terra";
export const IMPROVEMENT_DISTILLER_THINKING_LEVEL = "medium" as const;

export type ImprovementDistillerSession = {
  prompt(text: string): Promise<void>;
  abort?(): Promise<void>;
  dispose?(): void;
  state?: { messages?: Array<{ role?: string; content?: unknown }> };
};

export type CreateImprovementDistillerSession = (input: {
  modelId: string;
  thinkingLevel: typeof IMPROVEMENT_DISTILLER_THINKING_LEVEL;
  systemPrompt: string;
}) => Promise<ImprovementDistillerSession | null>;

export type PiImprovementDistillerOptions = {
  createSession?: CreateImprovementDistillerSession;
  timeoutMs?: number;
};

export const IMPROVEMENT_DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["abstain", "confidence", "sourceTurnIds", "category", "name", "title", "triggers", "body"],
  properties: {
    abstain: { type: "boolean" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    sourceTurnIds: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: { type: "string", minLength: 1 },
    },
    category: { type: "string", enum: IMPROVEMENT_CATEGORIES },
    name: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+){0,5}$" },
    title: { type: "string", minLength: 1, maxLength: MAX_IMPROVEMENT_TITLE_LENGTH },
    triggers: {
      type: "array",
      minItems: 1,
      maxItems: MAX_IMPROVEMENT_TRIGGERS,
      items: { type: "string", minLength: 1 },
    },
    body: { type: "string", minLength: 1, maxLength: MAX_IMPROVEMENT_BODY_LENGTH },
    replaces: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+){0,5}$" },
  },
};

/*
 * `codex exec` validaba la respuesta contra el esquema con `--output-schema`.
 * El SDK del harness no tiene ese equivalente, asi que el contrato viaja en el
 * prompt de sistema y `validateImprovementDraft` sigue siendo quien decide si
 * lo que vuelve se puede guardar.
 */
export const IMPROVEMENT_DISTILLER_SYSTEM_PROMPT = [
  "Eres un subagente de Pi dedicado a destilar mejoras. No tienes herramientas y no actuas sobre el sistema: lees la conversacion que se te pasa y devuelves JSON.",
  "Responde exclusivamente con un objeto JSON que valide contra este esquema. Sin prosa, sin explicaciones y sin bloques de codigo.",
  JSON.stringify(IMPROVEMENT_DRAFT_JSON_SCHEMA, null, 2),
].join("\n\n");

const DEFAULT_TIMEOUT_MS = 90_000;
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+){0,5}$/;
const STOP_WORDS = new Set([
  "a", "al", "algo", "ante", "asi", "como", "con", "contra", "cual", "cuando", "de", "del", "desde",
  "donde", "el", "en", "entre", "es", "esa", "ese", "eso", "esta", "este", "esto", "hacer", "la", "las",
  "le", "lo", "los", "mas", "me", "mi", "mis", "no", "o", "para", "pero", "por", "que", "quiero", "se",
  "si", "sin", "sobre", "su", "sus", "te", "un", "una", "y",
]);

export function createPiImprovementDistiller(options: PiImprovementDistillerOptions = {}): ImprovementDistiller {
  const createSession = options.createSession ?? createPiDistillerSession;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async distill(input) {
      let session: ImprovementDistillerSession | null = null;

      try {
        session = await createSession({
          modelId: IMPROVEMENT_DISTILLER_MODEL_ID,
          thinkingLevel: IMPROVEMENT_DISTILLER_THINKING_LEVEL,
          systemPrompt: IMPROVEMENT_DISTILLER_SYSTEM_PROMPT,
        });
        if (!session) {
          return null;
        }

        const answered = await promptWithDeadline({
          session,
          text: buildDistillerPrompt(input),
          timeoutMs,
          signal: input.signal,
        });
        return answered ? parseDraft(lastAssistantText(session)) : null;
      } catch {
        return null;
      } finally {
        session?.dispose?.();
      }
    },
  };
}

export function createFallbackImprovementDistiller(options: { now?: () => Date } = {}): ImprovementDistiller {
  const now = options.now ?? (() => new Date());
  void now;

  return {
    async distill(input) {
      const preferenceIndex = findPreferenceTurn(input.turns);
      const preferenceTurn = preferenceIndex >= 0 ? input.turns[preferenceIndex] : undefined;
      if (!preferenceTurn) {
        return null;
      }

      const correction = cleanInlineText(preferenceTurn.input, 240);
      const originalTurn = input.turns.slice(0, preferenceIndex).reverse()
        .find((turn) => turn.input.trim() && !hasPreferenceSignal(turn.input));
      const original = cleanInlineText(originalTurn?.input ?? "una peticion parecida", 180);
      const words = significantWords(`${original} ${correction}`);
      const triggers = words.length > 0 ? words : ["general"];
      const name = slugFromWords(words.slice(0, 4)) ?? "mejora-general";
      const draft = {
        category: "general",
        name,
        title: `Preferencia para ${original}`,
        triggers,
        body: `Cuando te pida ${original}, aplica esta preferencia: ${correction}.`,
        confidence: originalTurn ? "medium" : "low",
        sourceTurnIds: [originalTurn?.turnId, preferenceTurn.turnId].filter((turnId): turnId is string => Boolean(turnId)),
      };
      return validateImprovementDraft(draft);
    },
  };
}

export function validateImprovementDraft(value: unknown): ImprovementDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const response = value as Partial<ImprovementDraft> & { abstain?: unknown };
  if (response.abstain === true) {
    return null;
  }
  const draft = response;
  if (!isImprovementCategory(draft.category) || !validName(draft.name)) {
    return null;
  }
  if (draft.replaces !== undefined && !validName(draft.replaces)) {
    return null;
  }
  if (typeof draft.title !== "string" || typeof draft.body !== "string" || !Array.isArray(draft.triggers)) {
    return null;
  }

  const title = cleanInlineText(draft.title, MAX_IMPROVEMENT_TITLE_LENGTH);
  const body = cleanMarkdownText(draft.body, MAX_IMPROVEMENT_BODY_LENGTH);
  if (!title || !body || isPromptControlAttempt(title) || isPromptControlAttempt(body)) {
    return null;
  }

  const triggers = normalizeTriggers(draft.triggers);
  if (triggers.length === 0) {
    return null;
  }

  const confidence: ImprovementConfidence = draft.confidence === "high" || draft.confidence === "low"
    ? draft.confidence
    : "medium";
  const sourceTurnIds = Array.isArray(draft.sourceTurnIds)
    ? Array.from(new Set(draft.sourceTurnIds.filter((turnId): turnId is string => typeof turnId === "string" && Boolean(turnId.trim())))).slice(-4)
    : [];

  return {
    category: draft.category,
    name: draft.name,
    title,
    triggers,
    body,
    confidence,
    sourceTurnIds,
    ...(draft.replaces ? { replaces: draft.replaces } : {}),
  };
}

/** Descarta borradores que parecen una copia o una instantanea del momento. */
export function isReusableImprovementDraft(
  draft: ImprovementDraft,
  turns: ImprovementSourceTurn[],
): boolean {
  const body = cleanInlineText(draft.body, MAX_IMPROVEMENT_BODY_LENGTH).toLowerCase();
  if (/\b(?:disponible|disponibles)\s+(?:ahora|hoy|mañana)\b|\b(?:quedan|hay)\s+\d+\b|\b\d{1,2}:\d{2}\b|(?:€|\$|\b(?:eur|usd)\b)\s*\d/i.test(body)) {
    return false;
  }

  for (const turn of turns) {
    const words = cleanInlineText(turn.reply, 2_000).toLowerCase().split(/\s+/).filter(Boolean);
    for (let index = 0; index + 12 <= words.length; index += 1) {
      if (body.includes(words.slice(index, index + 12).join(" "))) {
        return false;
      }
    }
  }
  return true;
}

export function buildDistillerPrompt(input: { turns: ImprovementSourceTurn[]; related: Improvement[] }): string {
  const turns = input.turns.slice(-4).map((turn, index, turnsSlice) => {
    const marked = index === turnsSlice.length - 1 ? " (marcado por el usuario)" : "";
    return [
      `Turno ${index + 1}${marked}`,
      `turnId: ${turn.turnId}`,
      `Usuario: ${cleanInlineText(turn.input, 2_000)}`,
      `Pi: ${cleanMarkdownText(turn.reply, 2_000)}`,
    ].join("\n");
  }).join("\n\n");

  const related = input.related.length
    ? input.related.map((improvement) => [
      `- name: ${improvement.name}`,
      `  category: ${improvement.category}`,
      `  title: ${cleanInlineText(improvement.title, MAX_IMPROVEMENT_TITLE_LENGTH)}`,
      `  triggers: ${improvement.triggers.join(", ")}`,
      `  body: ${cleanMarkdownText(improvement.body, MAX_IMPROVEMENT_BODY_LENGTH)}`,
    ].join("\n")).join("\n")
    : "- Ninguna.";

  return [
    "Eres el destilador de mejoras de Pi.",
    "",
    "El usuario ha pulsado \"Guardar en memoria\" bajo la ultima respuesta de Pi. Debes inferir que parte reutilizable quiere conservar. El ultimo turno es el marcado.",
    "Recibes hasta cuatro turnos. Usa solo los necesarios y devuelve sus turnId en sourceTurnIds.",
    "",
    "Reconstruye mentalmente cuatro piezas antes de responder: la peticion original, la correccion o preferencia, la solucion finalmente aceptada y la regla general que Pi debe aplicar en el futuro.",
    "Guarda la regla general, no una cronica. Escribe una nota breve, en espanol y dirigida a Pi. Forma esperada: \"Cuando te pida X, haz Y\".",
    "El cuerpo debe ser Markdown plano, maximo 900 caracteres, idealmente 2-5 lineas de lista. No escribas preambulos ni repitas la conversacion.",
    "No copies respuestas ni fragmentos largos. No guardes resultados temporales, precios, horas, disponibilidad, estados actuales ni detalles que solo valian en ese momento.",
    "Una preferencia puede ser implicita. Ejemplo: usuario pide jugar al ajedrez, Pi abre Chess.com, usuario prefiere una alternativa open source y Pi abre Lichess. Regla: cuando quiera jugar al ajedrez, abre Lichess en vez de Chess.com.",
    "Abstente con abstain=true solo si el contexto esta vacio o es incoherente, no contiene ninguna informacion util, o resulta realmente imposible identificar que quiere recordar. La duda o una confianza media no justifican abstenerse.",
    "confidence es high, medium o low y se guarda para auditoria. Nunca uses la confianza para decidir por si sola si guardas.",
    `category debe ser obligatoriamente una de estas ocho: ${IMPROVEMENT_CATEGORIES.join(", ")}.`,
    "name debe ser un slug kebab-case, sin acentos, de 2-4 palabras, y describir la situacion (por ejemplo \"reservar-restaurante\"), no la respuesta concreta.",
    "triggers debe contener 3-8 palabras clave en minusculas y sin acentos por las que el usuario volveria a pedir esto.",
    "Si una mejora relacionada ya cubre lo mismo, devuelve replaces con su name y un body fusionado; no crees una nota duplicada.",
    "Si guardas, usa abstain=false. Si te abstienes, rellena los demas campos con valores validos y minimos; se ignoraran. Responde SOLO el JSON que cumple el esquema.",
    "",
    "Turnos:",
    turns || "Ningun turno.",
    "",
    "Mejoras relacionadas:",
    related,
  ].join("\n");
}

/**
 * Lanza el turno y garantiza que el trabajo termina.
 *
 * El destilado corre en segundo plano detras de un boton: si el modelo se
 * queda colgado, nadie lo esta mirando. Al vencer el plazo o al cancelarse la
 * captura se aborta la sesion y se devuelve false, que en `distill` significa
 * "sin borrador" y deja paso al destilador de respaldo.
 */
async function promptWithDeadline(input: {
  session: ImprovementDistillerSession;
  text: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<boolean> {
  if (input.signal?.aborted) {
    return false;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  const stopped = new Promise<false>((resolve) => {
    const stop = () => {
      void input.session.abort?.().catch(() => undefined);
      resolve(false);
    };
    timer = setTimeout(stop, input.timeoutMs);
    onAbort = stop;
    input.signal?.addEventListener("abort", stop, { once: true });
  });

  try {
    return await Promise.race([input.session.prompt(input.text).then(() => true), stopped]);
  } finally {
    clearTimeout(timer);
    if (onAbort) {
      input.signal?.removeEventListener("abort", onAbort);
    }
  }
}

/**
 * Sesion de destilado sobre las credenciales del harness de Pi.
 *
 * Devuelve null cuando el usuario todavia no ha conectado ChatGPT: sin
 * credenciales no hay nada que reutilizar y el destilado no es un buen momento
 * para pedir un login.
 */
async function createPiDistillerSession(input: {
  modelId: string;
  thinkingLevel: typeof IMPROVEMENT_DISTILLER_THINKING_LEVEL;
  systemPrompt: string;
}): Promise<ImprovementDistillerSession | null> {
  const paths = resolvePiHarnessPaths();
  const authStorage = AuthStorage.create(paths.authPath);
  if (authStorage.get(PI_PROVIDER_ID)?.type !== "oauth") {
    return null;
  }

  // Mismo motivo que en el harness: sin models.json el registro no conoce los
  // GPT-5.6 y `find` no encontraria el modelo del destilador.
  writePiCustomModels(paths.modelsPath);
  const modelRegistry = ModelRegistry.create(authStorage, paths.modelsPath);
  const model = selectDistillerModel(modelRegistry, input.modelId);
  if (!model) {
    return null;
  }

  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: paths.agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => input.systemPrompt,
    appendSystemPromptOverride: () => [],
  });
  await resourceLoader.reload();

  const created = await createAgentSession({
    cwd: process.cwd(),
    agentDir: paths.agentDir,
    authStorage,
    modelRegistry,
    model,
    thinkingLevel: input.thinkingLevel,
    // El destilador solo escribe texto. Sin herramientas no hay nada que
    // confirmar ni que aislar, que es lo que daba `--sandbox read-only`.
    noTools: "all",
    tools: [],
    customTools: [],
    // En memoria a proposito: el subagente no debe aparecer en el historial de
    // la conversacion del usuario ni heredarlo.
    sessionManager: SessionManager.inMemory(process.cwd()),
    settingsManager,
    resourceLoader,
  });

  return created.session as unknown as ImprovementDistillerSession;
}

function selectDistillerModel(
  modelRegistry: ModelRegistry,
  modelId: string,
): ReturnType<ModelRegistry["find"]> {
  const exact = modelRegistry.find(PI_PROVIDER_ID, modelId);
  if (exact) {
    return exact;
  }

  // Mismo criterio que `selectModel` en el harness: preferimos destilar con
  // otro modelo a perder la funcionalidad, pero la caida no puede ser muda.
  const fallback = modelRegistry.getAll().find((candidate) => candidate.provider === PI_PROVIDER_ID);
  if (fallback) {
    console.warn(`[improvements] ${modelId} no esta en el registro. Destilo con ${fallback.id}.`);
  }
  return fallback;
}

function lastAssistantText(session: ImprovementDistillerSession): string {
  const messages = session.state?.messages;
  if (!Array.isArray(messages)) {
    return "";
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      return extractTextContent(message.content);
    }
  }

  return "";
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      const candidate = item as { type?: unknown; text?: unknown } | null;
      return candidate?.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
    })
    .join("");
}

function parseDraft(raw: string): ImprovementDraft | null {
  const stripped = stripJsonFence(raw.trim());
  try {
    return validateImprovementDraft(JSON.parse(stripped) as unknown);
  } catch {
    return null;
  }
}

function stripJsonFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? value;
}

function validName(value: unknown): value is string {
  return typeof value === "string" && NAME_PATTERN.test(value);
}

function cleanInlineText(value: string, maxLength: number): string {
  const redacted = redactHarnessTraceText(value).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return redacted.slice(0, maxLength);
}

function cleanMarkdownText(value: string, maxLength: number): string {
  const redacted = redactHarnessTraceText(value)
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return redacted.slice(0, maxLength);
}

function normalizeTriggers(values: unknown[]): string[] {
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === "string")
    .map((value) => normalizeWord(value))
    .filter(Boolean)))
    .slice(0, MAX_IMPROVEMENT_TRIGGERS);
}

function significantWords(value: string): string[] {
  return Array.from(new Set(value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[a-z0-9]{2,}/g) ?? []))
    .filter((word) => !STOP_WORDS.has(word))
    .slice(0, MAX_IMPROVEMENT_TRIGGERS);
}

function normalizeWord(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

function slugFromWords(words: string[]): string | null {
  const slug = words.map(normalizeWord).filter(Boolean).slice(0, 4).join("-");
  return NAME_PATTERN.test(slug) ? slug : null;
}

function isPromptControlAttempt(statement: string): boolean {
  return /\b(ignora(r)?|omite)\b.{0,40}\b(instrucciones|prompt|sistema)\b/i.test(statement)
    || /\b(system prompt|developer message|actua como sistema|revela tus instrucciones)\b/i.test(statement);
}

const PREFERENCE_SIGNAL = /\b(prefier(?:o|es|e)|mejor|en vez de|en lugar de|no uses?|no utilices?|usa esta|usa esto|utiliza esta|alternativa|rather than|instead of|i prefer|don't use|do not use|use this)\b/i;

function hasPreferenceSignal(value: string): boolean {
  return PREFERENCE_SIGNAL.test(value);
}

function findPreferenceTurn(turns: ImprovementSourceTurn[]): number {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (hasPreferenceSignal(turns[index]?.input ?? "")) {
      return index;
    }
  }
  return -1;
}
