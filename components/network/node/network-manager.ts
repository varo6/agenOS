import type {
  ConnectWifiRequest,
  ConnectWifiResponse,
  NetworkActionResponse,
  NetworkOverall,
  NetworkStatusResponse,
  ProviderReachability,
  WifiAccessPoint,
  WifiAccessPointsResponse,
  WifiScanResponse,
  WifiSecurity,
  WirelessHardwareState,
} from "../types";

const NM_BUS = "org.freedesktop.NetworkManager";
const NM_PATH = "/org/freedesktop/NetworkManager";
const NM_IFACE = "org.freedesktop.NetworkManager";
const DBUS_PROPS_IFACE = "org.freedesktop.DBus.Properties";
const DEVICE_IFACE = "org.freedesktop.NetworkManager.Device";
const WIRELESS_IFACE = "org.freedesktop.NetworkManager.Device.Wireless";
const AP_IFACE = "org.freedesktop.NetworkManager.AccessPoint";
const ACTIVE_CONNECTION_IFACE = "org.freedesktop.NetworkManager.Connection.Active";

const NM_CONNECTIVITY_NONE = 1;
const NM_CONNECTIVITY_PORTAL = 2;
const NM_CONNECTIVITY_FULL = 4;
const NM_STATE_CONNECTING = 40;
const NM_STATE_CONNECTED_LOCAL = 50;
const NM_STATE_CONNECTED_SITE = 60;
const NM_STATE_CONNECTED_GLOBAL = 70;
const NM_DEVICE_TYPE_ETHERNET = 1;
const NM_DEVICE_TYPE_WIFI = 2;
const NM_DEVICE_STATE_ACTIVATED = 100;

const EMPTY_OBJECT_PATH = "/";

type DbusVariant = {
  signature?: string;
  value: unknown;
};

type ProxyObject = {
  getInterface(name: string): any;
};

type BusLike = {
  getProxyObject(busName: string, objectPath: string): Promise<ProxyObject>;
  disconnect?: () => void;
};

export type NetworkManagerDependencies = {
  createBus: () => Promise<BusLike>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  checkProvider: (url: string, timeoutMs: number) => Promise<ProviderReachability>;
  connectivityCheckUrl: string;
  codexCheckUrl: string;
  geminiCheckUrl: string;
  connectTimeoutMs: number;
};

type DeviceSummary = {
  path: string;
  type: number;
  state: number;
  managed: boolean;
  interfaceName: string;
};

type ActiveConnectionSummary = {
  path: string;
  id: string;
  type: "wifi" | "ethernet" | "other";
  devices: string[];
};

type NormalizedAp = WifiAccessPoint & {
  path: string;
};

function variantValue<T = unknown>(value: unknown): T {
  if (value && typeof value === "object" && "value" in value) {
    return (value as DbusVariant).value as T;
  }

  return value as T;
}

function numberValue(value: unknown, fallback = 0): number {
  const raw = variantValue(value);
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : fallback;
  }

  if (typeof raw === "bigint") {
    return Number(raw);
  }

  return fallback;
}

function booleanValue(value: unknown, fallback = false): boolean {
  const raw = variantValue(value);
  return typeof raw === "boolean" ? raw : fallback;
}

function stringValue(value: unknown, fallback = ""): string {
  const raw = variantValue(value);
  return typeof raw === "string" ? raw : fallback;
}

function objectPathsValue(value: unknown): string[] {
  const raw = variantValue(value);
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
}

function byteArrayValue(value: unknown): number[] {
  const raw = variantValue(value);
  if (raw instanceof Uint8Array || Buffer.isBuffer(raw)) {
    return Array.from(raw);
  }

  if (Array.isArray(raw)) {
    return raw.map((entry) => typeof entry === "number" ? entry : Number(entry)).filter(Number.isFinite);
  }

  return [];
}

function ssidFromBytes(value: unknown): string {
  const bytes = byteArrayValue(value);
  if (bytes.length === 0) {
    return "";
  }

  return Buffer.from(bytes).toString("utf8").replace(/\0/g, "").trim();
}

