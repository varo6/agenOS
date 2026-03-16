import { existsSync, readFileSync } from "node:fs";

import type { DiskSummary, FirmwareType, PreflightResponse } from "../../shared/installer-types";
import { discoverDisks, formatBytes } from "./disks";

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

export function readPreflightPayload(): PreflightResponse {
  const disks = discoverDisks();
  const totalRamBytes = totalRamBytesFromMeminfo(readFileSync("/proc/meminfo", "utf8"));
  const isLiveSession = isLiveSessionFromState(
    readFileSync("/proc/cmdline", "utf8"),
    existsSync("/run/live/medium"),
  );
  const firmware = firmwareTypeFromState(existsSync("/sys/firmware/efi"));

  return buildPreflightResponse({
    disks,
    totalRamBytes,
    isLiveSession,
    firmware,
  });
}
