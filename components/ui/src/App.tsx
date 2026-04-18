import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, LoaderCircle, Mic, TerminalSquare } from "lucide-react";
import { VideoBackground } from "./components/VideoBackground";

type MaintenanceAction = "terminal";
type VoiceState = "idle" | "listening" | "processing" | "error";
type CommandOrigin = "voice" | "text";
type FirmwareType = "UEFI" | "BIOS";

type ApiMessageResponse = {
  ok: boolean;
  message?: string;
};

type PreflightCheck = {
  id: string;
  label: string;
  status: "ok" | "warning" | "error";
  detail: string;
};

type PreflightResponse = {
  firmware: FirmwareType;
  isLiveSession: boolean;
  totalRamBytes: number;
  installableDiskBytes: number;
  checks: PreflightCheck[];
};

type ShellMode = "installer" | "system";

const VOICE_DEMO_DELAY_MS = 900;
const SYSTEM_VOICE_DEMO_TRANSCRIPT = "abre terminal de mantenimiento";
const TERMINAL_COMMANDS = new Set([
  "terminal",
  "abre terminal",
  "abrir terminal",
  "abre la terminal",
  "abrir la terminal",
  "terminal de mantenimiento",
  "abre terminal de mantenimiento",
  "abrir terminal de mantenimiento",
]);

function normalizeSystemCommand(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function interpretSystemCommand(input: string):
  | { ok: true; action: MaintenanceAction; summary: string }
  | { ok: false; message: string } {
  if (TERMINAL_COMMANDS.has(normalizeSystemCommand(input))) {
    return {
      ok: true,
      action: "terminal",
      summary: "Abrir terminal de mantenimiento",
    };
  }

  return {
    ok: false,
    message: "No he entendido el comando. Prueba con 'abre terminal de mantenimiento'.",
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) as T | ApiMessageResponse : undefined;
  if (!response.ok) {
    if (payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string") {
      throw new Error(payload.message);
    }
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return payload as T;
}

async function getPreflight(): Promise<PreflightResponse> {
  return requestJson<PreflightResponse>("/api/installer/preflight");
}

async function runMaintenance(action: MaintenanceAction): Promise<ApiMessageResponse> {
  return requestJson<ApiMessageResponse>("/api/system/maintenance", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action }),
  });
}

async function switchMode(mode: ShellMode): Promise<ApiMessageResponse> {
  return requestJson<ApiMessageResponse>("/api/installer/switch-mode", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mode }),
  });
}

