import { describe, expect, test } from "bun:test";

import { createImprovementCaptureService } from "./improvement-capture";
import type {
  Improvement,
  ImprovementCaptureJob,
  ImprovementDistiller,
  ImprovementDraft,
  ImprovementMatch,
  ImprovementSourceTurn,
} from "../../../../agent/improvements-types";

function turn(turnId: string, input: string, reply = `respuesta a ${input}`): ImprovementSourceTurn {
  return { turnId, input, reply };
}

function improvement(name: string): Improvement {
  return {
    name,
    category: "web",
    title: `Titulo de ${name}`,
    triggers: [name],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sourceTurnIds: [],
    version: 1,
    confidence: "medium",
    body: `Cuerpo de ${name}`,
  };
}

type FakeStore = {
  written: Array<{ draft: ImprovementDraft; sourceTurnIds: string[] }>;
  recorded: ImprovementCaptureJob[];
  search(query: string, limit?: number): ImprovementMatch[];
  get(name: string): Improvement | null;
  write(draft: ImprovementDraft, sourceTurnIds: string[]): Improvement;
  recordJob(job: ImprovementCaptureJob): void;
  jobs(limit?: number): ImprovementCaptureJob[];
};

function createFakeStore(overrides: Partial<FakeStore> = {}): FakeStore {
  const store: FakeStore = {
    written: [],
    recorded: [],
    search: () => [],
    get: (name) => improvement(name),
    write(draft, sourceTurnIds) {
      store.written.push({ draft, sourceTurnIds });
      return { ...improvement(draft.name), category: draft.category, body: draft.body, title: draft.title };
    },
    recordJob(job) {
      store.recorded.push(job);
    },
    jobs(limit = 20) {
      return store.recorded.slice(-limit).reverse();
    },
    ...overrides,
  };
  return store;
}

function draftFor(name: string): ImprovementDraft {
  return {
    category: "web", name, title: `Titulo ${name}`, triggers: [name], body: "Haz esto.", confidence: "medium", sourceTurnIds: [],
  };
}

function distillerReturning(draft: ImprovementDraft | null, calls: unknown[] = []): ImprovementDistiller {
  return {
    async distill(input) {
      calls.push(input);
      return draft;
    },
  };
}

// El servicio se apoya en el store real solo por su forma; aqui basta el trozo
// que toca, asi que el cast mantiene el test legible sin arrastrar el modulo.
function service(options: Parameters<typeof createImprovementCaptureService>[0]) {
  return createImprovementCaptureService(options);
}

