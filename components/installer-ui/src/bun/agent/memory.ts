import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AGENT_PROTOCOL_SCHEMA_VERSION } from "./worker/protocol";
import { migrateMemoryAuditRecord } from "./worker/migrations";

export type MemoryNamespace = "contacts" | "preferences" | "facts";
export type MemorySource = "ui" | "openclaw" | "system";

export type MemoryAppendMetadata = {
  source: MemorySource;
  correlationId?: string;
  taskId?: string;
  confirmationId?: string;
};

export type MemoryAuditEvent = {
  schemaVersion: 1;
  timestamp: string;
  namespace: MemoryNamespace;
  source: MemorySource;
  action: "memory.append";
  correlationId: string;
  taskId?: string;
  confirmationId?: string;
  byteLength: number;
};

export type MemoryStoreOptions = {
  rootDir?: string;
  now?: () => Date;
  correlationIdFactory?: () => string;
};

const DEFAULT_FILES: Record<MemoryNamespace, string> = {
  contacts: "contacts.md",
  preferences: "preferences.md",
  facts: "facts.md",
};

function defaultRootDir(): string {
  return join(homedir(), ".agenos", "memory");
}

function ensureMemoryFiles(rootDir: string): void {
  mkdirSync(rootDir, { recursive: true });
  for (const fileName of Object.values(DEFAULT_FILES)) {
    const path = join(rootDir, fileName);
    try {
      readFileSync(path, "utf8");
    } catch {
      writeFileSync(path, "", { encoding: "utf8", mode: 0o600 });
    }
  }
}

export function isMemoryNamespace(value: unknown): value is MemoryNamespace {
  return value === "contacts" || value === "preferences" || value === "facts";
}

export function createMemoryStore(options: MemoryStoreOptions = {}) {
  const rootDir = options.rootDir ?? defaultRootDir();
  const now = options.now ?? (() => new Date());
  const correlationIdFactory = options.correlationIdFactory ?? (() => `corr_${now().getTime().toString(36)}`);
  ensureMemoryFiles(rootDir);

  function pathFor(namespace: MemoryNamespace): string {
    return join(rootDir, DEFAULT_FILES[namespace]);
  }

  return {
    read(namespace: MemoryNamespace) {
      return {
        namespace,
        content: readFileSync(pathFor(namespace), "utf8"),
      };
    },
    append(namespace: MemoryNamespace, content: string, metadataOrSource: MemoryAppendMetadata | MemorySource) {
      const metadata = typeof metadataOrSource === "string"
        ? { source: metadataOrSource }
        : metadataOrSource;
      const trimmed = content.trim();
      if (!trimmed) {
        return { ok: false, message: "La memoria no puede estar vacia." };
      }

      appendFileSync(pathFor(namespace), `${trimmed}\n`, { encoding: "utf8" });
      const event: MemoryAuditEvent = {
        schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
        timestamp: now().toISOString(),
        namespace,
        source: metadata.source,
        action: "memory.append",
        correlationId: metadata.correlationId ?? correlationIdFactory(),
        ...(metadata.taskId ? { taskId: metadata.taskId } : {}),
        ...(metadata.confirmationId ? { confirmationId: metadata.confirmationId } : {}),
        byteLength: Buffer.byteLength(trimmed, "utf8"),
      };
      appendFileSync(
        join(rootDir, "events.ndjson"),
        `${JSON.stringify(event)}\n`,
        { encoding: "utf8" },
      );
      return { ok: true, message: "Memoria guardada." };
    },
    events(limit = 50): MemoryAuditEvent[] {
      const path = join(rootDir, "events.ndjson");
      if (!existsSync(path)) {
        return [];
      }

      return readFileSync(path, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => migrateMemoryAuditRecord(JSON.parse(line) as Record<string, unknown>) as MemoryAuditEvent)
        .slice(-limit)
        .reverse();
    },
  };
}
