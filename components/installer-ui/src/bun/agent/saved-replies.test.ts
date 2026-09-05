import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSavedReplyStore } from "./saved-replies";
import { createImprovementStore } from "./improvements";
import { createImprovementCaptureService } from "./improvement-capture";

const directories: string[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), "agenos-saved-test-"));
  directories.push(root);
  return { root, savedReplies: createSavedReplyStore(root), store: createImprovementStore({ rootDir: root }) };
}
afterEach(() => { for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("respuestas guardadas", () => {
  test("conserva el texto completo tras reiniciar, permite buscarlo y borrarlo", () => {
    const { root, savedReplies } = setup();
    const original = { turnId: "../../fuera", input: "Una explicación", reply: "respuesta larga ".repeat(300) };
    const saved = savedReplies.save(original);
    expect(saved.reply).toBe(original.reply);
    expect(savedReplies.save({ ...original, reply: "otra" })).toEqual(saved);
    const restarted = createSavedReplyStore(root);
    expect(restarted.list("EXPLICACIÓN")).toEqual([saved]);
    expect(restarted.list("inexistente")).toEqual([]);
    restarted.forget(original.turnId);
    expect(restarted.get(original.turnId)).toBeNull();
    expect(restarted.list()).toEqual([]);
  });

  test("confirma el original antes de un modelo bloqueado y libera el trabajo al vencer el plazo", async () => {
    const { savedReplies, store } = setup();
    let signal: AbortSignal | undefined;
    const capture = createImprovementCaptureService({
      store, savedReplies, timeoutMs: 5,
      listTurns: () => [{ turnId: "t1", input: "explica", reply: "La respuesta completa" }],
      distiller: { distill: (input) => { signal = input.signal; return new Promise(() => {}); } },
    });
    const accepted = capture.capture("t1");
    expect(accepted.saved).toBe(true);
    expect(savedReplies.get("t1")?.reply).toBe("La respuesta completa");
    expect(capture.capture("t1").jobId).toBe(accepted.jobId);
    await capture.drain();
    expect(signal?.aborted).toBe(true);
    expect(capture.job(accepted.jobId)?.status).toBe("failed");
    expect(savedReplies.get("t1")).not.toBeNull();
  });

  test("reanuda con el contexto persistido aunque el historial se haya vaciado", async () => {
    const { store, savedReplies } = setup();
    const sourceTurns = [{ turnId: "t1", input: "prefiero respuestas breves", reply: "De acuerdo" }];
    store.recordJob({ jobId: "pending", turnId: "t1", status: "queued", createdAt: new Date().toISOString(), sourceTurns });
    let received: unknown;
    const capture = createImprovementCaptureService({
      store, savedReplies, listTurns: () => [],
      distiller: { async distill(input) {
        received = input.turns;
        return { name: "brevedad", category: "estilo", title: "Respuestas breves", triggers: ["breves"], body: "Responde de forma breve.", confidence: "high", sourceTurnIds: ["t1"] };
      } },
    });
    await capture.drain();
    expect(received).toEqual(sourceTurns);
    expect(store.read("brevedad")?.sourceTurnIds).toEqual(["t1"]);
    expect(capture.job("pending")?.status).toBe("succeeded");
  });
});
