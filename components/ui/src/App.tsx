import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Clipboard,
  ExternalLink,
  LoaderCircle,
  LogOut,
  MessageSquareText,
  Mic,
  RefreshCcw,
  ShieldCheck,
  ShieldX,
  XCircle,
} from "lucide-react";

import { AgentDiagnosticsButton } from "./components/AgentDiagnosticsButton";
import { AgentAdminPanel } from "./components/AgentAdminPanel";
import { AgentHealthChecklist } from "./components/AgentHealthChecklist";
import { AgentOnboardingPanel } from "./components/AgentOnboardingPanel";
import { VideoBackground } from "./components/VideoBackground";
import { createAgentAdminClient } from "./lib/agent-admin-client";
import { createAgentClient } from "./lib/agent-client";
import { classifyAgentCommand } from "./lib/agent-command";
import { createPiClient, PiClientError } from "./lib/pi-client";
import {
  createSpeechRecognitionController,
  isSpeechRecognitionSupported,
  type SpeechRecognitionController,
  type SpeechRecognitionError,
} from "./lib/speech-recognition";
import type { PiAuthState, PiChatSource, PiPendingAttempt, PiStatusResponse } from "./lib/pi-types";
import type { AgentAdminStatus, AgentSetupStateSummary } from "./lib/system-types";

type VoiceState = "idle" | "listening" | "unsupported" | "error";
type ChatState = "idle" | "processing" | "error";

const piClient = createPiClient();
const agentClient = createAgentClient();
const agentAdminClient = createAgentAdminClient();

function describeClientError(error: unknown): string {
  if (error instanceof PiClientError || error instanceof Error) {
    return error.message;
  }

  return "No se pudo completar la accion.";
}

function describeAuthState(authState: PiAuthState): string {
  switch (authState) {
    case "connected":
      return "Conexion local lista para ChatGPT/Codex.";
    case "authorizing":
      return "Esperando a que termine el login del navegador.";
    case "error":
      return "La autenticacion necesita atencion.";
    default:
      return "Conecta ChatGPT para empezar.";
  }
}



