export type NetworkOverall = "online" | "portal" | "connecting" | "offline" | "unmanaged" | "error";

export type WirelessHardwareState = "available" | "soft-blocked" | "hard-blocked" | "missing" | "unknown";

export type ProviderReachability = "reachable" | "blocked" | "unknown";

export type WifiSecurity = "open" | "wpa" | "wpa2" | "wpa3" | "enterprise" | "unknown";

export type ActiveNetworkConnection = {
  id: string;
  type: "wifi" | "ethernet" | "other";
  ssid?: string;
  strength?: number;
};

export type NetworkStatusResponse = {
  ok: true;
  overall: NetworkOverall;
  checkedAt: string;
  wifiEnabled: boolean;
  wirelessHardware: WirelessHardwareState;
  activeConnection?: ActiveNetworkConnection;
  internet: {
    ok: boolean;
    captivePortalSuspected: boolean;
    message?: string;
  };
  providers: {
    codex: ProviderReachability;
    gemini: ProviderReachability;
  };
};

export type WifiAccessPoint = {
  ssid: string;
  bssid: string;
  strength: number;
  security: WifiSecurity;
  frequencyMHz?: number;
  device: string;
};

export type ConnectWifiRequest = {
  ssid: string;
  bssid?: string;
  password?: string;
  hidden?: boolean;
  device?: string;
};

export type ConnectWifiResponse = {
  ok: boolean;
  status: "connected" | "connecting" | "failed";
  message?: string;
};

export type WifiAccessPointsResponse = {
  ok: true;
  accessPoints: WifiAccessPoint[];
};

export type WifiScanResponse = {
  ok: true;
  message?: string;
};

export type WifiRadioRequest = {
  enabled: boolean;
};

export type NetworkActionResponse = {
  ok: boolean;
  message?: string;
};

export type AgenosNetworkBridge = {
  getStatus(): Promise<NetworkStatusResponse>;
  scanWifi(): Promise<WifiScanResponse>;
  listAccessPoints(): Promise<WifiAccessPointsResponse>;
  connectWifi(request: ConnectWifiRequest): Promise<ConnectWifiResponse>;
  disconnectWifi(): Promise<NetworkActionResponse>;
  setWifiEnabled(enabled: boolean): Promise<NetworkActionResponse>;
  isAvailable(): boolean;
};

export const NETWORK_IPC_CHANNELS = {
  getStatus: "agenos-network:get-status",
  scanWifi: "agenos-network:scan",
  listAccessPoints: "agenos-network:list-access-points",
  connectWifi: "agenos-network:connect-wifi",
  disconnectWifi: "agenos-network:disconnect",
  setWifiEnabled: "agenos-network:set-wifi-enabled",
} as const;

export const CAPTIVE_PORTAL_URL =
  "http://connectivitycheck.gstatic.com/generate_204";
