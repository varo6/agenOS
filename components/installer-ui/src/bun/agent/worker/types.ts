export type WorkerMode = "openclaw-process" | "agenos-bun-worker" | "local-simulated";
export type WorkerTaskStatus = "queued" | "running" | "waiting_confirmation" | "succeeded" | "failed" | "cancelled";
export type WorkerTaskSource = "ui" | "openclaw" | "system";

export type WorkerHealth = {
  schemaVersion: 1;
  ok: boolean;
  mode: WorkerMode;
  serviceActive: boolean;
  version: string;
  stateDir: string;
  queueDepth: number;
  degradedReason: string | null;
  lastHeartbeatAt: string | null;
  lastHeartbeatCorrelationId: string | null;
  lastError: string | null;
  lastErrorCorrelationId: string | null;
  counters: {
    accepted: number;
    confirmed: number;
    denied: number;
    failed: number;
    retried: number;
  };
};

export type WorkerTask = {
  schemaVersion: 1;
  taskId: string;
  correlationId: string;
  timestamp: string;
  source: WorkerTaskSource;
  message: string;
  status: WorkerTaskStatus;
  progress: number;
  lastError: string | null;
};

export type WorkerProgressEvent = {
  schemaVersion: 1;
  taskId: string;
  correlationId: string;
  timestamp: string;
  type: "queued" | "started" | "progress" | "tool_request" | "waiting_confirmation" | "completed" | "failed";
  message: string;
  progress?: number;
};

export type WorkerAdapter = {
  health(): Promise<WorkerHealth>;
  enqueue(input: {
    message: string;
    source: WorkerTaskSource;
    correlationId?: string;
  }): Promise<{ ok: boolean; taskId?: string; correlationId?: string; message?: string }>;
  status(taskId: string): Promise<WorkerTask | null>;
  events(taskId: string): Promise<WorkerProgressEvent[]>;
  list(limit?: number): Promise<WorkerTask[]>;
};
