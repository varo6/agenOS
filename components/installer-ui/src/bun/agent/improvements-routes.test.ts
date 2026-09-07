import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInstallerApiHandler } from "../server";
import { createImprovementStore } from "./improvements";
import { createSavedReplyStore } from "./saved-replies";
import { createImprovementCaptureService } from "./improvement-capture";
import type { ImprovementDraft, ImprovementSourceTurn } from "../../../../agent/improvements-types";

const allowUiAuth = {
  authorizeUiRequest: () => ({ ok: true as const }),
  attachSession: (response: Response) => response,
  authorizationHeader: () => "Bearer test-ui-token",
};

const TURNS: ImprovementSourceTurn[] = [
  { turnId: "turn_0", input: "hola", reply: "Hola." },
  { turnId: "turn_1", input: "resérvame mesa para cenar", reply: "Te he reservado en TheFork." },
];

let rootDir = "";
let store: ReturnType<typeof createImprovementStore>;
let capture: ReturnType<typeof createImprovementCaptureService>;
let handler: ReturnType<typeof createInstallerApiHandler>;

const draft: ImprovementDraft = {
  category: "web",
  name: "reservar-restaurante",
  title: "Como reservar mesa",
  triggers: ["reservar", "mesa", "cena"],
  body: "Cuando te pida mesa, usa TheFork y confirma la hora.",
  confidence: "high",
  sourceTurnIds: ["turn_0", "turn_1"],
};

function get(path: string): Promise<Response> {
  return handler.fetch(new Request(`http://127.0.0.1:4173${path}`));
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "agenos-improvement-routes-"));
  store = createImprovementStore({ rootDir });
  capture = createImprovementCaptureService({
    store,
    savedReplies: createSavedReplyStore(rootDir),
    distiller: { distill: () => Promise.resolve(draft) },
    listTurns: () => TURNS,
  });
  handler = createInstallerApiHandler({
    uiAuth: allowUiAuth,
    improvements: store,
    improvementCapture: capture,
  });
});

afterEach(() => {
  handler.dispose();
  rmSync(rootDir, { recursive: true, force: true });
});

describe("rutas de mejoras", () => {
  test("el boton encola la captura y termina escribiendo la mejora", async () => {
    const response = await handler.fetch(new Request("http://127.0.0.1:4173/api/agent/improvements/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnId: "turn_1" }),
    }));

    expect(response.status).toBe(202);
    const payload = await response.json() as { ok: boolean; jobId: string; message: string };
    expect(payload.ok).toBe(true);
    // El mensaje es para el usuario: no puede hablar de destilados ni de colas.
    expect(payload.message).toBe("Respuesta guardada. Puedes verla en Sistema.");

    const running = await get(`/api/agent/improvements/capture/${payload.jobId}`);
    expect(running.status).toBe(200);

    await capture.drain();
    expect(capture.job(payload.jobId)?.status).toBe("succeeded");
    const completed = await (await get(`/api/agent/improvements/capture/${payload.jobId}`)).json() as { job: { status: string } };
    expect(completed.job.status).toBe("succeeded");
    expect(store.get("reservar-restaurante")?.body).toContain("TheFork");
    // Se guardan los dos turnos: el marcado y el anterior, que da el contexto.
    expect(store.get("reservar-restaurante")?.sourceTurnIds).toEqual(["turn_0", "turn_1"]);
    const saved = await (await get("/api/agent/saved-replies?query=TheFork")).json();
    expect(saved).toMatchObject([{ turnId: "turn_1", reply: TURNS[1]?.reply }]);
  });

  test("borra una respuesta solo con intención explícita y la retira de la búsqueda", async () => {
    createSavedReplyStore(rootDir).save(TURNS[1]!);
    const remove = (body: unknown) => handler.fetch(new Request("http://127.0.0.1:4173/api/agent/saved-replies/turn_1", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
    expect((await remove({})).status).toBe(403);
    expect((await (await get("/api/agent/saved-replies")).json())).toHaveLength(1);
    expect((await remove({ explicitUserIntent: true })).status).toBe(200);
    expect(await (await get("/api/agent/saved-replies")).json()).toEqual([]);
  });

  test("capturar sin turno es un 400", async () => {
    const response = await handler.fetch(new Request("http://127.0.0.1:4173/api/agent/improvements/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));
    expect(response.status).toBe(400);
  });

  test("el catalogo trae titulos y no cuerpos", async () => {
    store.write(draft, ["turn_1"]);

    const catalog = await (await get("/api/agent/improvements/catalog")).json() as { text: string; total: number };
    expect(catalog.total).toBe(1);
    expect(catalog.text).toContain("reservar-restaurante: Como reservar mesa");
    expect(catalog.text).not.toContain("TheFork");
  });

  test("buscar devuelve los nombres que encajan con la peticion", async () => {
    store.write(draft, ["turn_1"]);

    const matches = await (await get("/api/agent/improvements/search?query=quiero%20reservar%20mesa")).json() as Array<{ name: string }>;
    expect(matches.map((match) => match.name)).toEqual(["reservar-restaurante"]);
  });

  test("leer una mejora devuelve el cuerpo y sella su uso", async () => {
    store.write(draft, ["turn_1"]);

    const improvement = await (await get("/api/agent/improvements/reservar-restaurante")).json() as { body: string };
    expect(improvement.body).toContain("TheFork");
    expect(store.get("reservar-restaurante")?.lastUsedAt).toBeDefined();
  });

  test("una mejora que no existe es un 404, no un cuerpo vacio", async () => {
    expect((await get("/api/agent/improvements/no-existe")).status).toBe(404);
  });

  test("una categoria inventada se rechaza en vez de devolver todo", async () => {
    expect((await get("/api/agent/improvements?category=inventada")).status).toBe(400);

    store.write(draft, ["turn_1"]);
    const listed = await (await get("/api/agent/improvements?category=web")).json() as Array<{ name: string }>;
    expect(listed.map((entry) => entry.name)).toEqual(["reservar-restaurante"]);
  });

  test("olvidar exige intencion explicita del usuario", async () => {
    store.write(draft, ["turn_1"]);

    const denied = await handler.fetch(new Request("http://127.0.0.1:4173/api/agent/improvements/reservar-restaurante", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));
    expect(denied.status).toBe(403);
    expect(store.get("reservar-restaurante")).not.toBeNull();

    const accepted = await handler.fetch(new Request("http://127.0.0.1:4173/api/agent/improvements/reservar-restaurante", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ explicitUserIntent: true }),
    }));
    expect(accepted.status).toBe(202);
    expect(store.get("reservar-restaurante")).toBeNull();
  });
});
