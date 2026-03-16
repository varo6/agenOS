import { describe, expect, test } from "bun:test";

import type { InstallerProfilePayload } from "../../shared/installer-types";
import { validateProfile } from "./validate-profile";

function buildProfile(overrides: Partial<InstallerProfilePayload> = {}): InstallerProfilePayload {
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
    ...overrides,
  };
}

const availableDisks = [
  {
    path: "/dev/sda",
    vendor: "ATA",
    model: "Disk",
    transport: "sata",
    sizeBytes: 64 * 1024 * 1024 * 1024,
    sizeLabel: "64 GB",
    systemDisk: false,
  },
];

describe("validateProfile", () => {
  test("accepts a valid profile and normalizes locale fields", () => {
    const result = validateProfile(buildProfile(), { availableDisks });

    expect(result.errors).toEqual({});
    expect(result.normalizedProfile).toMatchObject({
      localeCode: "es_ES",
      localeConf: {
        LANG: "es_ES.UTF-8",
      },
      user: {
        password: "secret",
      },
    });
    expect(result.normalizedProfile?.user).not.toHaveProperty("passwordConfirmation");
  });

  test("rejects a missing locale", () => {
    const result = validateProfile(buildProfile({ locale: "" }), { availableDisks });
    expect(result.errors.locale).toBe("El locale es obligatorio.");
  });

  test("rejects an invalid timezone", () => {
    const result = validateProfile(buildProfile({ timezone: "Mars/Olympus" }), { availableDisks });
    expect(result.errors.timezone).toBe("La zona horaria no es válida.");
  });

  test("rejects an invalid keyboard layout", () => {
    const result = validateProfile(buildProfile({ keyboardLayout: "es space" }), { availableDisks });
    expect(result.errors.keyboardLayout).toBe("El layout de teclado no es válido.");
  });

  test("rejects a disk that is not available", () => {
    const result = validateProfile(buildProfile({ targetDisk: "/dev/nvme0n1" }), { availableDisks });
    expect(result.errors.targetDisk).toBe("El disco objetivo no está disponible en esta sesión live.");
  });

  test("rejects a reserved username", () => {
    const result = validateProfile(
      buildProfile({
        user: {
          ...buildProfile().user,
          username: "root",
        },
      }),
      { availableDisks },
    );
    expect(result.errors.username).toBe("El username no es válido.");
  });

  test("rejects an invalid hostname", () => {
    const result = validateProfile(
      buildProfile({
        user: {
          ...buildProfile().user,
          hostname: "Bad Host",
        },
      }),
      { availableDisks },
    );
    expect(result.errors.hostname).toBe("El hostname no es válido.");
  });

  test("rejects a missing password", () => {
    const result = validateProfile(
      buildProfile({
        user: {
          ...buildProfile().user,
          password: "",
          passwordConfirmation: "",
        },
      }),
      { availableDisks },
    );
    expect(result.errors.password).toBe("La contraseña es obligatoria.");
  });

  test("rejects mismatched password confirmation", () => {
    const result = validateProfile(
      buildProfile({
        user: {
          ...buildProfile().user,
          passwordConfirmation: "different",
        },
      }),
      { availableDisks },
    );
    expect(result.errors.passwordConfirmation).toBe("Las contraseñas no coinciden.");
  });
});
