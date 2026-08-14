import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  EyeOff,
  LoaderCircle,
  Lock,
  RefreshCcw,
  Router,
  ShieldAlert,
  Wifi,
  WifiOff,
} from "lucide-react";

import { createNetworkClient, type NetworkClient } from "../client";
import {
  CAPTIVE_PORTAL_URL,
  type ConnectWifiRequest,
  type NetworkStatusResponse,
  type WifiAccessPoint,
} from "../types";

type NetworkConnectionPanelProps = {
  client?: NetworkClient;
  allowContinueOffline?: boolean;
  continueOfflineLabel?: string;
  onContinueOffline?: () => void;
  onOnline?: (status: NetworkStatusResponse) => void;
};

type ConnectTarget =
  | { mode: "visible"; accessPoint: WifiAccessPoint }
  | { mode: "hidden"; ssid: string };

function statusTitle(status: NetworkStatusResponse | null): string {
  if (!status) {
    return "Comprobando red";
  }

  switch (status.overall) {
    case "online":
      return "Internet disponible";
    case "portal":
      return "Portal cautivo pendiente";
    case "connecting":
      return "Conectando";
    case "unmanaged":
      return "Red no gestionada";
    case "error":
      return "No se pudo leer la red";
    default:
      return "Conectemos a internet";
  }
}

function statusDetail(status: NetworkStatusResponse | null): string {
  if (!status) {
    return "AgenOS está leyendo NetworkManager.";
  }

  if (status.activeConnection) {
    const name = status.activeConnection.ssid ?? status.activeConnection.id;
    return `${name} · ${status.internet.message ?? "Comprobando acceso externo."}`;
  }

  return status.internet.message ?? "Selecciona una red Wi-Fi o conecta Ethernet.";
}

function signalLabel(strength: number): string {
  if (strength >= 75) {
    return "Alta";
  }
  if (strength >= 45) {
    return "Media";
  }
  return "Baja";
}

function networkRequiresPassword(accessPoint: WifiAccessPoint): boolean {
  return accessPoint.security !== "open";
}