export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [harnessAvailable, setHarnessAvailable] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [authState, setAuthState] = useState<PiAuthState>("disconnected");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [chatState, setChatState] = useState<ChatState>("idle");
  const [providerName, setProviderName] = useState("ChatGPT/Codex");
  const [modelId, setModelId] = useState("gpt-5.4-mini");
  const [serverBusy, setServerBusy] = useState(false);
  const [pendingAttempt, setPendingAttempt] = useState<PiPendingAttempt | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentAdminStatus | null>(null);
  const [agentBackendError, setAgentBackendError] = useState<string | null>(null);
  const [manualCodeInput, setManualCodeInput] = useState("");
  const [draft, setDraft] = useState("");
  const [lastInput, setLastInput] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [voiceIssue, setVoiceIssue] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "backend">("chat");
  const speechControllerRef = useRef<SpeechRecognitionController | null>(null);
  const authActionIdRef = useRef(0);

  const applyStatus = useCallback((status: PiStatusResponse) => {
    setHarnessAvailable(true);
    setProviderName(status.providerName);
    setModelId(status.modelId);
    setServerBusy(status.busy);
    setPendingAttempt(status.pendingAttempt ?? null);
    setAuthState(status.authState);
    if (status.error) {
      setGlobalError(status.error);
    }
  }, []);

  const refreshStatus = useCallback(async (options: { clearErrors?: boolean } = {}) => {
    try {
      const status = await piClient.getStatus();
      applyStatus(status);
      if (status.error) {
        setGlobalError(status.error);
      } else if (options.clearErrors) {
        setGlobalError(null);
        setChatState((current) => (current === "error" ? "idle" : current));
      } else {
        setGlobalError((current) =>
          current === "Harness de desarrollo no disponible." ? null : current,
        );
      }
      return status;
    } catch (error) {
      const message = describeClientError(error);
      setHarnessAvailable(false);
      setAuthState("error");
      setServerBusy(false);
      setPendingAttempt(null);
      setGlobalError(message);
      throw error;
    }
  }, [applyStatus]);

  const refreshAgentStatus = useCallback(async () => {
    try {
      const status = await agentAdminClient.getStatus();
      setAgentStatus(status);
      setAgentBackendError(null);
      return status;
    } catch (error) {
      const message = describeClientError(error);
      setAgentStatus(null);
      setAgentBackendError(message);
      return null;
    }
  }, []);

  const sendPrompt = useCallback(async (message: string, source: PiChatSource) => {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    const command = classifyAgentCommand(trimmed);

    setChatState("processing");
    setGlobalError(null);
    setLastInput(trimmed);
    setLastReply("");
    if (source === "text") {
      setDraft("");
    }

    if (command.kind === "memory") {
      try {
        const response = await agentClient.appendMemory(command.namespace, command.content);
        setLastReply(response.message ?? "Memoria guardada.");
        setChatState("idle");
      } catch (error) {
        setChatState("error");
        setGlobalError(describeClientError(error));
      }
      return;
    }

    if (command.kind === "background") {
      try {
        const response = await agentClient.delegateBackgroundTask(command.message);
        setLastReply(response.message ?? `Tarea enviada: ${response.taskId ?? "sin id"}`);
        setChatState("idle");
      } catch (error) {
        setChatState("error");
        setGlobalError(describeClientError(error));
      }
      return;
    }


    if (authState !== "connected") {
      setChatState("idle");
      setAuthState("error");
      setGlobalError("Conecta ChatGPT antes de enviar mensajes.");
      return;
    }

    try {
      const response = await piClient.sendMessage(trimmed, source);
      setLastReply(response.reply ?? "");
      setModelId(response.modelId);
      setChatState("idle");
      await refreshStatus();
    } catch (error) {
      const message = describeClientError(error);
      setChatState("error");
      setGlobalError(message);
      if (error instanceof PiClientError && error.status === 401) {
        setAuthState("error");
      }
      try {
        await refreshStatus();
      } catch {
        // refreshStatus already updated the UI with the relevant failure
      }
    }
  }, [authState, refreshAgentStatus, refreshStatus]);

  const handleVoiceResult = useCallback((transcript: string) => {
    setVoiceState("idle");
    setVoiceIssue(null);
    void sendPrompt(transcript, "voice");
  }, [sendPrompt]);

  const handleVoiceError = useCallback((error: SpeechRecognitionError) => {
    setVoiceIssue(error.message);
    setVoiceState(error.disableVoice ? "unsupported" : "error");
  }, []);

  const handleVoiceEnd = useCallback(() => {
    setVoiceState((current) => (current === "listening" ? "idle" : current));
  }, []);

  useEffect(() => {
    const controller = createSpeechRecognitionController({
      onResult: handleVoiceResult,
      onError: handleVoiceError,
      onEnd: handleVoiceEnd,
    });

    speechControllerRef.current = controller;

    if (!controller.supported) {
      setVoiceState("unsupported");
      setVoiceIssue("Este navegador no expone Web Speech API. Usa texto.");
    }

    void Promise.allSettled([refreshStatus(), refreshAgentStatus()])
      .finally(() => {
        setIsLoading(false);
      });

    return () => {
      controller.dispose();
      speechControllerRef.current = null;
    };
  }, [handleVoiceEnd, handleVoiceError, handleVoiceResult, refreshAgentStatus, refreshStatus]);

  useEffect(() => {
    if (!pendingAttempt) {
      return;
    }

    let cancelled = false;

    const pollAttempt = async () => {
      try {
        const attempt = await piClient.getAuthAttempt(pendingAttempt.attemptId);
        if (cancelled) {
          return;
        }

        if (attempt.status === "pending") {
          return;
        }

        if (attempt.status === "success") {
          setManualCodeInput("");
          setGlobalError(null);
          await refreshStatus();
          return;
        }

        setAuthState("error");
        setPendingAttempt(null);
        setGlobalError(attempt.error ?? "No se pudo completar el login.");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setAuthState("error");
        setPendingAttempt(null);
        setGlobalError(describeClientError(error));
      }
    };

    void pollAttempt();
    const intervalId = window.setInterval(() => {
      void pollAttempt();
    }, 1250);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [pendingAttempt, refreshStatus]);

  async function handleStartAuth(method: "device" | "browser" = "device") {
    if (!harnessAvailable || chatState === "processing") {
      return;
    }

    const actionId = authActionIdRef.current + 1;
    authActionIdRef.current = actionId;
    setGlobalError(null);
    setAuthState("authorizing");

    try {
      const attempt = await piClient.startAuth(method);
      if (authActionIdRef.current !== actionId) {
        return;
      }

      setPendingAttempt(attempt);
      setManualCodeInput("");

      if (method === "browser") {
        const popup = window.open(attempt.url, "_blank", "noopener");
        if (!popup) {
          setGlobalError("No se pudo abrir una pestana nueva. Usa el campo manual.");
        }
      }
    } catch (error) {
      if (authActionIdRef.current !== actionId) {
        return;
      }

      setAuthState("error");
      setGlobalError(describeClientError(error));
    }
  }

  async function handleCancelAuth() {
    if (!harnessAvailable || !pendingAttempt) {
      return;
    }

    authActionIdRef.current += 1;
    setGlobalError(null);

    try {
      await piClient.cancelAuth(pendingAttempt.attemptId);
      setPendingAttempt(null);
      setManualCodeInput("");
      setServerBusy(false);
      setAuthState("disconnected");
      await refreshStatus({ clearErrors: true });
    } catch (error) {
      setAuthState("error");
      setGlobalError(describeClientError(error));
    }
  }

  async function handleLogout() {
    if (!harnessAvailable) {
      return;
    }

    authActionIdRef.current += 1;
    setGlobalError(null);

    try {
      await piClient.logout();
      setPendingAttempt(null);
      setManualCodeInput("");
      setLastInput("");
      setLastReply("");
      setChatState("idle");
      setServerBusy(false);
      setAuthState("disconnected");
      if (isSpeechRecognitionSupported()) {
        setVoiceState((current) => (current === "unsupported" ? "unsupported" : "idle"));
      }
    } catch (error) {
      setGlobalError(describeClientError(error));
    }
  }

  async function handleManualCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingAttempt) {
      return;
    }

    try {
      await piClient.submitManualCode(pendingAttempt.attemptId, manualCodeInput);
      setManualCodeInput("");
      setGlobalError(null);
    } catch (error) {
      setGlobalError(describeClientError(error));
    }
  }

  function handleTextSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (chatState === "processing" || serverBusy) {
      return;
    }

    void sendPrompt(draft, "text");
  }

  function refreshAgentExperience() {
    void Promise.allSettled([
      refreshStatus({ clearErrors: true }),
      refreshAgentStatus(),
    ]);
  }

  function handleVoiceStart() {
    if (
      !speechControllerRef.current?.supported
      || authState !== "connected"
      || chatState === "processing"
      || serverBusy
    ) {
      return;
    }

    setGlobalError(null);
    setVoiceIssue(null);
    setVoiceState("listening");

    const started = speechControllerRef.current.start();
    if (!started) {
      setVoiceState("error");
    }
  }

  const isProcessing = chatState === "processing" || serverBusy;
  const micDisabled =
    !harnessAvailable
    || authState !== "connected"
    || voiceState === "unsupported"
    || isProcessing;
  const textDisabled =
    !harnessAvailable
    || isProcessing
    || authState === "authorizing";
  const connectLabel = authState === "disconnected" ? "Conectar ChatGPT" : "Reconectar";
  const voiceHint =
    voiceState === "unsupported"
      ? voiceIssue ?? "Este navegador no expone Web Speech API. Usa texto."
      : authState !== "connected"
        ? "Conecta ChatGPT para activar el micro."
        : isProcessing
          ? "Esperando la respuesta final del agente."
          : voiceState === "listening"
            ? "Escuchando una sola frase para enviarla al agente."
            : voiceState === "error"
              ? voiceIssue ?? "No se pudo usar el micro. Usa texto."
              : "Habla o escribe una frase corta.";
  const authHint = pendingAttempt
    ? pendingAttempt.instructions
    : describeAuthState(authState);

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#07090f] text-white selection:bg-white/20">
      <VideoBackground />
      <AgentDiagnosticsButton />

      {globalError ? (
        <div className="fixed left-1/2 top-6 z-50 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2">
          <div className="glass-panel flex items-start gap-4 border-danger/30 bg-danger/10 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white">Estado del harness</p>
              <p className="mt-1 text-sm text-white/70">{globalError}</p>
            </div>
            <button
              aria-label="Cerrar error"
              className="rounded-full p-1 text-white/50 transition-colors hover:text-white"
              onClick={() => setGlobalError(null)}
              type="button"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-6 backdrop-blur-sm">
          <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
            <LoaderCircle className="h-6 w-6 animate-spin text-white/60" />
            <p className="font-mono text-sm uppercase tracking-widest text-white/60">
              Iniciando Harness
            </p>
          </div>
        </div>
      ) : (
        <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col items-center justify-center px-6 py-20 sm:py-28">
          <div className="mb-8 inline-flex rounded-lg border border-white/10 bg-black/25 p-1">
            <button
              className={[
                "rounded-md px-4 py-2 text-sm transition-colors",
                activeTab === "chat" ? "bg-white text-black" : "text-white/65 hover:text-white",
              ].join(" ")}
              onClick={() => setActiveTab("chat")}
              type="button"
            >
              Chat
            </button>
            <button
              className={[
                "rounded-md px-4 py-2 text-sm transition-colors",
                activeTab === "backend" ? "bg-white text-black" : "text-white/65 hover:text-white",
              ].join(" ")}
              onClick={() => setActiveTab("backend")}
              type="button"
            >
              Backend
            </button>
          </div>
          {activeTab === "backend" ? (
            <div className="grid w-full gap-4">
              <AgentAdminPanel client={agentAdminClient} />
            </div>
          ) : (
          <div className="flex w-full flex-col items-center gap-12 text-center">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-white/60 backdrop-blur-md">
                <span
                  className={[
                    "h-1.5 w-1.5 rounded-full",
                    authState === "connected"
                      ? "bg-accent"
                      : authState === "error"
                        ? "bg-danger"
                        : "bg-white/35",
                  ].join(" ")}
                />
                {harnessAvailable ? "UI Dev Harness" : "Dev Harness Offline"}
              </div>

              <h1 className="font-display text-5xl font-medium tracking-tight text-white sm:text-7xl lg:text-8xl">
                AgenOS
              </h1>

              <p className="mx-auto max-w-xl text-base text-white/55 sm:text-lg">
                Shell visual de AgenOS sobre un harness local de ChatGPT/Codex para desarrollo web.
              </p>
            </div>

            <div className="relative flex justify-center py-4">
              <button
                aria-label="Activar micro"
                className="group relative flex h-32 w-32 items-center justify-center rounded-full border border-white/10 bg-white/5 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[0.98] hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45 sm:h-40 sm:w-40"
                disabled={micDisabled}
                onClick={handleVoiceStart}
                type="button"
              >
                <div
                  className={[
                    "absolute inset-0 rounded-full border border-white/5 transition-transform duration-700",
                    voiceState === "listening"
                      ? "animate-spin-slow scale-[1.15] border-t-white/30"
                      : "scale-100",
                  ].join(" ")}
                />
                <div
                  className={[
                    "absolute inset-[-1px] rounded-full border border-white/10 transition-transform duration-1000",
                    isProcessing
                      ? "animate-spin-slow scale-105 border-b-accent/40"
                      : "scale-100",
                  ].join(" ")}
                />

                <div className="flex items-center justify-center text-white/70 transition-colors group-hover:text-white">
                  {isProcessing ? (
                    <LoaderCircle className="h-8 w-8 animate-spin sm:h-10 sm:w-10" strokeWidth={1.5} />
                  ) : (
                    <Mic className="h-8 w-8 sm:h-10 sm:w-10" strokeWidth={1.5} />
                  )}
                </div>
              </button>
            </div>

            <div className="w-full max-w-xl text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/35">
                Micro Local
              </p>
              <p className="mt-3 text-sm text-white/60 sm:text-base">{voiceHint}</p>
            </div>

            <div className="grid w-full gap-4 text-left lg:grid-cols-[1.1fr_0.9fr]">
              <div className="grid gap-4 lg:col-span-2">
                <AgentHealthChecklist
                  adminStatus={agentStatus}
                  authState={authState}
                  backendError={agentBackendError}
                  harnessAvailable={harnessAvailable}
                />
                <AgentOnboardingPanel
                  adminStatus={agentStatus}
                  authState={authState}
                  backendError={agentBackendError}
                  harnessAvailable={harnessAvailable}
                  onConnectCodex={() => {
                    void handleStartAuth("device");
                  }}
                  onOpenBackend={() => setActiveTab("backend")}
                  onRefresh={refreshAgentExperience}
                />
              </div>

              <div className="glass-panel flex flex-col gap-6 p-7 sm:p-8">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/35">
                      Estado de Conexion
                    </p>
                    <h2 className="mt-3 text-2xl font-medium text-white">
                      {providerName}
                    </h2>
                    <p className="mt-2 text-sm text-white/55">{authHint}</p>
                  </div>
                  <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 font-mono text-[11px] text-white/60">
                    {modelId}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="btn-primary inline-flex items-center gap-2"
                    disabled={!harnessAvailable || authState === "authorizing" || isProcessing}
                    onClick={() => {
                      void handleStartAuth("device");
                    }}
                    type="button"
                  >
                    {authState === "authorizing" ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4" />
                    )}
                    {connectLabel} con codigo
                  </button>

                  <button
                    className="btn-secondary inline-flex items-center gap-2"
                    disabled={!harnessAvailable || authState === "authorizing"}
                    onClick={handleLogout}
                    type="button"
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </button>

                  {pendingAttempt ? (
                    <button
                      className="btn-secondary inline-flex items-center gap-2"
                      disabled={!harnessAvailable}
                      onClick={() => {
                        void handleCancelAuth();
                      }}
                      type="button"
                    >
                      <XCircle className="h-4 w-4" />
                      Cancelar login
                    </button>
                  ) : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                    <div className="flex items-center gap-2 text-sm text-white/75">
                      {authState === "connected" ? (
                        <ShieldCheck className="h-4 w-4 text-accent" />
                      ) : (
                        <ShieldX className="h-4 w-4 text-danger" />
                      )}
                      Cuenta
                    </div>
                    <p className="mt-2 font-mono text-xs uppercase tracking-[0.24em] text-white/35">
                      {authState}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                    <div className="flex items-center gap-2 text-sm text-white/75">
                      <MessageSquareText className="h-4 w-4 text-white/70" />
                      Turno
                    </div>
                    <p className="mt-2 font-mono text-xs uppercase tracking-[0.24em] text-white/35">
                      {isProcessing ? "processing" : chatState}
                    </p>
                  </div>
                </div>

                {pendingAttempt ? (
                  pendingAttempt.method === "device" ? (
                    <div className="grid gap-3 rounded-lg border border-white/8 bg-black/20 p-4">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/35">
                          Device Auth
                        </p>
                        <a
                          className="mt-2 inline-flex min-w-0 items-center gap-2 break-all text-sm text-accent-light hover:text-white"
                          href={pendingAttempt.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {pendingAttempt.url}
                          <ExternalLink className="h-4 w-4 shrink-0" />
                        </a>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <code className="rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-lg tracking-[0.18em] text-white">
                          {pendingAttempt.userCode ?? "Esperando codigo..."}
                        </code>
                        <button
                          className="btn-secondary inline-flex items-center gap-2"
                          disabled={!pendingAttempt.userCode}
                          onClick={() => {
                            if (pendingAttempt.userCode) {
                              void navigator.clipboard?.writeText(pendingAttempt.userCode);
                            }
                          }}
                          type="button"
                        >
                          <Clipboard className="h-4 w-4" />
                          Copiar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <form className="flex flex-col gap-3" onSubmit={handleManualCodeSubmit}>
                      <div>
                        <label
                          className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/35"
                          htmlFor="manual-code"
                        >
                          Pegar URL o Codigo Manual
                        </label>
                        <input
                          className="glass-input mt-3"
                          id="manual-code"
                          onChange={(event) => setManualCodeInput(event.target.value)}
                          placeholder="http://localhost:1455/auth/callback?... o el code"
                          value={manualCodeInput}
                        />
                      </div>

                      <button className="btn-secondary self-start" type="submit">
                        Enviar fallback manual
                      </button>
                    </form>
                  )
                ) : null}

                <form className="flex flex-col gap-3" onSubmit={handleTextSubmit}>
                  <div>
                    <label
                      className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/35"
                      htmlFor="message"
                    >
                      Texto
                    </label>
                    <input
                      className="glass-input mt-3"
                      disabled={textDisabled}
                      id="message"
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="Escribe una frase corta en espanol"
                      value={draft}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button className="btn-primary" disabled={textDisabled} type="submit">
                      {isProcessing ? "Procesando..." : "Enviar"}
                    </button>

                    <button
                      className="btn-secondary inline-flex items-center gap-2"
                      disabled={!harnessAvailable}
                      onClick={() => {
                        void refreshStatus({ clearErrors: true });
                      }}
                      type="button"
                    >
                      <RefreshCcw className="h-4 w-4" />
                      Refrescar estado
                    </button>
                  </div>
                </form>
              </div>

              <div className="glass-panel flex flex-col gap-6 p-7 sm:p-8">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/35">
                    Ultimo Turno
                  </p>
                  <h2 className="mt-3 text-2xl font-medium text-white">
                    Respuesta minima
                  </h2>
                  <p className="mt-2 text-sm text-white/55">
                    Este MVP solo muestra el ultimo input y la ultima respuesta del agente.
                  </p>
                </div>

                <div className="rounded-2xl border border-white/8 bg-black/20 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">
                    Input
                  </p>
                  <p className="mt-3 min-h-[4.5rem] text-sm leading-6 text-white/80">
                    {lastInput || "Todavia no enviaste ningun mensaje."}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/8 bg-black/20 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">
                    Respuesta
                  </p>
                  <p className="mt-3 min-h-[10rem] whitespace-pre-wrap text-sm leading-6 text-white/85">
                    {lastReply
                      || (chatState === "error" && globalError
                        ? globalError
                        : isProcessing
                          ? "Esperando respuesta final..."
                          : "Todavia no hay respuesta.")}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/8 bg-black/20 p-5 text-sm text-white/60">
                  Disponible solo en `http://127.0.0.1:4174` con `bun dev`.
                </div>
              </div>
            </div>
          </div>
          )}
        </div>
      )}
    </div>
  );
}
