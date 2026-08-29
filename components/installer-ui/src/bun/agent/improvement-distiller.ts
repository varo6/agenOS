import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

type SpawnImpl = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; stdio: ["pipe", "pipe", "pipe"] },
) => ChildProcess;

export type CodexImprovementDistillerOptions = {
  spawnImpl?: SpawnImpl;
  env?: NodeJS.ProcessEnv;
  codexBinary?: string;
  timeoutMs?: number;
  model?: string;
  now?: () => Date;
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

const DEFAULT_TIMEOUT_MS = 90_000;
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+){0,5}$/;
const STOP_WORDS = new Set([
  "a", "al", "algo", "ante", "asi", "como", "con", "contra", "cual", "cuando", "de", "del", "desde",
  "donde", "el", "en", "entre", "es", "esa", "ese", "eso", "esta", "este", "esto", "hacer", "la", "las",
  "le", "lo", "los", "mas", "me", "mi", "mis", "no", "o", "para", "pero", "por", "que", "quiero", "se",
  "si", "sin", "sobre", "su", "sus", "te", "un", "una", "y",
]);

export function createCodexImprovementDistiller(options: CodexImprovementDistillerOptions = {}): ImprovementDistiller {
  const env = options.env ?? process.env;
  const spawnImpl = options.spawnImpl ?? defaultSpawn;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());

  return {
    async distill(input) {
      const codexBinary = resolveCodexBinary({ explicit: options.codexBinary, env });
      if (!codexBinary) {
        return null;
      }

      const tempDir = mkdtempSync(join(tmpdir(), `agenos-improvement-${now().getTime().toString(36)}-`));
      const schemaPath = join(tempDir, "schema.json");
      const outputPath = join(tempDir, "out.json");

      try {
        writeFileSync(schemaPath, `${JSON.stringify(IMPROVEMENT_DRAFT_JSON_SCHEMA, null, 2)}\n`, { mode: 0o600 });
        const args = [
          "exec",
          "--skip-git-repo-check",
          "--ephemeral",
          "--ignore-user-config",
          "-s",
          "read-only",
          "--color",
          "never",
          "--output-schema",
          schemaPath,
          "--output-last-message",
          outputPath,
          ...(options.model ? ["-m", options.model] : []),
          "-",
        ];
        const result = await runCodex({
          codexBinary,
          args,
          env,
          prompt: buildDistillerPrompt(input),
          outputPath,
          signal: input.signal,
          timeoutMs,
          spawnImpl,
        });
        return result;
      } catch {
        return null;
      } finally {
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // El destilado es trabajo de fondo; un fallo limpiando temporales no debe propagarse.
        }
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

function runCodex(input: {
  codexBinary: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  prompt: string;
  outputPath: string;
  signal?: AbortSignal;
  timeoutMs: number;
  spawnImpl: SpawnImpl;
}): Promise<ImprovementDraft | null> {
  return new Promise((resolve) => {
    let settled = false;
    let child: ChildProcess | null = null;

    const finish = (result: ImprovementDraft | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      resolve(result);
    };

    const abort = () => {
      child?.kill("SIGTERM");
      finish(null);
    };

    const timer = setTimeout(() => {
      child?.kill("SIGTERM");
      finish(null);
    }, input.timeoutMs);

    if (input.signal?.aborted) {
      finish(null);
      return;
    }
    input.signal?.addEventListener("abort", abort, { once: true });

    try {
      child = input.spawnImpl(input.codexBinary, input.args, {
        env: input.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.once("error", () => finish(null));
      child.once("exit", (code) => {
        if (code !== 0) {
          finish(null);
          return;
        }
        try {
          const raw = readFileSync(input.outputPath, "utf8");
          finish(parseDraft(raw));
        } catch {
          finish(null);
        }
      });
      child.stdin?.write(input.prompt);
      child.stdin?.end();
    } catch {
      child?.kill("SIGTERM");
      finish(null);
    }
  });
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

function defaultSpawn(command: string, args: string[], options: { env: NodeJS.ProcessEnv; stdio: ["pipe", "pipe", "pipe"] }): ChildProcess {
  return spawn(command, args, options);
}

function resolveCodexBinary(input: { explicit?: string; env: NodeJS.ProcessEnv }): string | null {
  return input.explicit?.trim()
    || input.env.AGENOS_CODEX_BIN?.trim()
    || lookupOnPath("codex", input.env.PATH);
}

function lookupOnPath(binary: string, pathValue: string | undefined): string | null {
  for (const dir of (pathValue ?? "").split(":")) {
    if (!dir) {
      continue;
    }
    const candidate = join(dir, binary);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
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