function bssidBytes(value: string): number[] | undefined {
  const parts = value.split(":");
  if (parts.length !== 6) {
    return undefined;
  }

  const bytes = parts.map((part) => Number.parseInt(part, 16));
  return bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255) ? bytes : undefined;
}

function ssidBytes(value: string): number[] {
  return Array.from(Buffer.from(value, "utf8"));
}

export function securityFromFlags(flags: {
  flags?: number;
  wpaFlags?: number;
  rsnFlags?: number;
}): WifiSecurity {
  const wpaFlags = flags.wpaFlags ?? 0;
  const rsnFlags = flags.rsnFlags ?? 0;
  const combined = wpaFlags | rsnFlags;

  if (combined === 0) {
    return "open";
  }

  // NetworkManager's access point flag bit 0x200 denotes 802.1X/key management.
  if ((combined & 0x200) !== 0) {
    return "enterprise";
  }

  // SAE is how WPA3-Personal is represented.
  if ((combined & 0x400) !== 0) {
    return "wpa3";
  }

  if (rsnFlags !== 0) {
    return "wpa2";
  }

  if (wpaFlags !== 0) {
    return "wpa";
  }

  return "unknown";
}

export function normalizeAccessPoints(accessPoints: NormalizedAp[]): WifiAccessPoint[] {
  const byBssid = new Map<string, NormalizedAp>();

  for (const accessPoint of accessPoints) {
    const existing = byBssid.get(accessPoint.bssid);
    if (!existing || accessPoint.strength > existing.strength) {
      byBssid.set(accessPoint.bssid, accessPoint);
    }
  }

  return [...byBssid.values()]
    .sort((left, right) => right.strength - left.strength)
    .map(({ path: _path, ...accessPoint }) => accessPoint);
}

export function overallFromNetworkState(input: {
  state: number;
  connectivity: number;
  hasManagedDevice: boolean;
  hardware: WirelessHardwareState;
}): NetworkOverall {
  if (!input.hasManagedDevice && input.hardware === "missing") {
    return "unmanaged";
  }

  if (input.state === NM_STATE_CONNECTING) {
    return "connecting";
  }

  if (input.connectivity === NM_CONNECTIVITY_PORTAL) {
    return "portal";
  }

  if (input.connectivity === NM_CONNECTIVITY_FULL || input.state === NM_STATE_CONNECTED_GLOBAL) {
    return "online";
  }

  if (input.state === NM_STATE_CONNECTED_SITE || input.state === NM_STATE_CONNECTED_LOCAL) {
    return "portal";
  }

  return "offline";
}

export function sanitizeNetworkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/NoReply|timed out|timeout/i.test(message)) {
    return "La conexión ha agotado el tiempo de espera.";
  }
  if (/not authorized|permission|denied|rejected/i.test(message)) {
    return "NetworkManager no autorizó la operación de red.";
  }
  if (/Secrets were required|no secrets|802-11-wireless-security|psk/i.test(message)) {
    return "La contraseña de la red no es válida o falta.";
  }
  if (/not found|unknown object|does not exist/i.test(message)) {
    return "No se encontró la red solicitada.";
  }
  if (/rfkill|disabled|unavailable/i.test(message)) {
    return "El Wi-Fi está desactivado o bloqueado por hardware.";
  }

  return "No se pudo completar la operación de red.";
}

async function defaultCreateBus(): Promise<BusLike> {
  const dbus = await import("dbus-next");
  return dbus.systemBus() as BusLike;
}

async function defaultCheckProvider(url: string, timeoutMs: number): Promise<ProviderReachability> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    return response.ok || response.status < 500 ? "reachable" : "blocked";
  } catch {
    return "blocked";
  } finally {
    clearTimeout(timeout);
  }
}

async function getProperties(proxy: ProxyObject, ifaceName: string): Promise<Record<string, DbusVariant>> {
  const props = proxy.getInterface(DBUS_PROPS_IFACE);
  return await props.GetAll(ifaceName) as Record<string, DbusVariant>;
}

async function getProperty<T = unknown>(proxy: ProxyObject, ifaceName: string, property: string): Promise<T> {
  const props = proxy.getInterface(DBUS_PROPS_IFACE);
  return variantValue<T>(await props.Get(ifaceName, property));
}

