import type {
  DiskSummary,
  PreflightCheck,
  PreflightResponse,
} from "../../shared/installer-types";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 GB";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const precision = value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unit]}`;
}

export type WelcomeStat = {
  label: string;
  value: string;
};

export type WelcomeModel = {
  checks: PreflightCheck[];
  stats: WelcomeStat[];
  summaryLabel: string;
};

export type DiskCardModel = {
  path: string;
  sizeLabel: string;
  transportLabel: string;
  vendorModel: string;
};

export function mapPreflightToWelcomeModel(
  preflight: PreflightResponse,
): WelcomeModel {
  const hasError = preflight.checks.some((check) => check.status === "error");
  const hasWarning = preflight.checks.some((check) => check.status === "warning");

  return {
    checks: preflight.checks,
    stats: [
      { label: "Firmware", value: preflight.firmware },
      { label: "RAM detectada", value: formatBytes(preflight.totalRamBytes) },
      {
        label: "Capacidad instalable",
        value: formatBytes(preflight.installableDiskBytes),
      },
    ],
    summaryLabel: hasError
      ? "Hay bloqueos que revisar"
      : hasWarning
        ? "Sistema listo con advertencias"
        : "Comprobaciones superadas",
  };
}

export function mapDiskToCardModel(disk: DiskSummary): DiskCardModel {
  const vendorModel = [disk.vendor, disk.model]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    path: disk.path,
    sizeLabel: disk.sizeLabel,
    transportLabel: disk.transport ? disk.transport.toUpperCase() : "DESCONOCIDO",
    vendorModel: vendorModel || "Disco sin modelo declarado",
  };
}
