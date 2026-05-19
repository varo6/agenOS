import { afterEach, describe, expect, test } from "bun:test";

import { createSystemClient } from "./system-client";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

afterEach(() => {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  } else {
    delete globalThis.fetch;
  }

  if (originalWindow) {
    globalThis.window = originalWindow;
  } else {
    delete globalThis.window;
  }
});

describe("createSystemClient", () => {
  test("prefers the IPC bridge when it is available", async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("fetch should not be called when IPC is available");
    };

    globalThis.window = {
      location: new URL("file:///tmp/system/index.html"),
      agenosSystem: {
        isAvailable: () => true,
        getPreflight: async () => ({
          firmware: "UEFI",
          isLiveSession: true,
          totalRamBytes: 8,
          installableDiskBytes: 16,
          checks: [],
        }),
        runMaintenance: async () => ({ ok: true, message: "maintenance ok" }),
        switchMode: async () => ({ ok: true, message: "switch ok" }),
        getRuntimeInfo: async () => ({
          mode: "ipc",
          host: "electron",
          gpu: "on",
          version: "0.1.0",
        }),
      },
    };

    const client = createSystemClient();
    await expect(client.getPreflight()).resolves.toEqual({
      firmware: "UEFI",
      isLiveSession: true,
      totalRamBytes: 8,
      installableDiskBytes: 16,
      checks: [],
    });
    expect(fetchCalls).toBe(0);
  });

  test("falls back to loopback HTTP when the bridge is unavailable from file://", async () => {
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push([url, init]);
      return new Response(JSON.stringify({
        firmware: "UEFI",
        isLiveSession: false,
        totalRamBytes: 4,
        installableDiskBytes: 32,
        checks: [],
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    };

    globalThis.window = {
      location: new URL("file:///tmp/system/index.html"),
    };

    const client = createSystemClient();
    await expect(client.getPreflight()).resolves.toEqual({
      firmware: "UEFI",
      isLiveSession: false,
      totalRamBytes: 4,
      installableDiskBytes: 32,
      checks: [],
    });
    expect(requests).toHaveLength(1);
    expect(requests[0][0]).toBe("http://127.0.0.1:4173/api/installer/preflight");
  });

  test("uses HTTP for actions when the Electron bridge is exposed in fallback mode", async () => {
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push([url, init]);
      return new Response(JSON.stringify({
        ok: true,
        message: "switch ok",
      }), {
        status: 202,
        headers: {
          "Content-Type": "application/json",
        },
      });
    };

    globalThis.window = {
      location: new URL("file:///tmp/system/index.html"),
      agenosSystem: {
        isAvailable: () => false,
        getPreflight: async () => {
          throw new Error("not used");
        },
        runMaintenance: async () => ({ ok: false, message: "not used" }),
        switchMode: async () => ({ ok: false, message: "not used" }),
        getRuntimeInfo: async () => ({
          mode: "http",
          host: "electron",
          gpu: "off",
          version: "0.1.0",
        }),
      },
    };

    const client = createSystemClient();
    await expect(client.switchMode("installer")).resolves.toEqual({
      ok: true,
      message: "switch ok",
    });
    await expect(client.getRuntimeInfo()).resolves.toEqual({
      mode: "http",
      host: "electron",
      gpu: "off",
      version: "0.1.0",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0][0]).toBe("http://127.0.0.1:4173/api/installer/switch-mode");
  });

  test("sends shell session token when bootstrap data is injected", async () => {
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push([url, init]);
      return new Response(JSON.stringify({
        ok: true,
        message: "maintenance ok",
      }), {
        status: 202,
        headers: {
          "Content-Type": "application/json",
        },
      });
    };

    globalThis.window = {
      location: new URL("http://127.0.0.1:4174/"),
      __AGENOS_SHELL_BOOTSTRAP__: {
        sessionToken: "session-123",
      },
    };

    const client = createSystemClient();
    await expect(client.runMaintenance("terminal")).resolves.toEqual({
      ok: true,
      message: "maintenance ok",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0][0]).toBe("http://127.0.0.1:4174/api/system/maintenance");
    expect(requests[0][1].headers.get("X-Session-Token")).toBe("session-123");
  });
});
