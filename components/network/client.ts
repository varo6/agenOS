import type {
  AgenosNetworkBridge,
  ConnectWifiRequest,
  ConnectWifiResponse,
  NetworkActionResponse,
  NetworkStatusResponse,
  WifiAccessPointsResponse,
  WifiScanResponse,
} from "./types";

const NETWORK_API_BASE_DEFAULT = "http://127.0.0.1:4173";

type ErrorPayload = {
  message?: unknown;
};

export class NetworkClientError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function getBridge(): AgenosNetworkBridge | null {
  const candidate = (globalThis.window as Window & {
    agenosNetwork?: AgenosNetworkBridge;
  } | undefined)?.agenosNetwork;

  return candidate && typeof candidate.isAvailable === "function" ? candidate : null;
}

function isViteDevOrigin(location: Location): boolean {
  return (
    (location.hostname === "127.0.0.1" || location.hostname === "localhost")
    && location.port === "4174"
  );
}

function resolveHttpBase(): string {
  const location = globalThis.window?.location;
  if (location && (location.protocol === "http:" || location.protocol === "https:") && !isViteDevOrigin(location)) {
    return location.origin;
  }

  return NETWORK_API_BASE_DEFAULT;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, `${resolveHttpBase()}/`).toString(), init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) as T | ErrorPayload : undefined;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : `${response.status} ${response.statusText}`;
    throw new NetworkClientError(message, response.status);
  }

  return payload as T;
}

async function bridgeRequest<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof NetworkClientError) {
      throw error;
    }

    const status = error && typeof error === "object" && "status" in error && typeof error.status === "number"
      ? error.status
      : undefined;
    throw new NetworkClientError(error instanceof Error ? error.message : String(error), status);
  }
}

export function createNetworkClient() {
  const bridge = getBridge();
  if (bridge?.isAvailable()) {
    return {
      getStatus(): Promise<NetworkStatusResponse> {
        return bridgeRequest(() => bridge.getStatus());
      },
      scanWifi(): Promise<WifiScanResponse> {
        return bridgeRequest(() => bridge.scanWifi());
      },
      listAccessPoints(): Promise<WifiAccessPointsResponse> {
        return bridgeRequest(() => bridge.listAccessPoints());
      },
      connectWifi(request: ConnectWifiRequest): Promise<ConnectWifiResponse> {
        return bridgeRequest(() => bridge.connectWifi(request));
      },
      disconnectWifi(): Promise<NetworkActionResponse> {
        return bridgeRequest(() => bridge.disconnectWifi());
      },
      setWifiEnabled(enabled: boolean): Promise<NetworkActionResponse> {
        return bridgeRequest(() => bridge.setWifiEnabled(enabled));
      },
    };
  }

  return {
    getStatus(): Promise<NetworkStatusResponse> {
      return requestJson<NetworkStatusResponse>("/api/network/status");
    },
    scanWifi(): Promise<WifiScanResponse> {
      return requestJson<WifiScanResponse>("/api/network/wifi/scan", { method: "POST" });
    },
    listAccessPoints(): Promise<WifiAccessPointsResponse> {
      return requestJson<WifiAccessPointsResponse>("/api/network/wifi/access-points");
    },
    connectWifi(request: ConnectWifiRequest): Promise<ConnectWifiResponse> {
      return requestJson<ConnectWifiResponse>("/api/network/wifi/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
    },
    disconnectWifi(): Promise<NetworkActionResponse> {
      return requestJson<NetworkActionResponse>("/api/network/wifi/disconnect", { method: "POST" });
    },
    setWifiEnabled(enabled: boolean): Promise<NetworkActionResponse> {
      return requestJson<NetworkActionResponse>("/api/network/wifi/radio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
    },
  };
}

export type NetworkClient = ReturnType<typeof createNetworkClient>;
