import { describe, expect, test } from "bun:test";

import type { InstallerProfilePayload } from "../../shared/installer-types";
import { createLaunchService } from "./launch";

function buildProfile(): InstallerProfilePayload {
  return {
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
}

describe("launch service", () => {
  test("returns an immediate failure when the helper exits within one second", async () => {
    const service = createLaunchService({
      profilePath: () => "/tmp/profile.json",
      helperLogPath: () => "/tmp/helper.log",
      validateProfile: () => ({
        errors: {},
        normalizedProfile: {
          schemaVersion: 1,
          locale: "es_ES.UTF-8",
          localeCode: "es_ES",
          localeConf: { LANG: "es_ES.UTF-8" },
          timezone: "Europe/Madrid",
          keyboardLayout: "es",
          keyboardVariant: "",
          targetDisk: "/dev/sda",
          user: {
            fullName: "Ada Lovelace",
            username: "ada",
            hostname: "agenos",
            password: "secret",
          },
          installMode: "erase-disk",
          rootMode: "same-as-user",
        },
      }),
      spawnHelper: () => ({
        waitForExit: async () => 1,
        onExit: () => {},
      }),
    });

    const response = await service.launchGuided(buildProfile());
    expect(response.ok).toBe(false);
    expect(response.message).toContain("El helper salió con código 1.");
  });

  test("returns launched=true when the helper keeps running past the one-second gate", async () => {
    let exitListener: ((code: number) => void) | undefined;

    const service = createLaunchService({
      profilePath: () => "/tmp/profile.json",
      helperLogPath: () => "/tmp/helper.log",
      validateProfile: () => ({
        errors: {},
        normalizedProfile: {
          schemaVersion: 1,
          locale: "es_ES.UTF-8",
          localeCode: "es_ES",
          localeConf: { LANG: "es_ES.UTF-8" },
          timezone: "Europe/Madrid",
          keyboardLayout: "es",
          keyboardVariant: "",
          targetDisk: "/dev/sda",
          user: {
            fullName: "Ada Lovelace",
            username: "ada",
            hostname: "agenos",
            password: "secret",
          },
          installMode: "erase-disk",
          rootMode: "same-as-user",
        },
      }),
      spawnHelper: () => ({
        waitForExit: async () => null,
        onExit: (listener) => {
          exitListener = listener;
        },
      }),
    });

    const response = await service.launchGuided(buildProfile());
    expect(response).toEqual({
      ok: true,
      launched: true,
      message: "Perfil guiado validado. Calamares se abrirá con el tramo final mínimo.",
    });

    exitListener?.(0);
  });

  test("removes the guided profile on early failure and after helper exit", async () => {
    const removedPaths: string[] = [];
    let exitListener: ((code: number) => void) | undefined;

    const service = createLaunchService({
      profilePath: () => "/run/user/1000/agenos-installer/profile.json",
      helperLogPath: () => "/tmp/helper.log",
      writeProfile: () => {},
      removeFile: (path) => {
        removedPaths.push(path);
      },
      validateProfile: () => ({
        errors: {},
        normalizedProfile: {
          schemaVersion: 1,
          locale: "es_ES.UTF-8",
          localeCode: "es_ES",
          localeConf: { LANG: "es_ES.UTF-8" },
          timezone: "Europe/Madrid",
          keyboardLayout: "es",
          keyboardVariant: "",
          targetDisk: "/dev/sda",
          user: {
            fullName: "Ada Lovelace",
            username: "ada",
            hostname: "agenos",
            password: "secret",
          },
          installMode: "erase-disk",
          rootMode: "same-as-user",
        },
      }),
      spawnHelper: () => ({
        waitForExit: async () => null,
        onExit: (listener) => {
          exitListener = listener;
        },
      }),
    });

    await service.launchGuided(buildProfile());
    exitListener?.(0);

    expect(removedPaths).toContain("/run/user/1000/agenos-installer/profile.json");

    removedPaths.length = 0;

    const failedService = createLaunchService({
      profilePath: () => "/run/user/1000/agenos-installer/profile.json",
      helperLogPath: () => "/tmp/helper.log",
      writeProfile: () => {},
      removeFile: (path) => {
        removedPaths.push(path);
      },
      validateProfile: () => ({
        errors: {},
        normalizedProfile: {
          schemaVersion: 1,
          locale: "es_ES.UTF-8",
          localeCode: "es_ES",
          localeConf: { LANG: "es_ES.UTF-8" },
          timezone: "Europe/Madrid",
          keyboardLayout: "es",
          keyboardVariant: "",
          targetDisk: "/dev/sda",
          user: {
            fullName: "Ada Lovelace",
            username: "ada",
            hostname: "agenos",
            password: "secret",
          },
          installMode: "erase-disk",
          rootMode: "same-as-user",
        },
      }),
      spawnHelper: () => ({
        waitForExit: async () => 2,
        onExit: () => {},
      }),
    });

    await failedService.launchGuided(buildProfile());
    expect(removedPaths).toContain("/run/user/1000/agenos-installer/profile.json");
  });
});
