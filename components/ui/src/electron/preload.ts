import { contextBridge, ipcRenderer } from "electron";

import {
  PI_IPC_CHANNELS,
  SPEECH_IPC_CHANNELS,
  SYSTEM_IPC_CHANNELS,
  TTS_IPC_CHANNELS,
  type SpeechCapturePhase,
} from "./ipc";
import { NETWORK_IPC_CHANNELS, type ConnectWifiRequest } from "../../../network/types";
import type {
  ApiMessageResponse,
  AudioStatus,
  DisplayStatus,
  MaintenanceAction,
  PreflightResponse,
  ShellMode,
  SystemRuntimeInfo,
} from "../lib/system-types";
import type { SpeechTranscriptionOutcome } from "../lib/speech-bridge";
import type { TextToSpeechOutcome, TextToSpeechStatus } from "../lib/tts-bridge";
import type {
  PiAuthAttemptResponse,
  PiChatResponse,
  PiPendingAttempt,
  PiStartAuthRequest,
  PiStatusResponse,
  PiTurnState,
  PiConfigurationRequest,
} from "../lib/pi-types";

type IpcEnvelope<T> =
  | { ok: true; value: T }
  | { ok: false; status?: number; message: string };

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bridgeMode(): "ipc" | "http" {
  return process.env.AGENOS_SYSTEM_BRIDGE_MODE?.trim().toLowerCase() === "http" ? "http" : "ipc";
}

function isAvailable(): boolean {
  return bridgeMode() === "ipc";
}

async function invokeOrThrow<T>(channel: string, payload?: unknown): Promise<T> {
  try {
    return await ipcRenderer.invoke(channel, payload) as T;
  } catch (error) {
    throw new Error(normalizeErrorMessage(error));
  }
}

async function invokeApiMessage(channel: string, payload: unknown): Promise<ApiMessageResponse> {
  if (!isAvailable()) {
    return {
      ok: false,
      message: "El bridge IPC del sistema está desactivado.",
    };
  }

  try {
    const response = await ipcRenderer.invoke(channel, payload) as ApiMessageResponse;
    return {
      ok: response.ok,
      message: response.message ?? (response.ok ? undefined : "La operación no se pudo completar."),
    };
  } catch (error) {
    return {
      ok: false,
      message: normalizeErrorMessage(error),
    };
  }
}

async function invokePi<T>(channel: string, payload?: unknown): Promise<T> {
  const response = await ipcRenderer.invoke(channel, payload) as IpcEnvelope<T>;
  if (response.ok) {
    return response.value;
  }

  const failure = response as Extract<IpcEnvelope<T>, { ok: false }>;
  const error = new Error(failure.message) as Error & { status?: number };
  error.status = failure.status;
  throw error;
}

contextBridge.exposeInMainWorld("agenosSystem", {
  async getPreflight(): Promise<PreflightResponse> {
    if (!isAvailable()) {
      throw new Error("El bridge IPC del sistema está desactivado.");
    }

    return invokeOrThrow<PreflightResponse>(SYSTEM_IPC_CHANNELS.getPreflight);
  },
  async runMaintenance(action: MaintenanceAction): Promise<ApiMessageResponse> {
    return invokeApiMessage(SYSTEM_IPC_CHANNELS.runMaintenance, action);
  },
  async switchMode(mode: ShellMode): Promise<ApiMessageResponse> {
    return invokeApiMessage(SYSTEM_IPC_CHANNELS.switchMode, mode);
  },
  async getRuntimeInfo(): Promise<SystemRuntimeInfo> {
    return invokeOrThrow<SystemRuntimeInfo>(SYSTEM_IPC_CHANNELS.getRuntimeInfo);
  },
  async getDisplayStatus(): Promise<DisplayStatus> {
    return invokeOrThrow<DisplayStatus>(SYSTEM_IPC_CHANNELS.getDisplayStatus);
  },
  async setBrightness(percent: number): Promise<ApiMessageResponse> {
    return invokeApiMessage(SYSTEM_IPC_CHANNELS.setBrightness, percent);
  },
  async turnOffDisplay(): Promise<ApiMessageResponse> {
    return invokeApiMessage(SYSTEM_IPC_CHANNELS.turnOffDisplay, undefined);
  },
  async getAudioStatus(): Promise<AudioStatus> {
    return invokeOrThrow<AudioStatus>(SYSTEM_IPC_CHANNELS.getAudioStatus);
  },
  async setVolume(percent: number): Promise<ApiMessageResponse> {
    return invokeApiMessage(SYSTEM_IPC_CHANNELS.setVolume, percent);
  },
  async setMuted(muted: boolean): Promise<ApiMessageResponse> {
    return invokeApiMessage(SYSTEM_IPC_CHANNELS.setMuted, muted);
  },
  isAvailable,
});

