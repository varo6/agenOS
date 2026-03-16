import { spawnSync } from "node:child_process";

import type { DiskSummary } from "../../shared/installer-types";

type LsblkNode = {
  name?: string;
  path?: string;
  type?: string;
  size?: number | string;
  model?: string;
  vendor?: string;
  tran?: string;
  ro?: number | string;
  rm?: number | string;
  mountpoint?: string | null;
  mountpoints?: Array<string | null> | null;
  children?: LsblkNode[] | null;
};

type LsblkPayload = {
  blockdevices?: LsblkNode[];
};

export const LIVE_MOUNTPOINTS = new Set(["/run/live/medium", "/cdrom"]);
export const MIN_INSTALLABLE_DISK_BYTES = 8 * 1024 * 1024 * 1024;
export const LSBLK_ARGS = [
  "-J",
  "-b",
  "-o",
  "NAME,PATH,TYPE,SIZE,MODEL,VENDOR,TRAN,RO,RM,HOTPLUG,MOUNTPOINT,MOUNTPOINTS",
];

export function formatBytes(value: number): string {
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

export function nodeMountpoints(node: LsblkNode): string[] {
  const mountpoints: string[] = [];

  for (const mountpoint of node.mountpoints ?? []) {
    if (mountpoint) {
      mountpoints.push(mountpoint);
    }
  }

  if (node.mountpoint) {
    mountpoints.push(node.mountpoint);
  }

  for (const child of node.children ?? []) {
    mountpoints.push(...nodeMountpoints(child));
  }

  return mountpoints;
}

export function diskIsLiveMedium(node: LsblkNode, liveMountpoints: Set<string> = LIVE_MOUNTPOINTS): boolean {
  return nodeMountpoints(node).some((mountpoint) => liveMountpoints.has(mountpoint));
}

export function summarizeDisk(node: LsblkNode): DiskSummary {
  const sizeBytes = Number(node.size ?? 0);
  const vendor = String(node.vendor ?? "").trim();
  const model = String(node.model ?? "").trim();
  const transport = String(node.tran ?? "").trim();

  return {
    path: node.path || `/dev/${node.name ?? ""}`,
    vendor,
    model,
    transport,
    sizeBytes,
    sizeLabel: formatBytes(sizeBytes),
    systemDisk: diskIsLiveMedium(node),
  };
}

export function discoverDisksFromLsblkPayload(payload: LsblkPayload): DiskSummary[] {
  const disks: DiskSummary[] = [];

  for (const node of payload.blockdevices ?? []) {
    if (node.type !== "disk") {
      continue;
    }
    if (Number(node.ro ?? 0) === 1) {
      continue;
    }
    if (Number(node.rm ?? 0) === 1 && diskIsLiveMedium(node)) {
      continue;
    }
    if (Number(node.size ?? 0) < MIN_INSTALLABLE_DISK_BYTES) {
      continue;
    }

    const summary = summarizeDisk(node);
    if (summary.systemDisk) {
      continue;
    }

    disks.push(summary);
  }

  disks.sort((left, right) => left.path.localeCompare(right.path));
  return disks;
}

export function readLsblkPayload(commandRunner: typeof spawnSync = spawnSync): LsblkPayload {
  const result = commandRunner("lsblk", LSBLK_ARGS, {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || "lsblk devolvió un error.");
  }

  return JSON.parse(result.stdout) as LsblkPayload;
}

export function discoverDisks(commandRunner: typeof spawnSync = spawnSync): DiskSummary[] {
  return discoverDisksFromLsblkPayload(readLsblkPayload(commandRunner));
}