export function NetworkConnectionPanel({
  client,
  allowContinueOffline = false,
  continueOfflineLabel = "Continuar sin internet",
  onContinueOffline,
  onOnline,
}: NetworkConnectionPanelProps) {
  const networkClient = useMemo(() => client ?? createNetworkClient(), [client]);
  const [status, setStatus] = useState<NetworkStatusResponse | null>(null);
  const [accessPoints, setAccessPoints] = useState<WifiAccessPoint[]>([]);
  const [target, setTarget] = useState<ConnectTarget | null>(null);
  const [password, setPassword] = useState("");
  const [hiddenSsid, setHiddenSsid] = useState("");
  const [hiddenMode, setHiddenMode] = useState(false);
  const [busy, setBusy] = useState<"status" | "scan" | "connect" | "radio" | null>("status");
  const [message, setMessage] = useState<string | null>(null);

  const online = status?.overall === "online";
  const portalUrl = useMemo(() => {
    const configured = (globalThis as typeof globalThis & {
      __AGENOS_CAPTIVE_PORTAL_URL__?: unknown;
    }).__AGENOS_CAPTIVE_PORTAL_URL__;
    return typeof configured === "string" && configured.trim() ? configured : CAPTIVE_PORTAL_URL;
  }, []);

  const refresh = useCallback(async (options: { scan?: boolean; background?: boolean } = {}) => {
    if (!options.background) {
      setBusy(options.scan ? "scan" : "status");
      setMessage(null);
    }
    try {
      if (options.scan) {
        await networkClient.scanWifi();
      }
      const [nextStatus, networks] = await Promise.all([
        networkClient.getStatus(),
        networkClient.listAccessPoints().catch(() => ({ ok: true as const, accessPoints: [] })),
      ]);
      setStatus(nextStatus);
      setAccessPoints(networks.accessPoints);
      if (nextStatus.overall === "online") {
        onOnline?.(nextStatus);
      }
    } catch (error) {
      if (!options.background) {
        setMessage(error instanceof Error ? error.message : "No se pudo leer la red.");
      }
    } finally {
      if (!options.background) {
        setBusy(null);
      }
    }
  }, [networkClient, onOnline]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      void refresh({ background: true });
    }, 5000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  async function handleRadioToggle(enabled: boolean) {
    setBusy("radio");
    setMessage(null);
    try {
      const response = await networkClient.setWifiEnabled(enabled);
      setMessage(response.message ?? null);
      await refresh({ scan: enabled });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cambiar el estado del Wi-Fi.");
    } finally {
      setBusy(null);
    }
  }

  async function connect(request: ConnectWifiRequest) {
    setBusy("connect");
    setMessage(null);
    try {
      const response = await networkClient.connectWifi(request);
      setPassword("");
      setTarget(null);
      if (!response.ok) {
        setMessage(response.message ?? "No se pudo conectar a la red.");
        return;
      }
      setMessage(response.message ?? "Conexión Wi-Fi lista.");
      await refresh();
    } catch (error) {
      setPassword("");
      setTarget(null);
      setMessage(error instanceof Error ? error.message : "No se pudo conectar a la red.");
    } finally {
      setBusy(null);
    }
  }

  function handleNetworkClick(accessPoint: WifiAccessPoint) {
    if (networkRequiresPassword(accessPoint)) {
      setTarget({ mode: "visible", accessPoint });
      setPassword("");
      return;
    }

    void connect({
      ssid: accessPoint.ssid,
      bssid: accessPoint.bssid,
      device: accessPoint.device,
    });
  }

  function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) {
      return;
    }

    if (target.mode === "visible") {
      void connect({
        ssid: target.accessPoint.ssid,
        bssid: target.accessPoint.bssid,
        device: target.accessPoint.device,
        password,
      });
      return;
    }

    void connect({
      ssid: target.ssid,
      hidden: true,
      password,
    });
  }

  function handleHiddenSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ssid = hiddenSsid.trim();
    if (!ssid) {
      return;
    }
    setTarget({ mode: "hidden", ssid });
    setPassword("");
  }

  return (
    <section className="relative z-50 flex min-h-[100dvh] w-full items-center justify-center bg-[#07090f] px-4 py-8 text-white sm:px-6">
      <div className="grid w-full max-w-5xl gap-5 lg:grid-cols-[0.86fr_1.14fr]">
        <div className="rounded-lg border border-white/10 bg-black/45 p-6 shadow-2xl backdrop-blur-xl sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">
                Red
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white">
                {statusTitle(status)}
              </h1>
            </div>
            <div
              className={[
                "grid h-12 w-12 place-items-center rounded-lg border",
                online ? "border-emerald-300/30 bg-emerald-300/15 text-emerald-200" : "border-white/10 bg-white/5 text-white/65",
              ].join(" ")}
            >
              {online ? <Wifi className="h-6 w-6" /> : <WifiOff className="h-6 w-6" />}
            </div>
          </div>

          <p className="mt-4 text-sm leading-6 text-white/65">
            {statusDetail(status)}
          </p>

          <div className="mt-6 grid gap-3 text-sm">
            <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2">
              <span className="text-white/55">Codex</span>
              <span className="font-mono text-xs uppercase text-white/70">{status?.providers.codex ?? "unknown"}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2">
              <span className="text-white/55">Gemini</span>
              <span className="font-mono text-xs uppercase text-white/70">{status?.providers.gemini ?? "unknown"}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2">
              <span className="text-white/55">Wi-Fi</span>
              <span className="font-mono text-xs uppercase text-white/70">{status?.wirelessHardware ?? "unknown"}</span>
            </div>
          </div>

          {status?.internet.captivePortalSuspected ? (
            <button
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-white px-4 py-3 text-sm font-medium text-black transition-colors hover:bg-white/90"
              onClick={() => window.open(portalUrl, "_blank", "noopener")}
              type="button"
            >
              <Router className="h-4 w-4" />
              Abrir portal de acceso
            </button>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/10 px-4 py-2.5 text-sm text-white transition-colors hover:bg-white/15 disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => void refresh({ scan: true })}
              type="button"
            >
              {busy === "scan" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Actualizar redes
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/10 px-4 py-2.5 text-sm text-white transition-colors hover:bg-white/15 disabled:opacity-50"
              disabled={busy !== null || status?.wirelessHardware === "hard-blocked"}
              onClick={() => void handleRadioToggle(!(status?.wifiEnabled ?? false))}
              type="button"
            >
              {status?.wifiEnabled ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
              {status?.wifiEnabled ? "Desactivar Wi-Fi" : "Activar Wi-Fi"}
            </button>
            {allowContinueOffline ? (
              <button
                className="rounded-md border border-white/10 px-4 py-2.5 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                onClick={onContinueOffline}
                type="button"
              >
                {continueOfflineLabel}
              </button>
            ) : null}
          </div>

          {message ? (
            <div className="mt-5 flex gap-3 rounded-md border border-amber-200/20 bg-amber-200/10 p-3 text-sm text-amber-100">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{message}</p>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-white/10 bg-black/45 p-4 shadow-2xl backdrop-blur-xl sm:p-5">
          <div className="flex items-center justify-between gap-3 px-1 pb-3">
            <h2 className="text-lg font-medium text-white">Conexiones disponibles</h2>
            <button
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-white/65 transition-colors hover:bg-white/10 hover:text-white"
              onClick={() => setHiddenMode((current) => !current)}
              type="button"
            >
              <EyeOff className="h-4 w-4" />
              Red oculta
            </button>
          </div>

          {hiddenMode ? (
            <form className="mb-3 grid gap-3 rounded-md border border-white/10 bg-white/5 p-3" onSubmit={handleHiddenSubmit}>
              <label className="grid gap-2 text-sm text-white/70">
                Nombre de la red
                <input
                  className="rounded-md border border-white/10 bg-black/35 px-3 py-2 text-white outline-none focus:border-white/35"
                  onChange={(event) => setHiddenSsid(event.target.value)}
                  value={hiddenSsid}
                />
              </label>
              <button
                className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
                disabled={!hiddenSsid.trim()}
                type="submit"
              >
                Conectar red oculta
              </button>
            </form>
          ) : null}

          <div className="max-h-[28rem] overflow-y-auto pr-1">
            {accessPoints.length === 0 ? (
              <div className="grid min-h-48 place-items-center rounded-md border border-dashed border-white/10 text-center text-sm text-white/50">
                {busy ? "Buscando redes..." : "No se han detectado redes Wi-Fi."}
              </div>
            ) : (
              <div className="grid gap-2">
                {accessPoints.map((accessPoint) => {
                  const active = status?.activeConnection?.ssid === accessPoint.ssid;
                  return (
                    <button
                      className={[
                        "grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border px-3 py-3 text-left transition-colors disabled:opacity-50",
                        active
                          ? "border-emerald-300/30 bg-emerald-300/10"
                          : "border-white/10 bg-white/5 hover:bg-white/10",
                      ].join(" ")}
                      disabled={busy !== null || accessPoint.security === "enterprise"}
                      key={`${accessPoint.device}:${accessPoint.bssid}`}
                      onClick={() => handleNetworkClick(accessPoint)}
                      type="button"
                    >
                      <Wifi className="h-5 w-5 text-white/65" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-white">
                          {accessPoint.ssid || "SSID oculto"}
                        </span>
                        <span className="mt-1 block text-xs text-white/45">
                          {signalLabel(accessPoint.strength)} · {accessPoint.security}
                        </span>
                      </span>
                      {networkRequiresPassword(accessPoint) ? <Lock className="h-4 w-4 text-white/45" /> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {target ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-sm">
          <form
            className="w-full max-w-md rounded-lg border border-white/10 bg-[#10131b] p-5 shadow-2xl"
            onSubmit={handlePasswordSubmit}
          >
            <h2 className="text-xl font-medium text-white">
              {target.mode === "visible" ? target.accessPoint.ssid : target.ssid}
            </h2>
            <label className="mt-4 grid gap-2 text-sm text-white/70">
              Contraseña
              <input
                autoFocus
                className="rounded-md border border-white/10 bg-black/35 px-3 py-2 text-white outline-none focus:border-white/35"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </label>
            <div className="mt-5 flex justify-end gap-3">
              <button
                className="rounded-md px-4 py-2 text-sm text-white/65 transition-colors hover:bg-white/10 hover:text-white"
                onClick={() => {
                  setTarget(null);
                  setPassword("");
                }}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
                disabled={busy === "connect" || !password}
                type="submit"
              >
                {busy === "connect" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                Conectar
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
