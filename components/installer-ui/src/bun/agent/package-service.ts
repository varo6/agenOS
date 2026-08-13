import type { AgentSource } from "./policy";
import type { createConfirmationStore } from "./confirmations";
import type { createPackageInstaller, PackageInstallResult } from "./package-installer";
import type { createPackageResolver, PackageResolution, ResolvedPackage } from "./package-resolver";
import type { createToolRunner } from "./tool-runner";

export type PackageRequestResult =
  | PackageInstallResult
  | {
    ok: false;
    status: "confirmation_required";
    decision: "confirm";
    confirmationId?: string;
    packageName: string;
    displayName: string;
    message: string;
    selectionReason: string;
  }
  | Extract<PackageResolution, { ok: false }>;

export type PackageServiceOptions = {
  resolver: ReturnType<typeof createPackageResolver>;
  installer: ReturnType<typeof createPackageInstaller>;
  toolRunner: ReturnType<typeof createToolRunner>;
  confirmations: ReturnType<typeof createConfirmationStore>;
};

export function createPackageService(options: PackageServiceOptions) {
  return {
    resolve(query: string) {
      return options.resolver.resolve(query);
    },
    async requestInstall(query: string, source: AgentSource = "ui"): Promise<PackageRequestResult> {
      // La anotacion explicita mantiene la union discriminada: sin ella el tipo
      // se ensancha y TypeScript deja de estrechar por `ok`.
      const resolution: PackageResolution = await options.resolver.resolve(query);
      if (resolution.ok === false) {
        return resolution;
      }
      const selected = resolution.package;
      if (selected.installed) {
        return {
          ok: true,
          status: "already_installed",
          packageName: selected.packageName,
          displayName: selected.displayName,
          message: `${selected.displayName} ya estaba instalado (${selected.packageName}).`,
        };
      }

      const result = await options.toolRunner.run({
        source,
        tool: "packages.install",
        input: installInput(selected),
      });
      if (result.decision !== "confirm") {
        return {
          ok: false,
          status: "failed",
          packageName: selected.packageName,
          displayName: selected.displayName,
          message: result.message ?? "La política del broker no permitió preparar la instalación.",
        };
      }

      return {
        ok: false,
        status: "confirmation_required",
        decision: "confirm",
        confirmationId: result.confirmationId,
        packageName: selected.packageName,
        displayName: selected.displayName,
        message: confirmationQuestion(selected),
        selectionReason: selected.selectionReason,
      };
    },
    async confirmInstall(confirmationId: string, onProgress?: (message: string) => void): Promise<PackageInstallResult> {
      const pending = options.confirmations.get(confirmationId);
      if (!pending || pending.tool !== "packages.install") {
        return {
          ok: false,
          status: "failed",
          message: "No encuentro una confirmación pendiente para esa instalación.",
        };
      }
      if (pending.status !== "pending") {
        return {
          ok: false,
          status: "failed",
          message: `La instalación ya fue ${pending.status === "confirmed" ? "confirmada" : "denegada"}; no se ha repetido la operación.`,
        };
      }

      const confirmed = options.confirmations.confirm(confirmationId, "ui");
      if (!confirmed) {
        return { ok: false, status: "failed", message: "No se pudo registrar la confirmación." };
      }
      const execution = await options.toolRunner.executeConfirmed(confirmed, { onProgress });
      if (execution.output && typeof execution.output === "object" && "status" in execution.output) {
        return execution.output as PackageInstallResult;
      }
      return {
        ok: false,
        status: "failed",
        message: execution.message ?? "El broker no obtuvo un resultado verificable del instalador.",
      };
    },
    denyInstall(confirmationId: string): PackageInstallResult {
      const pending = options.confirmations.get(confirmationId);
      if (!pending || pending.tool !== "packages.install" || pending.status !== "pending") {
        return { ok: false, status: "failed", message: "No encuentro una instalación pendiente que pueda cancelar." };
      }
      options.confirmations.deny(confirmationId, "ui");
      return { ok: true, status: "cancelled", message: "Instalación cancelada; no se cambió el sistema." };
    },
  };
}

function installInput(selected: ResolvedPackage) {
  return {
    packageName: selected.packageName,
    displayName: selected.displayName,
    requestedName: selected.requestedName,
    version: selected.version,
    component: selected.component,
    selectionReason: selected.selectionReason,
  };
}

function confirmationQuestion(selected: ResolvedPackage): string {
  const component = selected.component && selected.component !== "main"
    ? ` desde la sección ${selected.component}`
    : "";
  return `Voy a instalar ${selected.displayName} (${selected.packageName})${component}. ¿Sigo?`;
}
