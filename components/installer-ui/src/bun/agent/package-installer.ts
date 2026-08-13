import { spawn } from "node:child_process";
import { isDebianPackageName, type AptCatalog } from "./package-resolver";

export type PackageInstallInput = {
  packageName: string;
  displayName: string;
  requestedName: string;
  version: string;
  component?: "main" | "contrib" | "non-free" | "non-free-firmware";
  selectionReason: string;
};

export type PackageInstallStatus =
  | "installed"
  | "already_installed"
  | "cancelled"
  | "not_found"
  | "network_unavailable"
  | "failed";

export type PackageInstallResult = {
  ok: boolean;
  status: PackageInstallStatus;
  packageName?: string;
  displayName?: string;
  message: string;
};

type HelperResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type PackageHelperRunner = (
  command: string,
  args: string[],
  onOutput: (line: string) => void,
) => Promise<HelperResult>;

export type PackageInstallerOptions = {
  catalog: Pick<AptCatalog, "isInstalled">;
  runHelper?: PackageHelperRunner;
  helperPath?: string;
};

const RESULT_PREFIX = "AGENOS_PACKAGE_RESULT";

export function createPackageInstaller(options: PackageInstallerOptions) {
  const runHelper = options.runHelper ?? spawnHelper;
  const helperPath = options.helperPath ?? "/usr/local/bin/agenos-shell-helper";

  return {
    async install(input: unknown, onProgress?: (message: string) => void): Promise<PackageInstallResult> {
      const packageInput = parsePackageInstallInput(input);
      if (!packageInput) {
        return {
          ok: false,
          status: "failed",
          message: "La solicitud de instalación no contiene un nombre de paquete Debian válido.",
        };
      }

      if (await options.catalog.isInstalled(packageInput.packageName)) {
        return alreadyInstalled(packageInput);
      }

      const report = progressReporter(onProgress);
      report("Solicitando permiso para instalar el paquete…");
      const result = await runHelper(
        "pkexec",
        [helperPath, "install-package", packageInput.packageName],
        (line) => report(progressMessage(line)),
      );
      const combined = `${result.stdout}\n${result.stderr}`;
      const marker = parseResultMarker(combined, packageInput.packageName);

      if (marker === "already-installed") {
        return alreadyInstalled(packageInput);
      }
      if (result.exitCode === 0 && marker === "installed") {
        report("Instalación terminada.");
        return {
          ok: true,
          status: "installed",
          packageName: packageInput.packageName,
          displayName: packageInput.displayName,
          message: `${packageInput.displayName} se ha instalado correctamente (${packageInput.packageName}).`,
        };
      }
      if (marker === "not-found" || result.exitCode === 4 || /unable to locate package|has no installation candidate/i.test(combined)) {
        return {
          ok: false,
          status: "not_found",
          packageName: packageInput.packageName,
          displayName: packageInput.displayName,
          message: `${packageInput.packageName} ya no tiene un candidato exacto en el catálogo APT configurado; no se instaló nada.`,
        };
      }
      if (/temporary failure resolving|could not resolve|network is unreachable|failed to fetch|connection (?:failed|timed out)|connection refused/i.test(combined)) {
        return {
          ok: false,
          status: "network_unavailable",
          packageName: packageInput.packageName,
          displayName: packageInput.displayName,
          message: `No se pudo descargar ${packageInput.displayName}. Revisa la conexión y vuelve a intentarlo; no se informó de una instalación completada.`,
        };
      }

      const detail = conciseFailureDetail(result.stderr || result.stdout);
      return {
        ok: false,
        status: "failed",
        packageName: packageInput.packageName,
        displayName: packageInput.displayName,
        message: `No se pudo instalar ${packageInput.displayName}${detail ? `: ${detail}` : ". Comprueba polkit, el bloqueo de APT y el espacio disponible."}`,
      };
    },
  };
}

