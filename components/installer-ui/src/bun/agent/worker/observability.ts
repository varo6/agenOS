export type ObservabilityCounter = "accepted" | "confirmed" | "denied" | "failed" | "retried";

export type ObservabilityCounters = Record<ObservabilityCounter, number>;

export type ObservabilitySnapshot = {
  lastHeartbeatAt: string | null;
  lastHeartbeatCorrelationId: string | null;
  degradedReason: string | null;
  lastError: string | null;
  lastErrorCorrelationId: string | null;
  counters: ObservabilityCounters;
};

export type ObservabilityOptions = {
  now?: () => Date;
};

export function createObservabilityState(options: ObservabilityOptions = {}) {
  const now = options.now ?? (() => new Date());
  const counters: ObservabilityCounters = {
    accepted: 0,
    confirmed: 0,
    denied: 0,
    failed: 0,
    retried: 0,
  };
  let lastHeartbeatAt: string | null = null;
  let lastHeartbeatCorrelationId: string | null = null;
  let degradedReason: string | null = null;
  let lastError: string | null = null;
  let lastErrorCorrelationId: string | null = null;

  return {
    recordHeartbeat(correlationId: string): void {
      lastHeartbeatAt = now().toISOString();
      lastHeartbeatCorrelationId = correlationId;
    },
    increment(counter: ObservabilityCounter): void {
      counters[counter] += 1;
    },
    setDegraded(reason: string, correlationId: string): void {
      degradedReason = reason;
      lastError = reason;
      lastErrorCorrelationId = correlationId;
    },
    clearDegraded(): void {
      degradedReason = null;
      lastError = null;
      lastErrorCorrelationId = null;
    },
    snapshot(): ObservabilitySnapshot {
      return {
        lastHeartbeatAt,
        lastHeartbeatCorrelationId,
        degradedReason,
        lastError,
        lastErrorCorrelationId,
        counters: { ...counters },
      };
    },
  };
}
