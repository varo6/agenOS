import { discoverDisks } from "./disks";

export {
  buildPreflightResponse,
  firmwareTypeFromState,
  isLiveSessionFromState,
  liveSessionOverrideFromEnv,
  totalRamBytesFromMeminfo,
} from "../../shared/system-services/preflight";
import { createPreflightService } from "../../shared/system-services/preflight";

export function readPreflightPayload() {
  return createPreflightService({
    getDisks: discoverDisks,
  }).getPreflight();
}
