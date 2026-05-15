import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type TaskQueueOptions = {
  rootDir?: string;
  now?: () => Date;
};

export type EnqueueTaskInput = {
  message: string;
  source: "ui" | "openclaw" | "system";
};

function defaultRootDir(): string {
  return join(homedir(), ".agenos", "openclaw");
}

export function createTaskQueue(options: TaskQueueOptions = {}) {
  const rootDir = options.rootDir ?? defaultRootDir();
  const now = options.now ?? (() => new Date());
  mkdirSync(rootDir, { recursive: true });

  return {
    health() {
      return { ok: true, mode: "local-simulated" as const };
    },
    enqueue(input: EnqueueTaskInput) {
      const message = input.message.trim();
      if (!message) {
        return { ok: false, message: "La tarea no puede estar vacia." };
      }

      const taskId = `task_${now().getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      appendFileSync(
        join(rootDir, "outbox.ndjson"),
        `${JSON.stringify({
          taskId,
          timestamp: now().toISOString(),
          source: input.source,
          message,
          status: "queued",
        })}\n`,
        { encoding: "utf8" },
      );

      return { ok: true, taskId, message: "Tarea enviada al worker de fondo." };
    },
  };
}