async function setProperty(proxy: ProxyObject, ifaceName: string, property: string, signature: string, value: unknown): Promise<void> {
  const dbus = await import("dbus-next");
  const props = proxy.getInterface(DBUS_PROPS_IFACE);
  await props.Set(ifaceName, property, new dbus.Variant(signature, value));
}

function connectionTypeFromNm(type: string): "wifi" | "ethernet" | "other" {
  if (type === "802-11-wireless" || type === "wifi") {
    return "wifi";
  }
  if (type === "802-3-ethernet" || type === "ethernet") {
    return "ethernet";
  }
  return "other";
}

export function createNetworkManagerService(dependencies: Partial<NetworkManagerDependencies> = {}) {
  const deps: NetworkManagerDependencies = {
    createBus: dependencies.createBus ?? defaultCreateBus,
    now: dependencies.now ?? (() => new Date()),
    sleep: dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    checkProvider: dependencies.checkProvider ?? defaultCheckProvider,
    connectivityCheckUrl: dependencies.connectivityCheckUrl ?? "http://connectivitycheck.gstatic.com/generate_204",
    codexCheckUrl: dependencies.codexCheckUrl ?? "https://chatgpt.com/",
    geminiCheckUrl: dependencies.geminiCheckUrl ?? "https://generativelanguage.googleapis.com/",
    connectTimeoutMs: dependencies.connectTimeoutMs ?? 45_000,
  };

  async function withBus<T>(operation: (bus: BusLike, nmProxy: ProxyObject, nm: any) => Promise<T>): Promise<T> {
    const bus = await deps.createBus();
    try {
      const nmProxy = await bus.getProxyObject(NM_BUS, NM_PATH);
      const nm = nmProxy.getInterface(NM_IFACE);
      return await operation(bus, nmProxy, nm);
    } finally {
      bus.disconnect?.();
    }
  }

  async function readDevices(bus: BusLike, nm: any): Promise<DeviceSummary[]> {
    const paths = await nm.GetDevices() as string[];
    const devices: DeviceSummary[] = [];
    for (const path of paths) {
      const proxy = await bus.getProxyObject(NM_BUS, path);
      const props = await getProperties(proxy, DEVICE_IFACE);
      devices.push({
        path,
        type: numberValue(props.DeviceType),
        state: numberValue(props.State),
        managed: booleanValue(props.Managed, true),
        interfaceName: stringValue(props.Interface),
      });
    }

    return devices;
  }

  async function readActiveConnections(bus: BusLike, nmProxy: ProxyObject): Promise<ActiveConnectionSummary[]> {
    const activePaths = objectPathsValue(await getProperty(nmProxy, NM_IFACE, "ActiveConnections"));
    const active: ActiveConnectionSummary[] = [];
    for (const path of activePaths) {
      if (path === EMPTY_OBJECT_PATH) {
        continue;
      }
      const proxy = await bus.getProxyObject(NM_BUS, path);
      const props = await getProperties(proxy, ACTIVE_CONNECTION_IFACE);
      active.push({
        path,
        id: stringValue(props.Id),
        type: connectionTypeFromNm(stringValue(props.Type)),
        devices: objectPathsValue(props.Devices),
      });
    }
    return active;
  }

  async function readAp(bus: BusLike, path: string, devicePath: string): Promise<NormalizedAp | null> {
    if (path === EMPTY_OBJECT_PATH) {
      return null;
    }

    const proxy = await bus.getProxyObject(NM_BUS, path);
    const props = await getProperties(proxy, AP_IFACE);
    const ssid = ssidFromBytes(props.Ssid);
    const bssid = stringValue(props.HwAddress);
    if (!bssid) {
      return null;
    }

    return {
      path,
      ssid,
      bssid,
      strength: Math.max(0, Math.min(100, numberValue(props.Strength))),
      security: securityFromFlags({
        flags: numberValue(props.Flags),
        wpaFlags: numberValue(props.WpaFlags),
        rsnFlags: numberValue(props.RsnFlags),
      }),
      frequencyMHz: numberValue(props.Frequency) || undefined,
      device: devicePath,
    };
  }

  async function readAccessPointsForDevice(bus: BusLike, devicePath: string): Promise<NormalizedAp[]> {
    const proxy = await bus.getProxyObject(NM_BUS, devicePath);
    const wireless = proxy.getInterface(WIRELESS_IFACE);
    const paths = await wireless.GetAccessPoints() as string[];
    const accessPoints = await Promise.all(paths.map((path) => readAp(bus, path, devicePath)));
    return accessPoints.filter((accessPoint): accessPoint is NormalizedAp => accessPoint !== null);
  }

  async function scanWifi(): Promise<WifiScanResponse> {
    return await withBus(async (bus, _nmProxy, nm) => {
      const devices = await readDevices(bus, nm);
      const wifiDevices = devices.filter((device) => device.type === NM_DEVICE_TYPE_WIFI);
      if (wifiDevices.length === 0) {
        return { ok: true, message: "No se detectó hardware Wi-Fi." };
      }

      await Promise.all(wifiDevices.map(async (device) => {
        const proxy = await bus.getProxyObject(NM_BUS, device.path);
        const wireless = proxy.getInterface(WIRELESS_IFACE);
        await wireless.RequestScan({});
      }));

      return { ok: true, message: "Búsqueda Wi-Fi iniciada." };
    });
  }

  async function listAccessPoints(): Promise<WifiAccessPointsResponse> {
    return await withBus(async (bus, _nmProxy, nm) => {
      const devices = await readDevices(bus, nm);
      const wifiDevices = devices.filter((device) => device.type === NM_DEVICE_TYPE_WIFI);
      const accessPoints = (await Promise.all(wifiDevices.map((device) => readAccessPointsForDevice(bus, device.path)))).flat();
      return { ok: true, accessPoints: normalizeAccessPoints(accessPoints) };
    });
  }

  async function resolveActiveConnection(bus: BusLike, nmProxy: ProxyObject, active: ActiveConnectionSummary[], devices: DeviceSummary[]): Promise<NetworkStatusResponse["activeConnection"]> {
    const activated = devices.find((device) => device.state === NM_DEVICE_STATE_ACTIVATED);
    if (!activated) {
      return undefined;
    }

    const activeConnection = active.find((connection) => connection.devices.includes(activated.path));
    if (!activeConnection) {
      return undefined;
    }

    if (activeConnection.type !== "wifi") {
      return {
        id: activeConnection.id,
        type: activeConnection.type,
      };
    }

    try {
      const deviceProxy = await bus.getProxyObject(NM_BUS, activated.path);
      const activeApPath = stringValue(await getProperty(deviceProxy, WIRELESS_IFACE, "ActiveAccessPoint"));
      const activeAp = await readAp(bus, activeApPath, activated.path);
      return {
        id: activeConnection.id,
        type: "wifi",
        ssid: activeAp?.ssid,
        strength: activeAp?.strength,
      };
    } catch {
      return {
        id: activeConnection.id,
        type: "wifi",
      };
    }
  }

  async function getStatus(): Promise<NetworkStatusResponse> {
    try {
      return await withBus(async (bus, nmProxy, nm) => {
        const devices = await readDevices(bus, nm);
        const wifiDevices = devices.filter((device) => device.type === NM_DEVICE_TYPE_WIFI);
        const hasManagedDevice = devices.some((device) => device.managed);
        const wifiEnabled = booleanValue(await getProperty(nmProxy, NM_IFACE, "WirelessEnabled"));
        const wirelessHardwareEnabled = booleanValue(await getProperty(nmProxy, NM_IFACE, "WirelessHardwareEnabled"), true);
        const state = numberValue(await getProperty(nmProxy, NM_IFACE, "State"));
        const connectivity = numberValue(await getProperty(nmProxy, NM_IFACE, "Connectivity"), NM_CONNECTIVITY_NONE);
        const activeConnections = await readActiveConnections(bus, nmProxy);
        const wirelessHardware: WirelessHardwareState = wifiDevices.length === 0
          ? "missing"
          : !wirelessHardwareEnabled
            ? "hard-blocked"
            : !wifiEnabled
              ? "soft-blocked"
              : "available";
        const overall = overallFromNetworkState({ state, connectivity, hasManagedDevice, hardware: wirelessHardware });
        const [codex, gemini] = overall === "online"
          ? await Promise.all([
              deps.checkProvider(deps.codexCheckUrl, 2500),
              deps.checkProvider(deps.geminiCheckUrl, 2500),
            ])
          : ["unknown", "unknown"] as const;

        return {
          ok: true,
          overall,
          checkedAt: deps.now().toISOString(),
          wifiEnabled,
          wirelessHardware,
          activeConnection: await resolveActiveConnection(bus, nmProxy, activeConnections, devices),
          internet: {
            ok: overall === "online",
            captivePortalSuspected: overall === "portal" || connectivity === NM_CONNECTIVITY_PORTAL,
            message: overall === "online"
              ? "Internet disponible."
              : overall === "portal"
                ? "Puede haber un portal cautivo pendiente."
                : "Sin conexión a internet.",
          },
          providers: { codex, gemini },
        };
      });
    } catch (error) {
      return {
        ok: true,
        overall: "error",
        checkedAt: deps.now().toISOString(),
        wifiEnabled: false,
        wirelessHardware: "unknown",
        internet: {
          ok: false,
          captivePortalSuspected: false,
          message: sanitizeNetworkError(error),
        },
        providers: { codex: "unknown", gemini: "unknown" },
      };
    }
  }

  async function findTargetAccessPoint(bus: BusLike, nm: any, request: ConnectWifiRequest): Promise<NormalizedAp | null> {
    const devices = await readDevices(bus, nm);
    const wifiDevices = devices.filter((device) =>
      device.type === NM_DEVICE_TYPE_WIFI && (!request.device || request.device === device.path || request.device === device.interfaceName)
    );
    const accessPoints = (await Promise.all(wifiDevices.map((device) => readAccessPointsForDevice(bus, device.path)))).flat();
    return accessPoints
      .filter((accessPoint) =>
        accessPoint.ssid === request.ssid
        && (!request.bssid || accessPoint.bssid.toLowerCase() === request.bssid.toLowerCase())
      )
      .sort((left, right) => right.strength - left.strength)[0] ?? null;
  }

  async function waitForActivation(bus: BusLike, activePath: string): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < deps.connectTimeoutMs) {
      const proxy = await bus.getProxyObject(NM_BUS, activePath);
      const state = numberValue(await getProperty(proxy, ACTIVE_CONNECTION_IFACE, "State"));
      // NM_ACTIVE_CONNECTION_STATE_ACTIVATED
      if (state === 2) {
        return true;
      }
      // NM_ACTIVE_CONNECTION_STATE_DEACTIVATED
      if (state === 4) {
        return false;
      }
      await deps.sleep(500);
    }
    return false;
  }

  async function connectWifi(request: ConnectWifiRequest): Promise<ConnectWifiResponse> {
    const ssid = request.ssid.trim();
    if (!ssid) {
      return { ok: false, status: "failed", message: "El nombre de la red es obligatorio." };
    }

    return await withBus(async (bus, nmProxy, nm) => {
      const wifiEnabled = booleanValue(await getProperty(nmProxy, NM_IFACE, "WirelessEnabled"));
      const wirelessHardwareEnabled = booleanValue(await getProperty(nmProxy, NM_IFACE, "WirelessHardwareEnabled"), true);
      if (!wirelessHardwareEnabled || !wifiEnabled) {
        return { ok: false, status: "failed", message: "El Wi-Fi está desactivado o bloqueado por hardware." };
      }

      const devices = await readDevices(bus, nm);
      const fallbackWifiDevice = devices.find((device) =>
        device.type === NM_DEVICE_TYPE_WIFI && device.managed && (!request.device || request.device === device.path || request.device === device.interfaceName)
      );
      if (!fallbackWifiDevice) {
        return { ok: false, status: "failed", message: "No se detectó hardware Wi-Fi gestionado." };
      }

      const target = request.hidden ? null : await findTargetAccessPoint(bus, nm, request);
      if (!request.hidden && !target) {
        return { ok: false, status: "failed", message: "No se encontró la red solicitada." };
      }
      if (target?.security === "enterprise") {
        return { ok: false, status: "failed", message: "Las redes WPA-Enterprise no están soportadas en esta versión." };
      }

      const dbus = await import("dbus-next");
      const connection: Record<string, Record<string, unknown>> = {
        connection: {
          id: new dbus.Variant("s", ssid),
          type: new dbus.Variant("s", "802-11-wireless"),
          autoconnect: new dbus.Variant("b", true),
        },
        "802-11-wireless": {
          ssid: new dbus.Variant("ay", ssidBytes(ssid)),
          mode: new dbus.Variant("s", "infrastructure"),
          hidden: new dbus.Variant("b", request.hidden === true),
        },
        ipv4: { method: new dbus.Variant("s", "auto") },
        ipv6: { method: new dbus.Variant("s", "auto") },
      };

      const password = request.password ?? "";
      if ((target?.security && target.security !== "open") || password) {
        if (!password) {
          return { ok: false, status: "failed", message: "La contraseña de la red es obligatoria." };
        }
        connection["802-11-wireless-security"] = {
          "key-mgmt": new dbus.Variant("s", "wpa-psk"),
          psk: new dbus.Variant("s", password),
        };
      }

      const bssid = target?.bssid ?? request.bssid;
      const bssidValue = bssid ? bssidBytes(bssid) : undefined;
      if (bssidValue) {
        connection["802-11-wireless"]!.bssid = new dbus.Variant("ay", bssidValue);
      }

      const devicePath = target?.device ?? fallbackWifiDevice.path;
      const apPath = target?.path ?? EMPTY_OBJECT_PATH;

      try {
        const result = await nm.AddAndActivateConnection(connection, devicePath, apPath) as [string, string];
        const activePath = result[1];
        const connected = await waitForActivation(bus, activePath);
        return connected
          ? { ok: true, status: "connected", message: "Conexión Wi-Fi lista." }
          : { ok: false, status: "failed", message: "No se pudo activar la conexión Wi-Fi." };
      } catch (error) {
        return { ok: false, status: "failed", message: sanitizeNetworkError(error) };
      }
    });
  }

  async function disconnectWifi(): Promise<NetworkActionResponse> {
    return await withBus(async (bus, nmProxy, nm) => {
      const devices = await readDevices(bus, nm);
      const activeConnections = await readActiveConnections(bus, nmProxy);
      const activeWifiDevice = devices.find((device) => device.type === NM_DEVICE_TYPE_WIFI && device.state === NM_DEVICE_STATE_ACTIVATED);
      const active = activeWifiDevice
        ? activeConnections.find((connection) => connection.devices.includes(activeWifiDevice.path))
        : undefined;

      if (!active) {
        return { ok: true, message: "No hay conexión Wi-Fi activa." };
      }

      try {
        await nm.DeactivateConnection(active.path);
        return { ok: true, message: "Wi-Fi desconectado." };
      } catch {
        if (activeWifiDevice) {
          const proxy = await bus.getProxyObject(NM_BUS, activeWifiDevice.path);
          const device = proxy.getInterface(DEVICE_IFACE);
          await device.Disconnect();
        }
        return { ok: true, message: "Wi-Fi desconectado." };
      }
    });
  }

  async function setWifiEnabled(enabled: boolean): Promise<NetworkActionResponse> {
    return await withBus(async (_bus, nmProxy) => {
      try {
        await setProperty(nmProxy, NM_IFACE, "WirelessEnabled", "b", enabled);
        return { ok: true, message: enabled ? "Wi-Fi activado." : "Wi-Fi desactivado." };
      } catch (error) {
        return { ok: false, message: sanitizeNetworkError(error) };
      }
    });
  }

  return {
    getStatus,
    scanWifi,
    listAccessPoints,
    connectWifi,
    disconnectWifi,
    setWifiEnabled,
  };
}

export type NetworkManagerService = ReturnType<typeof createNetworkManagerService>;
