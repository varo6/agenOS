import { discoverDisks } from "../../../installer-ui/src/bun/installer/disks";
import { createMaintenanceService } from "../../../installer-ui/src/shared/system-services/maintenance";
import { createPreflightService } from "../../../installer-ui/src/shared/system-services/preflight";
import { createSwitchModeService } from "../../../installer-ui/src/shared/system-services/switch-mode";
import {
  INVALID_MAINTENANCE_ACTION_MESSAGE,
  isMaintenanceAction,
  isShellMode,
} from "../../../installer-ui/src/shared/system-services/runtime";
import type { ApiMessageResponse, MaintenanceAction, PreflightResponse, ShellMode } from "../lib/system-types";

type SystemIpcServiceDependencies = {
  preflight: { getPreflight(): PreflightResponse };
  maintenance: {
    runMaintenance(action: MaintenanceAction): Promise<ApiMessageResponse>;
  };
  modeSwitch: { switchMode(mode: ShellMode): Promise<ApiMessageResponse> };
};

export function createSystemIpcServices(dependencies: Partial<SystemIpcServiceDependencies> = {}) {
  const deps: SystemIpcServiceDependencies = {
    preflight: dependencies.preflight ?? createPreflightService({ getDisks: discoverDisks }),
    maintenance: dependencies.maintenance ?? createMaintenanceService(),
    modeSwitch: dependencies.modeSwitch ?? createSwitchModeService(),
  };

  return {
    getPreflight(): PreflightResponse {
      return deps.preflight.getPreflight();
    },
    async runMaintenance(action: unknown): Promise<ApiMessageResponse> {
      /*
       * El renderer manda un nombre de acción, nunca un comando. Aquí se
       * comprueba contra la lista cerrada antes de que nada llegue a `pkexec`.
       */
      if (!isMaintenanceAction(action)) {
        return { ok: false, message: INVALID_MAINTENANCE_ACTION_MESSAGE };
      }
      return deps.maintenance.runMaintenance(action);
    },
    async switchMode(mode: unknown): Promise<ApiMessageResponse> {
      if (!isShellMode(mode)) {
        return { ok: false, message: "El modo debe ser installer o system." };
      }
      return deps.modeSwitch.switchMode(mode);
    },
  };
}