export default function App() {
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [commandDraft, setCommandDraft] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [isSwitchingToInstaller, setIsSwitchingToInstaller] = useState(false);
  const [lastCommandOrigin, setLastCommandOrigin] = useState<CommandOrigin | null>(null);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastIntentLabel, setLastIntentLabel] = useState<string | null>(null);
  const [lastActionLabel, setLastActionLabel] = useState<string | null>(null);
  const [lastResultMessage, setLastResultMessage] = useState<string | null>(null);
  const voiceDemoTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    void getPreflight()
      .then((response) => {
        if (!active) {
          return;
        }

        setPreflight(response);
        setGlobalError(null);
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        setGlobalError(error instanceof Error ? error.message : "No se pudo cargar la vista principal.");
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
      if (voiceDemoTimerRef.current !== null) {
        window.clearTimeout(voiceDemoTimerRef.current);
      }
    };
  }, []);

  async function executeSystemCommand(input: string, origin: CommandOrigin) {
    const transcript = input.trim();

    setLastCommandOrigin(origin);
    setLastTranscript(transcript);
    setLastIntentLabel(null);
    setLastActionLabel(null);
    setLastResultMessage(null);
    setVoiceState("processing");

    const interpreted = interpretSystemCommand(transcript);
    if (!interpreted.ok) {
      setLastResultMessage(interpreted.message);
      setVoiceState("error");
      return;
    }

    setLastIntentLabel(interpreted.summary);
    setLastActionLabel(interpreted.action);

    try {
      const response = await runMaintenance(interpreted.action);
      setLastResultMessage(response.message ?? "Acción completada.");
      setVoiceState("idle");
    } catch (error) {
      setLastResultMessage(
        error instanceof Error ? error.message : "No se pudo ejecutar la acción de mantenimiento.",
      );
      setVoiceState("error");
    }
  }

  function handleSystemCommandSubmit() {
    const trimmed = commandDraft.trim();
    if (!trimmed || voiceState === "listening" || voiceState === "processing") {
      return;
    }

    setCommandDraft("");
    void executeSystemCommand(trimmed, "text");
  }

  function handleVoiceDemoStart() {
    if (voiceState === "listening" || voiceState === "processing") {
      return;
    }

    if (voiceDemoTimerRef.current !== null) {
      window.clearTimeout(voiceDemoTimerRef.current);
    }

    setLastCommandOrigin("voice");
    setLastTranscript("");
    setLastIntentLabel(null);
    setLastActionLabel(null);
    setLastResultMessage("Esperando la transcripción simulada...");
    setVoiceState("listening");

    voiceDemoTimerRef.current = window.setTimeout(() => {
      voiceDemoTimerRef.current = null;
      void executeSystemCommand(SYSTEM_VOICE_DEMO_TRANSCRIPT, "voice");
    }, VOICE_DEMO_DELAY_MS);
  }

  async function handleOpenInstaller() {
    if (!preflight?.isLiveSession || isSwitchingToInstaller) {
      return;
    }

    setIsSwitchingToInstaller(true);
    setGlobalError(null);

    try {
      await switchMode("installer");
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "No se pudo abrir el instalador.");
      setIsSwitchingToInstaller(false);
    }
  }

  const isBusy = isSwitchingToInstaller || voiceState === "listening" || voiceState === "processing";
  const statusCopy = {
    idle: "Listo para recibir un comando por texto o activar el micro simulado.",
    listening: "Escuchando entrada de audio local para resolver intención.",
    processing: "Interpretando el comando y conectando con el sistema local.",
    error: "El último intento no se pudo interpretar o ejecutar.",
  } as const;

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#07090f] text-white selection:bg-white/20">
      <VideoBackground />

      {globalError ? (
        <div className="fixed left-1/2 top-6 z-50 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2">
          <div className="glass-panel flex items-start gap-4 border-danger/30 bg-danger/10 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white">Error del sistema</p>
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
              Iniciando Secuencia
            </p>
          </div>
        </div>
      ) : (
        <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-4xl flex-col items-center justify-center px-6 py-20 sm:py-32">
          
          <div className="w-full flex flex-col items-center gap-12 text-center">
            
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-white/60 backdrop-blur-md">
                <span className={`h-1.5 w-1.5 rounded-full ${voiceState === "error" ? "bg-danger" : voiceState === "idle" ? "bg-white/40" : "bg-accent"}`} />
                {preflight?.isLiveSession ? "Live Environment" : "System Core"}
              </div>
              
              <h1 className="font-display text-5xl font-medium tracking-tight text-white sm:text-7xl lg:text-8xl">
                AgenOS
              </h1>
              
              <p className="mx-auto max-w-lg text-base text-white/50 sm:text-lg">
                Interfaz de terminal inteligente.
              </p>
            </div>

            <div className="relative flex justify-center py-6">
              <button
                aria-label="Activar micro"
                className="group relative flex h-32 w-32 items-center justify-center rounded-full border border-white/10 bg-white/5 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[0.98] hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 sm:h-40 sm:w-40"
                disabled={isBusy}
                onClick={handleVoiceDemoStart}
                type="button"
              >
                <div className={`absolute inset-0 rounded-full border border-white/5 transition-transform duration-700 ${voiceState === "processing" ? "animate-spin-slow scale-[1.15] border-t-white/30" : "scale-100"}`} />
                <div className={`absolute inset-[-1px] rounded-full border border-white/10 transition-transform duration-1000 ${voiceState === "processing" ? "animate-spin-slow scale-105 border-b-accent/40" : "scale-100"}`} />
                
                <div className="flex items-center justify-center text-white/70 transition-colors group-hover:text-white">
                  {voiceState === "processing" ? (
                    <LoaderCircle className="h-8 w-8 animate-spin sm:h-10 sm:w-10" strokeWidth={1.5} />
                  ) : (
                    <Mic className="h-8 w-8 sm:h-10 sm:w-10" strokeWidth={1.5} />
                  )}
                </div>
              </button>
            </div>

            <div className="mt-8 grid w-full gap-4 text-left sm:grid-cols-2">
              <div className="glass-panel p-8 flex flex-col gap-6">
                <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-white/40">
                  <TerminalSquare className="h-4 w-4" />
                  <span>Consola Manual</span>
                </div>
                <div className="space-y-4">
                  <input
                    className="glass-input text-sm"
                    disabled={isBusy}
                    onChange={(event) => setCommandDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleSystemCommandSubmit();
                      }
                    }}
                    placeholder="ej. abre terminal"
                    value={commandDraft}
                  />
                  <button
                    className="btn-primary w-full"
                    disabled={isBusy || !commandDraft.trim()}
                    onClick={handleSystemCommandSubmit}
                    type="button"
                  >
                    Ejecutar orden
                  </button>
                </div>
              </div>

              <div className="glass-panel p-8 flex flex-col justify-between gap-6">
                <div className="space-y-4">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-white/40">Estado del Módulo</p>
                  <p className="text-sm leading-relaxed text-white/70">
                    {isSwitchingToInstaller ? "Iniciando secuencia de instalación..." : statusCopy[voiceState]}
                  </p>
                </div>
                
                {preflight?.isLiveSession && (
                  <button
                    className="btn-secondary group flex w-full items-center justify-center gap-2"
                    disabled={isSwitchingToInstaller}
                    onClick={() => void handleOpenInstaller()}
                    type="button"
                  >
                    <span>{isSwitchingToInstaller ? "Cargando" : "Abrir Instalador"}</span>
                    <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </button>
                )}
              </div>

              {(lastCommandOrigin || lastTranscript || lastResultMessage) && (
                <div className="glass-panel sm:col-span-2 p-8 text-left">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-white/40 mb-6">
                    Registro de Telemetría
                  </p>
                  <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-[10px] uppercase tracking-widest text-white/40">Origen</dt>
                      <dd className="mt-1.5 font-mono text-sm text-white/80">
                        {lastCommandOrigin === "voice" ? "Audio Local" : lastCommandOrigin === "text" ? "Consola" : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-widest text-white/40">Entrada</dt>
                      <dd className="mt-1.5 font-mono text-sm text-white/80 truncate">
                        {lastTranscript || "—"}
                      </dd>
                    </div>
                    <div className="lg:col-span-2">
                      <dt className="text-[10px] uppercase tracking-widest text-white/40">Intención Resuelta</dt>
                      <dd className="mt-1.5 font-mono text-sm text-white/80 truncate">
                        {lastIntentLabel || lastActionLabel || "—"}
                      </dd>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-4 pt-4 border-t border-white/5">
                      <dt className="text-[10px] uppercase tracking-widest text-white/40">Salida del Sistema</dt>
                      <dd className={`mt-2 text-sm leading-relaxed ${voiceState === "error" ? "text-danger" : "text-white/70"}`}>
                        {lastResultMessage || "—"}
                      </dd>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
