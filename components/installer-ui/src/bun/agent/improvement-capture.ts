import type {
  ImprovementCaptureJob,
  ImprovementCaptureResponse,
  ImprovementDistiller,
  ImprovementSourceTurn,
} from "../../../../agent/improvements-types";
import type { createImprovementStore } from "./improvements";
import { isReusableImprovementDraft } from "./improvement-distiller";

type ImprovementStore = ReturnType<typeof createImprovementStore>;

/**
 * Turnos que se le ensenan al destilador.
 *
 * Cuatro permiten reconstruir peticion, correccion y solucion aceptada sin
 * mandar el historial completo al destilador.
 */
const SOURCE_TURN_WINDOW = 4;
const SOURCE_CONTEXT_MAX_CHARS = 12_000;
const SOURCE_FIELD_MAX_CHARS = SOURCE_CONTEXT_MAX_CHARS / (SOURCE_TURN_WINDOW * 2);
/** Dos destilados a la vez: cada uno es un proceso de modelo entero. */
const DEFAULT_MAX_CONCURRENT = 2;
const MAX_RETAINED_JOBS = 50;

export type ImprovementCaptureServiceOptions = {
  store: ImprovementStore;
  /** Destilador real. Puede devolver `null` si no hay Codex disponible. */
  distiller: ImprovementDistiller;
  /** Respaldo sin modelo. Solo entra cuando el real no ha producido nada. */
  fallbackDistiller?: ImprovementDistiller;
  /**
   * Turnos recientes, del mas antiguo al mas nuevo. Lo sirve el harness de Pi:
   * el texto no viaja desde el navegador, para que el contenido de una mejora
   * no dependa de lo que diga el cliente.
   */
  listTurns: (limit: number) => ImprovementSourceTurn[];
  now?: () => Date;
  jobIdFactory?: () => string;
  maxConcurrent?: number;
};

export type ImprovementCaptureService = {
  capture(turnId: string): ImprovementCaptureResponse;
  job(jobId: string): ImprovementCaptureJob | null;
  jobs(limit?: number): ImprovementCaptureJob[];
  /** Espera a que la cola se vacie. Existe para los tests y para el apagado. */
  drain(): Promise<void>;
};

