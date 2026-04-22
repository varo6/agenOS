import { existsSync, readFileSync } from "node:fs";

import type { DiskSummary, FirmwareType, PreflightResponse } from "../installer-types";

export type PreflightDependencies = {
  getDisks: () => DiskSummary[];
  readTextFile: (path: string) => string;
  exists: (path: string) => boolean;
  liveSessionOverride: string | undefined;
};

export function liveSessionOverrideFromEnv(value: string | undefined): boolean | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return null;
}

export function isLiveSessionFromState(cmdline: string, hasLiveMedium: boolean): boolean {
  return cmdline.includes("boot=live") || cmdline.includes("components") || hasLiveMedium;
}

export function firmwareTypeFromState(hasEfiFirmware: boolean): FirmwareType {
  return hasEfiFirmware ? "UEFI" : "BIOS";
}

export function totalRamBytesFromMeminfo(meminfo: string): number {
  for (const line of meminfo.split(/\r?\n/)) {
    if (line.startsWith("MemTotal:")) {
      const parts = line.trim().split(/\s+/);
      return Number(parts[1] ?? 0) * 1024;
    }
  }

  return 0;
}

export function buildPreflightResponse(input: {
  disks: DiskSummary[];
  totalRamBytes: number;
  isLiveSession: boolean;
  firmware: FirmwareType;
}): PreflightResponse {
  const totalInstallableDiskBytes = input.disks.reduce((sum, disk) => sum + disk.sizeBytes, 0);

  return {
    firmware: input.firmware,
    isLiveSession: input.isLiveSession,
    totalRamBytes: input.totalRamBytes,
    installableDiskBytes: totalInstallableDiskBytes,
    checks: [
      {
        id: "ram",
        label: "Memoria RAM",
        status: input.totalRamBytes >= 4 * 1024 * 1024 * 1024 ? "ok" : "warning",
        detail: `Detectados ${formatBytes(input.totalRamBytes)}. El wrapper v1 recomienda 4 GB o más.`,
      },
      {
        id: "storage",
        label: "Almacenamiento instalable",
        status: totalInstallableDiskBytes >= 32 * 1024 * 1024 * 1024 ? "ok" : "warning",
        detail: `Se han detectado ${input.disks.length} discos válidos con ${formatBytes(totalInstallableDiskBytes)} en total.`,
      },
      {
        id: "firmware",
        label: "Modo de firmware",
        status: "ok",
        detail: `El sistema live ha arrancado en modo ${input.firmware}.`,
      },
      {
        id: "live",
        label: "Sesión live",
        status: input.isLiveSession ? "ok" : "error",
        detail: input.isLiveSession
          ? "Se ha detectado una sesión live válida."
          : "No parece una sesión live soportada por el wrapper.",
      },
    ],
  };
}

function formatBytes(value: number): string {
  let size = Number(value) || 0;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  const precision = size >= 10 || index === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[index]}`;
}

export function createPreflightService(dependencies: Partial<PreflightDependencies> = {}) {
  const deps: PreflightDependencies = {
    getDisks: dependencies.getDisks ?? (() => []),
    readTextFile: dependencies.readTextFile ?? ((path) => readFileSync(path, "utf8")),
    exists: dependencies.exists ?? existsSync,
    liveSessionOverride: dependencies.liveSessionOverride ?? process.env.AGENOS_DEV_FORCE_LIVE_SESSION,
  };

  function getPreflight(): PreflightResponse {
    const disks = deps.getDisks();
    const totalRamBytes = totalRamBytesFromMeminfo(deps.readTextFile("/proc/meminfo"));
    const liveSessionOverride = liveSessionOverrideFromEnv(deps.liveSessionOverride);
    const isLiveSession = liveSessionOverride ?? isLiveSessionFromState(
      deps.readTextFile("/proc/cmdline"),
      deps.exists("/run/live/medium"),
    );
    const firmware = firmwareTypeFromState(deps.exists("/sys/firmware/efi"));

    return buildPreflightResponse({
      disks,
      totalRamBytes,
      isLiveSession,
      firmware,
    });
  }

  return {
    getPreflight,
  };
}
