import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ImprovementSourceTurn, SavedReply } from "../../../../agent/improvements-types";
import { redactHarnessTraceText } from "../../../../agent/harness-trace";

/** Las respuestas marcadas se conservan hasta que el usuario las borre. */
export function createSavedReplyStore(rootDir: string) {
  const directory = join(rootDir, "saved-replies");
  const pathFor = (turnId: string) => join(directory, `${createHash("sha256").update(turnId).digest("hex")}.json`);

  function read(path: string): SavedReply | null {
    try {
      const value = JSON.parse(readFileSync(path, "utf8"));
      return typeof value?.turnId === "string" && typeof value.input === "string"
        && typeof value.reply === "string" && typeof value.savedAt === "string" ? value : null;
    } catch (error) {
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  return {
    get(turnId: string) { return read(pathFor(turnId)); },
    save(turn: ImprovementSourceTurn): SavedReply {
      const existing = read(pathFor(turn.turnId));
      if (existing) return existing;
      const saved = { ...turn, input: redactHarnessTraceText(turn.input), reply: redactHarnessTraceText(turn.reply), savedAt: new Date().toISOString() };
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const path = pathFor(turn.turnId);
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, `${JSON.stringify(saved)}\n`, { mode: 0o600 });
        renameSync(temporary, path);
      } finally {
        rmSync(temporary, { force: true });
      }
      return saved;
    },
    list(query = "", limit = 50, offset = 0): SavedReply[] {
      let names: string[];
      try { names = readdirSync(directory); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      const needle = query.toLocaleLowerCase("es");
      return names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
        .map((name) => read(join(directory, name)))
        .filter((item): item is SavedReply => item !== null && `${item.input}\n${item.reply}`.toLocaleLowerCase("es").includes(needle))
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.turnId.localeCompare(b.turnId))
        .slice(offset, offset + limit);
    },
    forget(turnId: string) { rmSync(pathFor(turnId), { force: true }); },
  };
}
