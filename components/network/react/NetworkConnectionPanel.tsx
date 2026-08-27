import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Eye,
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
  embedded?: boolean;
  allowDisconnect?: boolean;
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
      return "Sin conexión";
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
  embedded = false,
  allowDisconnect = false,
}: NetworkConnectionPanelProps) {
  const networkClient = useMemo(() => client ?? createNetworkClient(), [client]);
  const [status, setStatus] = useState<NetworkStatusResponse | null>(null);
  const [accessPoints, setAccessPoints] = useState<WifiAccessPoint[]>([]);
  const [target, setTarget] = useState<ConnectTarget | null>(null);
  const [password, setPassword] = useState("");
  const [revealPassword, setRevealPassword] = useState(false);
  const [hiddenSsid, setHiddenSsid] = useState("");
  const [hiddenMode, setHiddenMode] = useState(false);
  const [busy, setBusy] = useState<"status" | "scan" | "connect" | "radio" | null>("status");
  const [message, setMessage] = useState<string | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLFormElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const onOnlineRef = useRef(onOnline);

  useEffect(() => {
    onOnlineRef.current = onOnline;
  }, [onOnline]);

  const online = status?.overall === "online";
  const visibleAccessPoints = useMemo(() => {
    const strongest = new Map<string, WifiAccessPoint>();
    for (const accessPoint of accessPoints) {
      const key = `${accessPoint.ssid}\u0000${accessPoint.security}`;
      const current = strongest.get(key);
      if (!current || accessPoint.strength > current.strength) strongest.set(key, accessPoint);
    }
    return [...strongest.values()].sort((left, right) => {
      const leftActive = status?.activeConnection?.ssid === left.ssid ? 1 : 0;
      const rightActive = status?.activeConnection?.ssid === right.ssid ? 1 : 0;
      return leftActive === rightActive ? right.strength - left.strength : rightActive - leftActive;
    });
  }, [accessPoints, status?.activeConnection?.ssid]);
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
        onOnlineRef.current?.(nextStatus);
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
  }, [networkClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (busy !== null || target || hiddenMode) {
      return;
    }
    const interval = window.setInterval(() => {
      void refresh({ background: true });
    }, 5000);
    return () => window.clearInterval(interval);
  }, [busy, hiddenMode, refresh, target]);

  const closePasswordDialog = useCallback(() => {
    setTarget(null);
    setPassword("");
    setRevealPassword(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!target) {
      return;
    }
    passwordInputRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePasswordDialog();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
      );
      const first = focusable?.[0];
      const last = focusable?.[focusable.length - 1];
      if (!first || !last) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closePasswordDialog, target]);

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

  async function handleDisconnect() {
    setBusy("connect");
    setMessage(null);
    try {
      const response = await networkClient.disconnectWifi();
      setMessage(response.message ?? (response.ok ? "Wi-Fi desconectado." : "No se pudo desconectar el Wi-Fi."));
      await refresh({ scan: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo desconectar el Wi-Fi.");
    } finally {
      setBusy(null);
    }
  }

  async function connect(request: ConnectWifiRequest) {
    setBusy("connect");
    setMessage(null);
    try {
      const response = await networkClient.connectWifi(request);
      if (!response.ok) {
        setMessage(response.message ?? "No se pudo conectar a la red.");
        return;
      }
      setPassword("");
      setTarget(null);
      setRevealPassword(false);
      setMessage(response.message ?? "Conexión Wi-Fi lista.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo conectar a la red.");
    } finally {
      setBusy(null);
    }
  }

  function handleNetworkClick(accessPoint: WifiAccessPoint, trigger: HTMLButtonElement) {
    if (networkRequiresPassword(accessPoint)) {
      triggerRef.current = trigger;
      setTarget({ mode: "visible", accessPoint });
      setPassword("");
      setRevealPassword(false);
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
    triggerRef.current = event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]');
    setTarget({ mode: "hidden", ssid });
    setPassword("");
    setRevealPassword(false);
  }

  return (
    <section
      aria-label={embedded ? "Ajustes de Wi-Fi" : "Conexión a internet"}
      className={embedded
        ? "w-full text-white"
        : "relative z-50 flex min-h-[100dvh] w-full justify-center overflow-y-auto bg-[#07090f] px-4 py-8 text-white sm:px-6"}
    >
      <div className={embedded ? "grid w-full gap-5" : "m-auto grid w-full max-w-5xl gap-5 lg:grid-cols-[0.86fr_1.14fr]"}>
        <div className="rounded-lg border border-white/10 bg-black/45 p-6 shadow-2xl backdrop-blur-xl sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.12em] text-white/60">Wi-Fi</p>
              {embedded ? (
                <h2 className="mt-3 text-3xl font-semibold tracking-normal text-white">Conexiones</h2>
              ) : (
                <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white">Conéctate a internet</h1>
              )}
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

          <p className="mt-4 text-sm leading-6 text-white/75">{statusTitle(status)}. {statusDetail(status)}</p>

          {!embedded && !online ? <p className="mt-5 rounded-md border border-white/10 bg-white/5 p-3 text-sm text-white/65">Elige una red de la lista. También puedes seguir sin conexión y configurarla más tarde desde Sistema.</p> : null}

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
              disabled={busy !== null || status?.wirelessHardware === "hard-blocked" || status?.wirelessHardware === "missing"}
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
            {allowDisconnect && status?.activeConnection?.type === "wifi" ? (
              <button
                className="rounded-md border border-white/10 px-4 py-2.5 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                disabled={busy !== null}
                onClick={() => void handleDisconnect()}
                type="button"
              >
                Desconectar de {status.activeConnection.ssid ?? status.activeConnection.id}
              </button>
            ) : null}
          </div>

          {message && !target ? (
            <div className="mt-5 flex gap-3 rounded-md border border-amber-200/20 bg-amber-200/10 p-3 text-sm text-amber-100" role="status">
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

          <div className={embedded ? "max-h-80 overflow-y-auto pr-1" : "max-h-[28rem] overflow-y-auto pr-1"}>
            {visibleAccessPoints.length === 0 ? (
              <div className="grid min-h-48 place-items-center rounded-md border border-dashed border-white/10 text-center text-sm text-white/50">
                {busy ? "Buscando redes..." : "No se han detectado redes Wi-Fi."}
              </div>
            ) : (
              <div className="grid gap-2">
                {visibleAccessPoints.map((accessPoint) => {
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
                      aria-current={active ? "true" : undefined}
                      aria-label={`${accessPoint.ssid || "SSID oculto"}, señal ${signalLabel(accessPoint.strength)}${active ? ", conectada" : ""}`}
                      key={`${accessPoint.device}:${accessPoint.bssid}`}
                      onClick={(event) => handleNetworkClick(accessPoint, event.currentTarget)}
                      type="button"
                    >
                      <Wifi className="h-5 w-5 text-white/65" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-white">
                          {accessPoint.ssid || "SSID oculto"}
                        </span>
                        <span className="mt-1 block text-xs text-white/60">
                          {active ? "Conectada · " : ""}{signalLabel(accessPoint.strength)} · {accessPoint.security}
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
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/70 px-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePasswordDialog();
          }}
        >
          <form
            aria-describedby="wifi-password-help"
            aria-labelledby="wifi-password-title"
            aria-modal="true"
            className="w-full max-w-md rounded-lg border border-white/10 bg-[#10131b] p-5 shadow-2xl"
            onSubmit={handlePasswordSubmit}
            ref={dialogRef}
            role="dialog"
          >
            <h2 className="text-xl font-medium text-white" id="wifi-password-title">
              {target.mode === "visible" ? target.accessPoint.ssid : target.ssid}
            </h2>
            <p className="mt-1 text-sm text-white/60" id="wifi-password-help">
              Escribe la contraseña de esta red Wi-Fi.
            </p>
            <label className="mt-4 grid gap-2 text-sm text-white/70">
              Contraseña
              <span className="relative flex items-center">
                <input
                  aria-invalid={message ? true : undefined}
                  className="min-h-12 w-full rounded-md border border-white/10 bg-black/35 px-3 pr-12 text-white outline-none focus:border-white/35"
                  onChange={(event) => setPassword(event.target.value)}
                  ref={passwordInputRef}
                  type={revealPassword ? "text" : "password"}
                  value={password}
                />
                <button
                  aria-label={revealPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-pressed={revealPassword}
                  className="absolute right-1 grid h-10 w-10 place-items-center rounded-md text-white/60 hover:bg-white/10 hover:text-white"
                  onClick={() => setRevealPassword((current) => !current)}
                  type="button"
                >
                  {revealPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
            </label>
            {message ? <p className="mt-3 text-sm text-amber-200" role="alert">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-3">
              <button
                className="rounded-md px-4 py-2 text-sm text-white/65 transition-colors hover:bg-white/10 hover:text-white"
                onClick={closePasswordDialog}
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
