export const SYSTEM_IPC_CHANNELS = {
  getPreflight: "agenos-system:get-preflight",
  runMaintenance: "agenos-system:run-maintenance",
  switchMode: "agenos-system:switch-mode",
  getRuntimeInfo: "agenos-system:get-runtime-info",
  getDisplayStatus: "agenos-system:get-display-status",
  setBrightness: "agenos-system:set-brightness",
  turnOffDisplay: "agenos-system:turn-off-display",
  getAudioStatus: "agenos-system:get-audio-status",
  setVolume: "agenos-system:set-volume",
  setMuted: "agenos-system:set-muted",
} as const;

export const PI_IPC_CHANNELS = {
  getStatus: "agenos-pi:get-status",
  setConfiguration: "agenos-pi:set-configuration",
  startAuth: "agenos-pi:start-auth",
  cancelAuth: "agenos-pi:cancel-auth",
  getAuthAttempt: "agenos-pi:get-auth-attempt",
  submitManualCode: "agenos-pi:submit-manual-code",
  logout: "agenos-pi:logout",
  newConversation: "agenos-pi:new-conversation",
  sendMessage: "agenos-pi:send-message",
  startTurn: "agenos-pi:start-turn",
  getTurn: "agenos-pi:get-turn",
  cancelTurn: "agenos-pi:cancel-turn",
  getLatestTurn: "agenos-pi:get-latest-turn",
  listTurns: "agenos-pi:list-turns",
} as const;

export const SPEECH_IPC_CHANNELS = {
  transcribeOnce: "agenos-speech:transcribe-once",
  /** Cierra el microfono y procesa el audio capturado hasta ese instante. */
  finish: "agenos-speech:finish",
  /**
   * Aborta la captura viva: mata grabador y VAD, suelta el micrófono y hace que
   * la transcripción en curso no llegue nunca. Sin esto, cancelar desde la
   * interfaz solo dejaba de escuchar la respuesta mientras arecord seguía.
   */
  cancel: "agenos-speech:cancel",
  /**
   * Evento del proceso principal al renderer con la fase de la captura. Sin
   * esto la interfaz no puede distinguir "te escucho" de "estoy entendiendo lo
   * que has dicho", que es la señal más importante de una interfaz por voz.
   */
  phase: "agenos-speech:phase",
} as const;

export const TTS_IPC_CHANNELS = {
  speak: "agenos-tts:speak",
  stop: "agenos-tts:stop",
  status: "agenos-tts:status",
} as const;

/**
 * Fases observables de una captura de voz local.
 *
 * `speech` es nueva y la empuja el VAD: es el instante en el que Silero
 * confirma que lo que entra por el micrófono es voz y no ruido de sala.
 */
export type SpeechCapturePhase = "listening" | "speech" | "transcribing";
