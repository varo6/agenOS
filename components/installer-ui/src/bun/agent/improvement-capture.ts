import type {
  ImprovementCaptureJob,
  ImprovementCaptureResponse,
  ImprovementDistiller,
  ImprovementSourceTurn,
} from "../../../../agent/improvements-types";
import type { createImprovementStore } from "./improvements";

type ImprovementStore = ReturnType<typeof createImprovementStore>;

/**
 * Turnos que se le ensenan al destilador.
 *
 * Dos, no uno: el turno marcado suele ser la respuesta buena, pero lo que hace
 * falta para reconocer la situacion la proxima vez esta en lo que el usuario
 * pidio antes. Con solo el ultimo turno salen notas que describen la respuesta
 * y no el caso.
 */
const SOURCE_TURN_WINDOW = 2;
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
    return recent.slice(Math.max(0, index - (SOURCE_TURN_WINDOW - 1)), index + 1);
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
      const draft = await options.distiller.distill({ turns, related })
        ?? await options.fallbackDistiller?.distill({ turns, related })
        ?? null;
      if (!draft) {
        settle(job, { status: "failed", error: "No se pudo resumir esta conversacion." });
        return;
      }

      const written = options.store.write(draft, turns.map((turn) => turn.turnId));
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

      /*
       * El mensaje habla de lo que el usuario acaba de hacer, no del trabajo
       * que se ha encolado. Nadie tiene que enterarse de que hay un destilador.
       */
      return {
        ok: true,
        jobId: job.jobId,
        status: job.status,
        message: "Lo tendre en cuenta la proxima vez.",
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
