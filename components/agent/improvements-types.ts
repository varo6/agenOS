/**
 * Mejoras del usuario: contrato compartido.
 *
 * Una "mejora" es una nota corta en Markdown que el usuario marca pulsando
 * "Guardar en memoria" bajo una respuesta que le ha gustado. A partir de ese
 * gesto, un destilador en segundo plano escribe la nota; en conversaciones
 * futuras Pi la recupera cuando la peticion se parece a la que la origino.
 *
 * Este modulo no tiene implementacion a proposito: lo importan el broker
 * (`installer-ui/src/bun/agent/`), el model tool (`components/agent/`) y la UI
 * (`components/ui/src/`), y ninguno de los tres debe arrastrar dependencias de
 * los otros dos.
 */

/**
 * Taxonomia cerrada.
 *
 * Cerrada a proposito: con categorias libres el destilador acabaria creando
 * "correo", "email" y "gmail" como tres cajones distintos, el catalogo se
 * duplicaria y el enrutado dejaria de ser predecible. Ocho cajones cubren la
 * superficie real de tools de Pi y caben en una sola pantalla.
 */
export const IMPROVEMENT_CATEGORIES = [
  "correo",
  "calendario",
  "web",
  "escritorio",
  "archivos",
  "sistema",
  "estilo",
  "general",
] as const;

export type ImprovementCategory = (typeof IMPROVEMENT_CATEGORIES)[number];

export function isImprovementCategory(value: unknown): value is ImprovementCategory {
  return typeof value === "string" && (IMPROVEMENT_CATEGORIES as readonly string[]).includes(value);
}

/** Titulo de una linea del catalogo, en espanol y en palabras del usuario. */
export const MAX_IMPROVEMENT_TITLE_LENGTH = 80;
/**
 * Cuerpo deliberadamente corto. La mejora es una nota de contexto, no un
 * manual: si crece, satura el turno en el que se lee y deja de compensar.
 */
export const MAX_IMPROVEMENT_BODY_LENGTH = 900;
export const MAX_IMPROVEMENT_TRIGGERS = 12;
/** Techo global del almacen. Al superarlo se desaloja la menos usada. */
export const MAX_IMPROVEMENTS = 120;
/** Presupuesto del catalogo que se inyecta al abrir conversacion. */
export const DEFAULT_CATALOG_TOKEN_BUDGET = 1_200;

/** Metadatos del frontmatter YAML de `<categoria>/<name>.md`. */
export type ImprovementFrontmatter = {
  /** Slug kebab-case, unico dentro de su categoria. Es el nombre del fichero. */
  name: string;
  category: ImprovementCategory;
  /** Una linea: lo que el usuario reconoceria como "esto es lo que quiero". */
  title: string;
  /** Palabras clave para el emparejado por solape; sin acentos ni mayusculas. */
  triggers: string[];
  createdAt: string;
  updatedAt: string;
  /** Turnos de Pi que originaron la mejora. Para auditoria, no para contexto. */
  sourceTurnIds: string[];
  /** Sube en cada fusion; sirve para ver si una nota se ha ido reescribiendo. */
  version: number;
  /** Ultima vez que Pi la leyo de verdad. Rige el desalojo. */
  lastUsedAt?: string;
};

/** Una mejora completa: frontmatter mas el cuerpo Markdown. */
export type Improvement = ImprovementFrontmatter & {
  body: string;
};

/** Entrada del catalogo: lo unico que se inyecta al abrir conversacion. */
export type ImprovementCatalogEntry = Pick<
  ImprovementFrontmatter,
  "name" | "category" | "title"
>;

/**
 * Catalogo listo para el prompt de sistema.
 *
 * `text` es el bloque en Markdown ya recortado al presupuesto; `truncated`
 * avisa de que hay mejoras fuera y de que a Pi le toca usar `search`.
 */
export type ImprovementCatalog = {
  text: string;
  entries: ImprovementCatalogEntry[];
  estimatedTokens: number;
  tokenBudget: number;
  truncated: boolean;
  /** Total en disco, truncado o no. */
  total: number;
};

/** Resultado de `search`, ordenado por solape de `triggers` descendente. */
export type ImprovementMatch = ImprovementCatalogEntry & {
  score: number;
};

/** Lo que el destilador debe devolver, ya validado. */
export type ImprovementDraft = {
  category: ImprovementCategory;
  name: string;
  title: string;
  triggers: string[];
  body: string;
  /**
   * Nombre de una mejora existente que este borrador sustituye. El destilador
   * solo puede fusionar dentro de la categoria que se le ofrecio.
   */
  replaces?: string;
};

/** Turno de conversacion tal y como llega al destilador. */
export type ImprovementSourceTurn = {
  turnId: string;
  input: string;
  reply: string;
};

/** Trabajo de destilado encolado por el boton. */
export type ImprovementCaptureJobStatus = "queued" | "running" | "succeeded" | "failed";

export type ImprovementCaptureJob = {
  jobId: string;
  turnId: string;
  status: ImprovementCaptureJobStatus;
  createdAt: string;
  finishedAt?: string;
  /** Mejora escrita, cuando el trabajo termino bien. */
  name?: string;
  category?: ImprovementCategory;
  /** Motivo del fallo, en espanol y sin datos del usuario. */
  error?: string;
};

/** Respuesta de `POST /api/agent/improvements/capture`. */
export type ImprovementCaptureResponse = {
  ok: boolean;
  jobId: string;
  status: ImprovementCaptureJobStatus;
  /** Frase para el usuario; nunca explica el mecanismo. */
  message: string;
};

/**
 * Destilador: convierte uno o dos turnos en un borrador de mejora.
 *
 * Es una interfaz y no una funcion concreta porque hay tres implementaciones
 * previstas: la real (`codex exec`), la de respaldo (sin modelo, cuando Codex
 * no esta disponible) y la falsa de los tests.
 */
export type ImprovementDistiller = {
  distill(input: {
    turns: ImprovementSourceTurn[];
    /**
     * Mejoras ya existentes que se parecen a esta captura. El destilador las
     * recibe para poder fusionar en vez de duplicar.
     */
    related: Improvement[];
    signal?: AbortSignal;
  }): Promise<ImprovementDraft | null>;
};
