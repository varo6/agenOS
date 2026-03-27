import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import { INSTALLER_ROUTES } from "../shared/installer-http";
import type {
  InstallerProfilePayload,
  LaunchResponse,
  ValidationResponse,
} from "../shared/installer-types";
import { createInstallerApiHandler } from "./server";

const validProfile: InstallerProfilePayload = {
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

function createHandler(overrides: Parameters<typeof createInstallerApiHandler>[0] = {}) {
  return createInstallerApiHandler({
    getPreflight: () => ({
      firmware: "UEFI",
      isLiveSession: true,
      totalRamBytes: 8,
      installableDiskBytes: 16,
      checks: [],
    }),
    getDisks: () => [
      {
        path: "/dev/sda",
        vendor: "ATA",
        model: "Disk",
        transport: "sata",
        sizeBytes: 64,
        sizeLabel: "64 B",
        systemDisk: false,
      },
    ],
    validateProfile: () => ({
      ok: true,
      errors: {},
    }),
    launchGuided: async () => ({
      ok: true,
      launched: true,
      message: "guided ok",
    }),
    launchClassic: async () => ({
      ok: true,
      launched: true,
      message: "classic ok",
    }),
    ...overrides,
  });
}

async function jsonPayload(response: Response): Promise<unknown> {
  return response.json();
}

describe("createInstallerApiHandler", () => {
  test("serves /health", async () => {
    const handler = createHandler();

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.health}`));

    expect(response.status).toBe(200);
    expect(await jsonPayload(response)).toEqual({ ok: true });
  });

  test("serves preflight data", async () => {
    const handler = createHandler();

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.preflight}`));

    expect(response.status).toBe(200);
    expect(await jsonPayload(response)).toEqual({
      firmware: "UEFI",
      isLiveSession: true,
      totalRamBytes: 8,
      installableDiskBytes: 16,
      checks: [],
    });
  });

  test("serves disk summaries", async () => {
    const handler = createHandler();

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.disks}`));

    expect(response.status).toBe(200);
    expect(await jsonPayload(response)).toEqual([
      {
        path: "/dev/sda",
        vendor: "ATA",
        model: "Disk",
        transport: "sata",
        sizeBytes: 64,
        sizeLabel: "64 B",
        systemDisk: false,
      },
    ]);
  });

  test("returns validation responses over HTTP", async () => {
    const validationResponse: ValidationResponse = {
      ok: false,
      errors: {
        username: "El username no es válido.",
      },
    };
    const handler = createHandler({
      validateProfile: () => validationResponse,
    });

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.validateProfile}`, {
      method: "POST",
      body: JSON.stringify(validProfile),
    }));

    expect(response.status).toBe(200);
    expect(await jsonPayload(response)).toEqual(validationResponse);
  });

  test("returns 202 for successful guided launches", async () => {
    const launchResponse: LaunchResponse = {
      ok: true,
      launched: true,
      message: "guided ok",
    };
    const handler = createHandler({
      launchGuided: async () => launchResponse,
    });

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.startGuided}`, {
      method: "POST",
      body: JSON.stringify(validProfile),
    }));

    expect(response.status).toBe(202);
    expect(await jsonPayload(response)).toEqual(launchResponse);
  });

  test("returns 422 for guided validation failures", async () => {
    const launchResponse: LaunchResponse = {
      ok: false,
      errors: {
        username: "El username no es válido.",
      },
    };
    const handler = createHandler({
      launchGuided: async () => launchResponse,
    });

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.startGuided}`, {
      method: "POST",
      body: JSON.stringify(validProfile),
    }));

    expect(response.status).toBe(422);
    expect(await jsonPayload(response)).toEqual(launchResponse);
  });

  test("returns 202 for successful classic launches", async () => {
    const launchResponse: LaunchResponse = {
      ok: true,
      launched: true,
      message: "classic ok",
    };
    const handler = createHandler({
      launchClassic: async () => launchResponse,
    });

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.startClassic}`, {
      method: "POST",
    }));

    expect(response.status).toBe(202);
    expect(await jsonPayload(response)).toEqual(launchResponse);
  });

  test("returns 403 for classic permission failures", async () => {
    const launchResponse: LaunchResponse = {
      ok: false,
      message: "Permission denied",
    };
    const handler = createHandler({
      launchClassic: async () => launchResponse,
    });

    const response = await handler.fetch(new Request(`http://localhost${INSTALLER_ROUTES.startClassic}`, {
      method: "POST",
    }));

    expect(response.status).toBe(403);
    expect(await jsonPayload(response)).toEqual(launchResponse);
  });

  test("serves the packaged frontend when a dist dir is available", async () => {
    const frontendDir = mkdtempSync(join(tmpdir(), "agenos-installer-ui-"));
    Bun.write(join(frontendDir, "index.html"), "<!doctype html><title>AgenOS Installer</title>");
    Bun.write(join(frontendDir, "logo.svg"), "<svg xmlns='http://www.w3.org/2000/svg' />");

    const handler = createHandler({
      frontendDistDir: frontendDir,
    });

    const indexResponse = await handler.fetch(new Request("http://localhost/"));
    const assetResponse = await handler.fetch(new Request("http://localhost/logo.svg"));

    expect(indexResponse.status).toBe(200);
    expect(await indexResponse.text()).toContain("AgenOS Installer");
    expect(assetResponse.status).toBe(200);
    expect(await assetResponse.text()).toContain("<svg");
  });
});
