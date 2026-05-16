export const AGENT_PROTOCOL_SCHEMA_VERSION = 1;

export type ProtocolEnvelope<TPayload = unknown> = {
  schemaVersion: typeof AGENT_PROTOCOL_SCHEMA_VERSION;
  type: string;
  correlationId: string;
  timestamp: string;
  payload: TPayload;
};

export type CreateProtocolEnvelopeInput<TPayload> = {
  type: string;
  correlationId: string;
  payload: TPayload;
  now?: () => Date;
};

export function createProtocolEnvelope<TPayload>(
  input: CreateProtocolEnvelopeInput<TPayload>,
): ProtocolEnvelope<TPayload> {
  const now = input.now ?? (() => new Date());
  return {
    schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
    type: input.type,
    correlationId: input.correlationId,
    timestamp: now().toISOString(),
    payload: input.payload,
  };
}

export function isProtocolEnvelope(value: unknown): value is ProtocolEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ProtocolEnvelope>;
  return (
    record.schemaVersion === AGENT_PROTOCOL_SCHEMA_VERSION
    && typeof record.type === "string"
    && record.type.length > 0
    && typeof record.correlationId === "string"
    && record.correlationId.length > 0
    && typeof record.timestamp === "string"
    && !Number.isNaN(Date.parse(record.timestamp))
    && "payload" in record
  );
}
