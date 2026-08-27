import { describe, expect, test } from "bun:test";

import {
  createNetworkManagerService,
  normalizeAccessPoints,
  overallFromNetworkState,
  overallWithReachability,
  sanitizeNetworkError,
  securityFromFlags,
} from "../../../network/node/network-manager";

function variant(value: unknown) {
  return { value };
}

describe("network-manager model helpers", () => {
  test("classifies open, WPA2, WPA3 and enterprise access points", () => {
    expect(securityFromFlags({ wpaFlags: 0, rsnFlags: 0 })).toBe("open");
    expect(securityFromFlags({ wpaFlags: 0, rsnFlags: 0x100 })).toBe("wpa2");
    expect(securityFromFlags({ wpaFlags: 0, rsnFlags: 0x400 })).toBe("wpa3");
    expect(securityFromFlags({ wpaFlags: 0, rsnFlags: 0x200 })).toBe("enterprise");
  });

  test("deduplicates access points by BSSID and keeps the strongest sample", () => {
    const accessPoints = normalizeAccessPoints([
      {
        path: "/ap/old",
        ssid: "AgenOS",
        bssid: "00:11:22:33:44:55",
        strength: 25,
        security: "open",
        device: "/dev/wlan0",
      },
      {
        path: "/ap/new",
        ssid: "AgenOS",
        bssid: "00:11:22:33:44:55",
        strength: 82,
        security: "open",
        device: "/dev/wlan0",
      },
    ]);

    expect(accessPoints).toHaveLength(1);
    expect(accessPoints[0]?.strength).toBe(82);
  });

  test("maps NetworkManager connectivity into user-facing overall states", () => {
    expect(overallFromNetworkState({
      state: 70,
      connectivity: 4,
      hasManagedDevice: true,
      hardware: "available",
    })).toBe("online");
    expect(overallFromNetworkState({
      state: 50,
      connectivity: 2,
      hasManagedDevice: true,
      hardware: "available",
    })).toBe("portal");
    expect(overallFromNetworkState({
      state: 20,
      connectivity: 1,
      hasManagedDevice: false,
      hardware: "missing",
    })).toBe("unmanaged");
  });

  test("accepts a direct internet check for Ethernet when NetworkManager is stuck on local", () => {
    const ethernetReportedByNetworkManager = overallFromNetworkState({
      state: 50,
      connectivity: 1,
      hasManagedDevice: true,
      hardware: "missing",
    });

    expect(overallWithReachability({
      networkManagerOverall: ethernetReportedByNetworkManager,
      connectivity: "reachable",
      codex: "reachable",
      gemini: "reachable",
    })).toBe("online");

    expect(overallWithReachability({
      networkManagerOverall: "portal",
      connectivity: "blocked",
      codex: "blocked",
      gemini: "blocked",
    })).toBe("portal");
  });

  test("sanitizes low-level errors without exposing secrets", () => {
    expect(sanitizeNetworkError(new Error("Secrets were required for psk hunter2"))).toBe("La contraseña de la red no es válida o falta.");
  });
});

describe("network-manager connectWifi", () => {
  test("returns a sanitized response and never echoes the Wi-Fi password", async () => {
    let capturedConnection: unknown;
    const service = createNetworkManagerService({
      connectTimeoutMs: 10,
      sleep: async () => {},
      createBus: async () => ({
        disconnect: () => {},
        async getProxyObject(_busName: string, objectPath: string) {
          if (objectPath === "/org/freedesktop/NetworkManager") {
            return {
              getInterface(name: string) {
                if (name === "org.freedesktop.NetworkManager") {
                  return {
                    GetDevices: async () => ["/dev/wlan0"],
                    AddAndActivateConnection: async (connection: unknown) => {
                      capturedConnection = connection;
                      return ["/settings/1", "/active/1"];
                    },
                  };
                }
                return {
                  Get: async (_iface: string, property: string) => {
                    if (property === "WirelessEnabled" || property === "WirelessHardwareEnabled") {
                      return variant(true);
                    }
                    return variant(0);
                  },
                  GetAll: async () => ({}),
                };
              },
            };
          }

          if (objectPath === "/dev/wlan0") {
            return {
              getInterface(name: string) {
                if (name === "org.freedesktop.NetworkManager.Device.Wireless") {
                  return { GetAccessPoints: async () => ["/ap/1"] };
                }
                return {
                  GetAll: async (iface: string) => iface === "org.freedesktop.NetworkManager.Device"
                    ? {
                        DeviceType: variant(2),
                        State: variant(30),
                        Managed: variant(true),
                        Interface: variant("wlan0"),
                      }
                    : {},
                };
              },
            };
          }

          if (objectPath === "/ap/1") {
            return {
              getInterface() {
                return {
                  GetAll: async () => ({
                    Ssid: variant(Array.from(Buffer.from("AgenOS"))),
                    HwAddress: variant("00:11:22:33:44:55"),
                    Strength: variant(80),
                    Flags: variant(0),
                    WpaFlags: variant(0),
                    RsnFlags: variant(0x100),
                    Frequency: variant(2412),
                  }),
                };
              },
            };
          }

          if (objectPath === "/active/1") {
            return {
              getInterface() {
                return {
                  Get: async () => variant(2),
                  GetAll: async () => ({}),
                };
              },
            };
          }

          throw new Error(`unexpected object path ${objectPath}`);
        },
      }),
    });

    const response = await service.connectWifi({
      ssid: "AgenOS",
      bssid: "00:11:22:33:44:55",
      password: "hunter2",
    });

    expect(response).toEqual({
      ok: true,
      status: "connected",
      message: "Conexión Wi-Fi lista.",
    });
    expect(JSON.stringify(response)).not.toContain("hunter2");
    expect(JSON.stringify(capturedConnection)).toContain("hunter2");
  });
});
