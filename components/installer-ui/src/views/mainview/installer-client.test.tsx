import { beforeEach, describe, expect, test, vi } from "vitest";

import type { InstallerProfilePayload } from "../../shared/installer-types";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubGlobal("fetch", fetchMock);
});

describe("installerClient", () => {
  test("uses the default loopback API base for preflight", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ firmware: "UEFI" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    const { installerClient } = await import("./installer-client");

    await expect(installerClient.getPreflight()).resolves.toEqual({ firmware: "UEFI" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4173/api/installer/preflight",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  test("uses VITE_INSTALLER_API_BASE when provided", async () => {
    vi.stubEnv("VITE_INSTALLER_API_BASE", "http://127.0.0.1:9999");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ path: "/dev/sda" }]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    const { installerClient } = await import("./installer-client");

    await installerClient.getDisks();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9999/api/installer/disks",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  test("posts JSON payloads to validate the installer profile", async () => {
    const profile: InstallerProfilePayload = {
      schemaVersion: 1,
      locale: "es_ES.UTF-8",
      timezone: "Europe/Madrid",
      keyboardLayout: "es",
      keyboardVariant: "",
      targetDisk: "/dev/sda",
      user: {
        fullName: "Ada Lovelace",
        username: "ada",
        hostname: "agenos",
        password: "secret",
        passwordConfirmation: "secret",
      },
      installMode: "erase-disk",
      rootMode: "same-as-user",
    };

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, errors: {} }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    const { installerClient } = await import("./installer-client");
    await installerClient.validateProfile(profile);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4173/api/installer/validate-profile",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(profile),
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
  });

  test("maps non-2xx API responses into prefixed HTTP errors", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, message: "boom" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    const { installerClient } = await import("./installer-client");

    await expect(installerClient.getDisks()).rejects.toThrow(
      "GET /api/installer/disks devolvió 500: boom",
    );
  });
});
