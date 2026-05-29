export const SYSTEM_IPC_CHANNELS = {
  getPreflight: "agenos-system:get-preflight",
  runMaintenance: "agenos-system:run-maintenance",
  switchMode: "agenos-system:switch-mode",
  getRuntimeInfo: "agenos-system:get-runtime-info",
} as const;

export const PI_IPC_CHANNELS = {
  getStatus: "agenos-pi:get-status",
  startAuth: "agenos-pi:start-auth",
  cancelAuth: "agenos-pi:cancel-auth",
  getAuthAttempt: "agenos-pi:get-auth-attempt",
  submitManualCode: "agenos-pi:submit-manual-code",
  logout: "agenos-pi:logout",
  sendMessage: "agenos-pi:send-message",
} as const;