export function parsePackageInstallInput(input: unknown): PackageInstallInput | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const record = input as Record<string, unknown>;
  if (typeof record.packageName !== "string" || !isDebianPackageName(record.packageName)) {
    return null;
  }
  if (typeof record.displayName !== "string" || !record.displayName.trim() || record.displayName.length > 120) {
    return null;
  }
  return {
    packageName: record.packageName,
    displayName: record.displayName.trim(),
    requestedName: typeof record.requestedName === "string" ? record.requestedName.slice(0, 120) : record.packageName,
    version: typeof record.version === "string" ? record.version.slice(0, 120) : "unknown",
    component: record.component === "main" || record.component === "contrib" || record.component === "non-free" || record.component === "non-free-firmware"
      ? record.component
      : undefined,
    selectionReason: typeof record.selectionReason === "string" ? record.selectionReason.slice(0, 500) : "Paquete resuelto por el catálogo APT.",
  };
}

function alreadyInstalled(input: PackageInstallInput): PackageInstallResult {
  return {
    ok: true,
    status: "already_installed",
    packageName: input.packageName,
    displayName: input.displayName,
    message: `${input.displayName} ya estaba instalado (${input.packageName}).`,
  };
}

function progressReporter(onProgress?: (message: string) => void): (message?: string) => void {
  let previous = "";
  return (message) => {
    const normalized = message?.trim();
    if (!normalized || normalized === previous) {
      return;
    }
    previous = normalized;
    onProgress?.(normalized);
  };
}

function progressMessage(line: string): string | undefined {
  if (/reading package lists|checking package catalog/i.test(line)) {
    return "Comprobando el catálogo de paquetes…";
  }
  if (/building dependency tree|the following (?:additional|new) packages/i.test(line)) {
    return "Calculando las dependencias…";
  }
  if (/^Get:\d+|need to get|fetching/i.test(line)) {
    return "Descargando los paquetes…";
  }
  if (/unpacking|preparing to unpack/i.test(line)) {
    return "Desempaquetando la aplicación…";
  }
  if (/setting up/i.test(line)) {
    return "Instalando la aplicación…";
  }
  if (/processing triggers/i.test(line)) {
    return "Terminando la configuración…";
  }
  return undefined;
}

function parseResultMarker(output: string, packageName: string): "installed" | "already-installed" | "not-found" | null {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = output.match(new RegExp(`${RESULT_PREFIX} (installed|already-installed|not-found) ${escaped}(?:\\s|$)`));
  return match?.[1] === "installed" || match?.[1] === "already-installed" || match?.[1] === "not-found"
    ? match[1]
    : null;
}

function conciseFailureDetail(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(RESULT_PREFIX));
  const detail = lines.at(-1)?.replace(/\s+/g, " ") ?? "";
  return detail.length > 240 ? `${detail.slice(0, 237)}…` : detail;
}

function spawnHelper(command: string, args: string[], onOutput: (line: string) => void): Promise<HelperResult> {
  return new Promise((resolve) => {
    const sessionEnv = ["DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "XAUTHORITY"]
      .reduce<Record<string, string>>((selected, key) => {
        const value = process.env[key];
        if (value) {
          selected[key] = value;
        }
        return selected;
      }, {});
    const child = spawn(command, args, {
      env: {
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        ...sessionEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(124, "La instalación superó el tiempo máximo de 30 minutos.");
    }, 30 * 60 * 1000);

    const consume = (kind: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (kind === "stdout") {
        stdout = `${stdout}${text}`.slice(-128 * 1024);
      } else {
        stderr = `${stderr}${text}`.slice(-128 * 1024);
      }
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) {
          onOutput(line);
        }
      }
    };
    const finish = (exitCode: number, extraError = "") => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr: extraError ? `${stderr}\n${extraError}` : stderr });
    };

    child.stdout?.on("data", (chunk: Buffer) => consume("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => consume("stderr", chunk));
    child.on("error", (error) => finish(1, error.message));
    child.on("exit", (code, signal) => finish(code ?? (signal ? 1 : 0), signal ? `Proceso terminado por ${signal}.` : ""));
  });
}