describe("createImprovementCaptureService", () => {
  for (const count of [2, 3, 4]) {
    test(`conserva el contexto necesario de una preferencia en ${count} turnos`, async () => {
      const calls: Array<{ turns: ImprovementSourceTurn[] }> = [];
      const turns = Array.from({ length: count }, (_, index) => turn(`t${index + 1}`, `paso ${index + 1}`));
      const capture = service({
        store: createFakeStore() as never,
        distiller: distillerReturning({ ...draftFor(`preferencia-${count}`), sourceTurnIds: turns.map((item) => item.turnId) }, calls as unknown[]),
        listTurns: () => turns,
      });

      capture.capture(`t${count}`);
      await capture.drain();

      expect(calls[0]?.turns.map((item) => item.turnId)).toEqual(turns.map((item) => item.turnId));
    });
  }

  test("responde al instante y destila despues", async () => {
    const store = createFakeStore();
    const capture = service({
      store: store as never,
      distiller: distillerReturning(draftFor("reservar-mesa")),
      listTurns: () => [turn("t1", "reserva mesa")],
    });

    const response = capture.capture("t1");
    expect(response.ok).toBe(true);
    expect(response.status).toBe("queued");
    expect(response.message).not.toContain("destil");
    expect(store.written).toHaveLength(0);

    await capture.drain();
    expect(store.written).toHaveLength(1);
    expect(store.written[0]?.draft.name).toBe("reservar-mesa");
    expect(capture.job(response.jobId)?.status).toBe("succeeded");
  });

  test("le pasa al destilador hasta cuatro turnos incluido el marcado", async () => {
    const calls: Array<{ turns: ImprovementSourceTurn[] }> = [];
    const capture = service({
      store: createFakeStore() as never,
      distiller: distillerReturning(draftFor("a"), calls as unknown[]),
      listTurns: () => [turn("t0", "hola"), turn("t1", "juega"), turn("t2", "prefiero otra"), turn("t3", "abre esa"), turn("t4", "gracias")],
    });

    capture.capture("t3");
    await capture.drain();

    expect(calls[0]?.turns.map((item) => item.turnId)).toEqual(["t0", "t1", "t2", "t3"]);
  });

  test("acota el texto sin expulsar ninguno de los cuatro turnos", async () => {
    const calls: Array<{ turns: ImprovementSourceTurn[] }> = [];
    const capture = service({
      store: createFakeStore() as never,
      distiller: distillerReturning(draftFor("acotada"), calls as unknown[]),
      listTurns: () => ["t1", "t2", "t3", "t4"].map((id) => turn(id, "u".repeat(4_000), "p".repeat(4_000))),
    });

    capture.capture("t4");
    await capture.drain();

    expect(calls[0]?.turns).toHaveLength(4);
    expect(calls[0]?.turns.reduce((sum, item) => sum + item.input.length + item.reply.length, 0)).toBeLessThanOrEqual(12_000);
  });

  test("ofrece las mejoras parecidas para que el destilador fusione", async () => {
    const calls: Array<{ related: Improvement[] }> = [];
    const store = createFakeStore({
      search: () => [{ name: "reservar-mesa", category: "web", title: "Reservar", score: 0.9 }],
    });
    const capture = service({
      store: store as never,
      distiller: distillerReturning(draftFor("a"), calls as unknown[]),
      listTurns: () => [turn("t1", "reserva mesa")],
    });

    capture.capture("t1");
    await capture.drain();

    expect(calls[0]?.related.map((item) => item.name)).toEqual(["reservar-mesa"]);
  });

  test("cae al respaldo cuando el destilador real no produce nada", async () => {
    const store = createFakeStore();
    const capture = service({
      store: store as never,
      distiller: distillerReturning(null),
      fallbackDistiller: distillerReturning(draftFor("respaldo")),
      listTurns: () => [turn("t1", "algo")],
    });

    capture.capture("t1");
    await capture.drain();

    expect(store.written[0]?.draft.name).toBe("respaldo");
  });

  test("un turno que ya no esta en el historial falla sin escribir", async () => {
    const store = createFakeStore();
    const capture = service({
      store: store as never,
      distiller: distillerReturning(draftFor("a")),
      listTurns: () => [turn("otro", "algo")],
    });

    const response = capture.capture("t1");
    await capture.drain();

    expect(store.written).toHaveLength(0);
    expect(capture.job(response.jobId)?.status).toBe("failed");
  });

  test("un fallo del destilador no propaga y queda anotado", async () => {
    const store = createFakeStore();
    const capture = service({
      store: store as never,
      distiller: {
        distill: () => Promise.reject(new Error("codex no responde")),
      },
      listTurns: () => [turn("t1", "algo")],
    });

    const response = capture.capture("t1");
    await capture.drain();

    expect(capture.job(response.jobId)?.status).toBe("failed");
    expect(capture.job(response.jobId)?.error).toBe("codex no responde");
    expect(store.written).toHaveLength(0);
  });

  test("no corre mas de dos destilados a la vez", async () => {
    let active = 0;
    let peak = 0;
    const capture = service({
      store: createFakeStore() as never,
      distiller: {
        async distill() {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return draftFor("a");
        },
      },
      listTurns: () => [turn("t1", "a"), turn("t2", "b"), turn("t3", "c"), turn("t4", "d")],
      maxConcurrent: 2,
    });

    for (const id of ["t1", "t2", "t3", "t4"]) {
      capture.capture(id);
    }
    await capture.drain();

    expect(peak).toBe(2);
  });

  test("cada transicion del trabajo queda registrada en el almacen", async () => {
    const store = createFakeStore();
    const capture = service({
      store: store as never,
      distiller: distillerReturning(draftFor("a")),
      listTurns: () => [turn("t1", "algo")],
    });

    capture.capture("t1");
    await capture.drain();

    expect(store.recorded.map((job) => job.status)).toEqual(["queued", "running", "succeeded"]);
  });

  test("solo atribuye a la mejora los turnos que el destilador considero necesarios", async () => {
    const store = createFakeStore();
    const selected = { ...draftFor("lichess-ajedrez"), sourceTurnIds: ["t1", "t3"] };
    const capture = service({
      store: store as never,
      distiller: distillerReturning(selected),
      listTurns: () => [turn("t0", "hola"), turn("t1", "juguemos"), turn("t2", "otra opcion"), turn("t3", "perfecto")],
    });

    capture.capture("t3");
    await capture.drain();

    expect(store.written[0]?.sourceTurnIds).toEqual(["t1", "t3"]);
  });

  test("recupera al arrancar trabajos queued y running", async () => {
    const store = createFakeStore();
    store.recorded.push(
      { jobId: "done", turnId: "t0", status: "succeeded", createdAt: "2026-01-01T00:00:00.000Z" },
      { jobId: "queued", turnId: "t1", status: "queued", createdAt: "2026-01-01T00:00:01.000Z" },
      { jobId: "running", turnId: "t2", status: "running", createdAt: "2026-01-01T00:00:02.000Z" },
    );
    const capture = service({
      store: store as never,
      distiller: distillerReturning(draftFor("recuperada")),
      listTurns: () => [turn("t1", "prefiero uno"), turn("t2", "prefiero dos")],
    });

    await capture.drain();

    expect(capture.job("queued")?.status).toBe("succeeded");
    expect(capture.job("running")?.status).toBe("succeeded");
    expect(capture.job("done")?.status).toBe("succeeded");
  });
});
