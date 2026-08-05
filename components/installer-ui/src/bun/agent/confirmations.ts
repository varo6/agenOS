import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AGENT_PROTOCOL_SCHEMA_VERSION } from "./worker/protocol";
import { migrateConfirmationRecord } from "./worker/migrations";
import type { AgentSource } from "./policy";

export type ConfirmationStatus = "pending" | "confirmed" | "denied";
export type ConfirmationActor = "ui" | "openclaw" | "system";

export type ConfirmationRecord = {
  schemaVersion: 1;
  confirmationId: string;
  correlationId: string;
  timestamp: string;
  action: "confirmation.create" | "confirmation.confirm" | "confirmation.deny";
  status: ConfirmationStatus;
  source: AgentSource;
  taskId?: string;
  tool: string;
  summary: string;
  input: unknown;
  actor?: ConfirmationActor;
};

export type CreateConfirmationInput = {
  source: AgentSource;
  taskId?: string;
  correlationId: string;
  tool: string;
  summary: string;
  input: unknown;
};

export type ConfirmationStoreOptions = {
  rootDir?: string;
  now?: () => Date;
  idFactory?: () => string;
};

function defaultRootDir(): string {
  return join(homedir(), ".agenos", "openclaw", "confirmations");
}

export function createConfirmationStore(options: ConfirmationStoreOptions = {}) {
  const rootDir = options.rootDir ?? defaultRootDir();
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? (() => `conf_${now().getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const path = join(rootDir, "confirmations.ndjson");
  mkdirSync(rootDir, { recursive: true });

  function append(record: ConfirmationRecord): ConfirmationRecord {
    appendFileSync(path, `${JSON.stringify(record)}\n`, { encoding: "utf8" });
    return record;
  }

  function latest(): ConfirmationRecord[] {
    const byId = new Map<string, ConfirmationRecord>();
    for (const record of readRecords(path)) {
      byId.set(record.confirmationId, record);
    }
    return Array.from(byId.values()).reverse();
  }

  return {
    create(input: CreateConfirmationInput): ConfirmationRecord {
      return append({
        schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
        confirmationId: idFactory(),
        correlationId: input.correlationId,
        timestamp: now().toISOString(),
        action: "confirmation.create",
        status: "pending",
        source: input.source,
        taskId: input.taskId,
        tool: input.tool,
        summary: input.summary,
        input: input.input,
      });
    },
    confirm(confirmationId: string, actor: ConfirmationActor): ConfirmationRecord | null {
      const pending = latest().find((record) => record.confirmationId === confirmationId);
      if (!pending) {
        return null;
      }
      if (pending.status !== "pending") {
        return pending;
      }
      return append({
        ...pending,
        schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
        timestamp: now().toISOString(),
        action: "confirmation.confirm",
        status: "confirmed",
        actor,
      });
    },
    deny(confirmationId: string, actor: ConfirmationActor): ConfirmationRecord | null {
      const pending = latest().find((record) => record.confirmationId === confirmationId);
      if (!pending) {
        return null;
      }
      if (pending.status !== "pending") {
        return pending;
      }
      return append({
        ...pending,
        schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
        timestamp: now().toISOString(),
        action: "confirmation.deny",
        status: "denied",
        actor,
      });
    },
    get(confirmationId: string): ConfirmationRecord | null {
      return latest().find((record) => record.confirmationId === confirmationId) ?? null;
    },
    list(limit = 50): ConfirmationRecord[] {
      return latest().slice(0, limit);
    },
  };
}

function readRecords(path: string): ConfirmationRecord[] {
  if (!existsSync(path)) {
    return [];
  }

  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => migrateConfirmationRecord(JSON.parse(line) as Record<string, unknown>) as ConfirmationRecord);
}
