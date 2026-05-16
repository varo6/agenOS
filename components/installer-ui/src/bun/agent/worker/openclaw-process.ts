import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { AGENT_PROTOCOL_SCHEMA_VERSION } from "./protocol";
import { createObservabilityState } from "./observability";
import type { WorkerAdapter } from "./types";

export type OpenClawProcessAdapterOptions = {
  binaryPath?: string;
  stateDir: string;
  now?: () => Date;
};

export function createOpenClawProcessAdapter(options: OpenClawProcessAdapterOptions): WorkerAdapter {
  const binaryPath = options.binaryPath ?? "/usr/bin/openclaw";
  const stateDir = expandHomeDir(options.stateDir);
  const observability = createObservabilityState({ now: options.now });

  if (!existsSync(binaryPath)) {
    observability.setDegraded(`OpenClaw binary not found: ${binaryPath}`, `corr_${Date.now().toString(36)}`);
  }

  return {
    async health() {
      const binaryExists = existsSync(binaryPath);
      if (!binaryExists) {
        observability.setDegraded(`OpenClaw binary not found: ${binaryPath}`, `corr_${Date.now().toString(36)}`);
      }

      return {
        schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
        ok: binaryExists,
        mode: "openclaw-process",
        serviceActive: binaryExists,
        version: binaryExists ? "openclaw-process" : "unavailable",
        stateDir,
        queueDepth: 0,
        ...observability.snapshot(),
      };
    },
    async enqueue() {
      return {
        ok: false,
        message: existsSync(binaryPath)
          ? "OpenClaw process task API is not enabled in this phase."
          : `OpenClaw binary not found: ${binaryPath}`,
      };
    },
    async status() {
      return null;
    },
    async events() {
      return [];
    },
    async list() {
      return [];
    },
  };
}

function expandHomeDir(path: string): string {
  return path.replace(/^~(?=\/)/, homedir());
}
