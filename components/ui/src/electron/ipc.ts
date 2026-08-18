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
  newConversation: "agenos-pi:new-conversation",
  sendMessage: "agenos-pi:send-message",
  startTurn: "agenos-pi:start-turn",
  getTurn: "agenos-pi:get-turn",
  getLatestTurn: "agenos-pi:get-latest-turn",
  listTurns: "agenos-pi:list-turns",
} as const;

export const SPEECH_IPC_CHANNELS = {
  transcribeOnce: "agenos-speech:transcribe-once",
  /**
   * Evento del proceso principal al renderer con la fase de la captura. Sin
   * esto la interfaz no puede distinguir "te escucho" de "estoy entendiendo lo
   * que has dicho", que es la señal más importante de una interfaz por voz.
   */
  phase: "agenos-speech:phase",
} as const;

/** Fases observables de una captura de voz local. */
export type SpeechCapturePhase = "listening" | "transcribing";