export function createImprovementCaptureService(
  options: ImprovementCaptureServiceOptions,
): ImprovementCaptureService {
  const now = options.now ?? (() => new Date());
  const jobIdFactory = options.jobIdFactory
    ?? (() => `imp_${now().getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const maxConcurrent = Math.max(1, options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);

  const jobs = new Map<string, ImprovementCaptureJob>();
  const queue: ImprovementCaptureJob[] = [];
  const running = new Set<Promise<void>>();

  function remember(job: ImprovementCaptureJob): ImprovementCaptureJob {
    jobs.set(job.jobId, job);
    while (jobs.size > MAX_RETAINED_JOBS) {
      const oldest = jobs.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      jobs.delete(oldest);
    }
    options.store.recordJob(job);
    return job;
  }

  function settle(job: ImprovementCaptureJob, patch: Partial<ImprovementCaptureJob>): void {
    remember({ ...job, ...patch, finishedAt: now().toISOString() });
  }

  function sourceTurnsFor(turnId: string): ImprovementSourceTurn[] {
    const recent = options.listTurns(20);
    const index = recent.findIndex((turn) => turn.turnId === turnId);
    if (index === -1) {
      return [];
    }
    const window = recent.slice(Math.max(0, index - (SOURCE_TURN_WINDOW - 1)), index + 1);
    return window.map((turn) => ({
      ...turn,
      input: turn.input.slice(0, SOURCE_FIELD_MAX_CHARS),
      reply: turn.reply.slice(0, SOURCE_FIELD_MAX_CHARS),
    }));
  }

  /**
   * Mejoras que ya cubren algo parecido, para que el destilador pueda fusionar.
   * Sin esto, marcar cinco veces la misma preferencia deja cinco notas casi
   * iguales y el catalogo, que es lo unico que se paga en cada conversacion,
   * crece sin que mejore nada.
   */
  function relatedTo(turns: ImprovementSourceTurn[]) {
    const query = turns.map((turn) => turn.input).join(" ");
    return options.store
      .search(query, 3)
      .map((match) => options.store.get(match.name))
      .filter((improvement): improvement is NonNullable<typeof improvement> => improvement !== null);
  }

  async function run(job: ImprovementCaptureJob): Promise<void> {
    const turns = sourceTurnsFor(job.turnId);
    if (turns.length === 0) {
      settle(job, { status: "failed", error: "El turno ya no esta en el historial." });
      return;
    }

    try {
      const related = relatedTo(turns);
      const primary = await options.distiller.distill({ turns, related });
      const draft = primary && isReusableImprovementDraft(primary, turns)
        ? primary
        : await options.fallbackDistiller?.distill({ turns, related }) ?? null;
      if (!draft) {
        settle(job, { status: "failed", error: "No se pudo resumir esta conversacion." });
        return;
      }
      if (!isReusableImprovementDraft(draft, turns)) {
        settle(job, { status: "failed", error: "No se pudo extraer una preferencia reutilizable." });
        return;
      }

      const availableIds = new Set(turns.map((turn) => turn.turnId));
      const sourceTurnIds = draft.sourceTurnIds.filter((turnId) => availableIds.has(turnId));
      const written = options.store.write(draft, sourceTurnIds.length > 0 ? sourceTurnIds : turns.map((turn) => turn.turnId));
      settle(job, { status: "succeeded", name: written.name, category: written.category });
    } catch (error) {
      /*
       * El destilado es trabajo de fondo de algo que el usuario ya da por
       * hecho: si falla, se anota y se calla. Propagarlo solo serviria para
       * tumbar al broker por una nota que nadie estaba esperando.
       */
      settle(job, {
        status: "failed",
        error: error instanceof Error ? error.message : "Fallo al guardar la mejora.",
      });
    }
  }

  function pump(): void {
    while (running.size < maxConcurrent && queue.length > 0) {
      const job = queue.shift();
      if (!job) {
        return;
      }
      remember({ ...job, status: "running" });
      const task = run(job).finally(() => {
        running.delete(task);
        pump();
      });
      running.add(task);
    }
  }

  const latestPersisted = new Map<string, ImprovementCaptureJob>();
  for (const persisted of options.store.jobs(Number.MAX_SAFE_INTEGER)) {
    if (!latestPersisted.has(persisted.jobId)) {
      latestPersisted.set(persisted.jobId, persisted);
    }
  }
  for (const persisted of [...latestPersisted.values()].reverse()) {
    jobs.set(persisted.jobId, persisted);
    if (persisted.status === "queued" || persisted.status === "running") {
      const recovered: ImprovementCaptureJob = {
        jobId: persisted.jobId,
        turnId: persisted.turnId,
        status: "queued",
        createdAt: persisted.createdAt,
      };
      remember(recovered);
      queue.push(recovered);
    }
  }
  pump();

  return {
    capture(turnId: string): ImprovementCaptureResponse {
      const job: ImprovementCaptureJob = {
        jobId: jobIdFactory(),
        turnId,
        status: "queued",
        createdAt: now().toISOString(),
      };
      remember(job);
      queue.push(job);
      pump();

      return {
        ok: true,
        jobId: job.jobId,
        status: job.status,
        message: "Guardando…",
      };
    },
    job(jobId: string) {
      return jobs.get(jobId) ?? null;
    },
    jobs(limit = 20) {
      return Array.from(jobs.values()).slice(-Math.max(1, limit)).reverse();
    },
    async drain() {
      while (running.size > 0 || queue.length > 0) {
        await Promise.allSettled([...running]);
      }
    },
  };
}