contextBridge.exposeInMainWorld("agenosPi", {
  getStatus(): Promise<PiStatusResponse> {
    return invokePi<PiStatusResponse>(PI_IPC_CHANNELS.getStatus);
  },
  setConfiguration(configuration: PiConfigurationRequest): Promise<PiStatusResponse> {
    return invokePi<PiStatusResponse>(PI_IPC_CHANNELS.setConfiguration, configuration);
  },
  startAuth(method: PiStartAuthRequest["method"] = "device"): Promise<PiPendingAttempt> {
    return invokePi<PiPendingAttempt>(PI_IPC_CHANNELS.startAuth, { method });
  },
  async cancelAuth(attemptId?: string): Promise<void> {
    await invokePi<void>(PI_IPC_CHANNELS.cancelAuth, { attemptId });
  },
  getAuthAttempt(attemptId: string): Promise<PiAuthAttemptResponse> {
    return invokePi<PiAuthAttemptResponse>(PI_IPC_CHANNELS.getAuthAttempt, { attemptId });
  },
  submitManualCode(attemptId: string, input: string): Promise<PiAuthAttemptResponse> {
    return invokePi<PiAuthAttemptResponse>(PI_IPC_CHANNELS.submitManualCode, { attemptId, input });
  },
  async logout(): Promise<void> {
    await invokePi<void>(PI_IPC_CHANNELS.logout);
  },
  async startNewConversation(): Promise<void> {
    await invokePi<void>(PI_IPC_CHANNELS.newConversation);
  },
  sendMessage(message: string, source: "text" | "voice"): Promise<PiChatResponse> {
    return invokePi<PiChatResponse>(PI_IPC_CHANNELS.sendMessage, { message, source });
  },
  startTurn(message: string, source: "text" | "voice"): Promise<PiTurnState> {
    return invokePi<PiTurnState>(PI_IPC_CHANNELS.startTurn, { message, source });
  },
  getTurn(turnId: string): Promise<PiTurnState> {
    return invokePi<PiTurnState>(PI_IPC_CHANNELS.getTurn, { turnId });
  },
  cancelTurn(turnId: string): Promise<PiTurnState> {
    return invokePi<PiTurnState>(PI_IPC_CHANNELS.cancelTurn, { turnId });
  },
  getLatestTurn(): Promise<PiTurnState | null> {
    return invokePi<PiTurnState | null>(PI_IPC_CHANNELS.getLatestTurn);
  },
  listTurns(limit?: number): Promise<PiTurnState[]> {
    return invokePi<PiTurnState[]>(PI_IPC_CHANNELS.listTurns, { limit });
  },
  isAvailable,
});

contextBridge.exposeInMainWorld("agenosSpeech", {
  transcribeOnce(): Promise<SpeechTranscriptionOutcome> {
    return invokePi<SpeechTranscriptionOutcome>(SPEECH_IPC_CHANNELS.transcribeOnce);
  },
  async finish(): Promise<void> {
    await invokePi<void>(SPEECH_IPC_CHANNELS.finish);
  },
  async cancel(): Promise<void> {
    await invokePi<void>(SPEECH_IPC_CHANNELS.cancel);
  },
  onPhase(listener: (phase: SpeechCapturePhase) => void): () => void {
    const handler = (_event: unknown, phase: SpeechCapturePhase) => {
      listener(phase);
    };

    ipcRenderer.on(SPEECH_IPC_CHANNELS.phase, handler);
    return () => {
      ipcRenderer.off(SPEECH_IPC_CHANNELS.phase, handler);
    };
  },
  isAvailable,
});

contextBridge.exposeInMainWorld("agenosTts", {
  speak(text: string): Promise<TextToSpeechOutcome> {
    return invokePi<TextToSpeechOutcome>(TTS_IPC_CHANNELS.speak, { text });
  },
  async stop(): Promise<void> {
    await invokePi<void>(TTS_IPC_CHANNELS.stop);
  },
  status(): Promise<TextToSpeechStatus> {
    return invokePi<TextToSpeechStatus>(TTS_IPC_CHANNELS.status);
  },
  isAvailable,
});

contextBridge.exposeInMainWorld(
  "__AGENOS_CAPTIVE_PORTAL_URL__",
  process.env.AGENOS_CAPTIVE_PORTAL_URL?.trim() || null,
);

contextBridge.exposeInMainWorld("agenosNetwork", {
  getStatus() {
    return invokeOrThrow(NETWORK_IPC_CHANNELS.getStatus);
  },
  scanWifi() {
    return invokeOrThrow(NETWORK_IPC_CHANNELS.scanWifi);
  },
  listAccessPoints() {
    return invokeOrThrow(NETWORK_IPC_CHANNELS.listAccessPoints);
  },
  connectWifi(request: ConnectWifiRequest) {
    return invokeOrThrow(NETWORK_IPC_CHANNELS.connectWifi, request);
  },
  disconnectWifi() {
    return invokeOrThrow(NETWORK_IPC_CHANNELS.disconnectWifi);
  },
  setWifiEnabled(enabled: boolean) {
    return invokeOrThrow(NETWORK_IPC_CHANNELS.setWifiEnabled, { enabled });
  },
  isAvailable,
});
