import { AGENT_PROTOCOL_SCHEMA_VERSION } from "./protocol";

export type MigrationResult<T> =
  | { ok: true; value: T }
  | { ok: false; degradedReason: string };

export type VersionedRecord = {
  schemaVersion: typeof AGENT_PROTOCOL_SCHEMA_VERSION;
  correlationId?: string;
  timestamp?: string;
};

export type WorkerTaskRecord = VersionedRecord & {
  taskId: string;
  status: string;
  message: string;
  [key: string]: unknown;
};

export type WorkerConfigRecord = VersionedRecord & {
  [key: string]: unknown;
};

export function migrateTaskRecord(record: unknown): WorkerTaskRecord {
  const source = asRecord(record);
  assertSupportedSchemaVersion(source, "task");

  return {
    ...source,
    schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
  } as WorkerTaskRecord;
}

export function migrateEventRecord<T extends Record<string, unknown>>(record: T): T & VersionedRecord {
  return migrateGenericRecord(record, "event");
}

export function migrateConfirmationRecord<T extends Record<string, unknown>>(record: T): T & VersionedRecord {
  return migrateGenericRecord(record, "confirmation");
}

export function migrateMemoryAuditRecord<T extends Record<string, unknown>>(record: T): T & VersionedRecord {
  return migrateGenericRecord(record, "memory audit");
}

export function migrateDiagnosticsRecord<T extends Record<string, unknown>>(record: T): T & VersionedRecord {
  return migrateGenericRecord(record, "diagnostics");
}

export function migrateWorkerConfigRecord(record: unknown): MigrationResult<WorkerConfigRecord> {
  const source = asRecord(record);
  if (isFutureSchemaVersion(source.schemaVersion)) {
    return {
      ok: false,
      degradedReason: `Unsupported worker config schemaVersion: ${source.schemaVersion}`,
    };
  }

  return {
    ok: true,
    value: {
      ...source,
      schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
    } as WorkerConfigRecord,
  };
}

function migrateGenericRecord<T extends Record<string, unknown>>(
  record: T,
  recordName: string,
): T & VersionedRecord {
  assertSupportedSchemaVersion(record, recordName);
  return {
    ...record,
    schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
  };
}

function assertSupportedSchemaVersion(record: Record<string, unknown>, recordName: string): void {
  if (isFutureSchemaVersion(record.schemaVersion)) {
    throw new Error(`Unsupported ${recordName} schemaVersion: ${record.schemaVersion}`);
  }
}

function isFutureSchemaVersion(schemaVersion: unknown): boolean {
  return typeof schemaVersion === "number" && schemaVersion !== AGENT_PROTOCOL_SCHEMA_VERSION;
}

function asRecord(record: unknown): Record<string, unknown> {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return {};
  }
  return record as Record<string, unknown>;
}
