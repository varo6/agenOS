import type {
  DiskSummary,
  InstallerProfilePayload,
  NormalizedInstallerProfile,
  ValidateErrorMap,
} from "../../shared/installer-types";
import { discoverDisks } from "./disks";

const ALLOWED_INSTALL_MODES = new Set(["erase-disk"]);
const ALLOWED_ROOT_MODES = new Set(["same-as-user"]);
const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const KEYBOARD_RE = /^[A-Za-z0-9_,+-]+$/;
const RESERVED_USERNAMES = new Set(["root", "daemon", "bin", "sys", "sync", "shutdown", "halt", "nobody"]);
const RESERVED_HOSTNAMES = new Set(["localhost"]);

function normalizeLocale(value: unknown): string {
  const locale = String(value ?? "").trim();
  return locale || "";
}

function shortLocale(locale: string): string {
  return locale.split(".", 1)[0].replaceAll("-", "_");
}

function localeConf(locale: string): Record<string, string> {
  return {
    LANG: locale,
    LC_NUMERIC: locale,
    LC_TIME: locale,
    LC_MONETARY: locale,
    LC_PAPER: locale,
    LC_NAME: locale,
    LC_ADDRESS: locale,
    LC_TELEPHONE: locale,
    LC_MEASUREMENT: locale,
    LC_IDENTIFICATION: locale,
  };
}

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function validateProfile(
  payload: unknown,
  options: {
    availableDisks?: DiskSummary[];
  } = {},
): {
  normalizedProfile: NormalizedInstallerProfile | null;
  errors: ValidateErrorMap;
} {
  const errors: ValidateErrorMap = {};

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      normalizedProfile: null,
      errors: { profile: "El body debe ser un objeto JSON." },
    };
  }

  const profile = payload as Record<string, unknown>;
  const locale = normalizeLocale(profile.locale);
  const timezone = String(profile.timezone ?? "").trim();
  const keyboardLayout = String(profile.keyboardLayout ?? "").trim();
  const keyboardVariant = String(profile.keyboardVariant ?? "").trim();
  const targetDisk = String(profile.targetDisk ?? "").trim();
  const installMode = String(profile.installMode ?? "").trim();
  const rootMode = String(profile.rootMode ?? "").trim();
  const schemaVersion = profile.schemaVersion;
  const user = profile.user;

  if (schemaVersion !== 1) {
    errors.schemaVersion = "El esquema soportado es la versión 1.";
  }

  if (!locale) {
    errors.locale = "El locale es obligatorio.";
  }

  if (!timezone) {
    errors.timezone = "La zona horaria es obligatoria.";
  } else if (!isValidTimeZone(timezone)) {
    errors.timezone = "La zona horaria no es válida.";
  }

  if (!keyboardLayout || !KEYBOARD_RE.test(keyboardLayout)) {
    errors.keyboardLayout = "El layout de teclado no es válido.";
  }

  if (keyboardVariant && !KEYBOARD_RE.test(keyboardVariant)) {
    errors.keyboardVariant = "La variante de teclado no es válida.";
  }

  const availableDiskPaths = new Set(
    (options.availableDisks ?? discoverDisks()).map((disk) => disk.path),
  );
  if (!availableDiskPaths.has(targetDisk)) {
    errors.targetDisk = "El disco objetivo no está disponible en esta sesión live.";
  }

  if (!ALLOWED_INSTALL_MODES.has(installMode)) {
    errors.installMode = "Solo se soporta erase-disk en la v1.";
  }

  if (!ALLOWED_ROOT_MODES.has(rootMode)) {
    errors.rootMode = "Solo se soporta same-as-user en la v1.";
  }

  if (!user || typeof user !== "object" || Array.isArray(user)) {
    errors.user = "El bloque de usuario es obligatorio.";
    return { normalizedProfile: null, errors };
  }

  const userPayload = user as Record<string, unknown>;
  const fullName = String(userPayload.fullName ?? "").trim();
  const username = String(userPayload.username ?? "").trim();
  const hostname = String(userPayload.hostname ?? "").trim();
  const password = String(userPayload.password ?? "");
  const passwordConfirmation = String(
    userPayload.passwordConfirmation ?? profile.passwordConfirmation ?? "",
  );

  if (!fullName) {
    errors.fullName = "El nombre completo es obligatorio.";
  }

  if (!USERNAME_RE.test(username) || RESERVED_USERNAMES.has(username)) {
    errors.username = "El username no es válido.";
  }

  if (!HOSTNAME_RE.test(hostname) || RESERVED_HOSTNAMES.has(hostname)) {
    errors.hostname = "El hostname no es válido.";
  }

  if (!password) {
    errors.password = "La contraseña es obligatoria.";
  }

  if (password !== passwordConfirmation) {
    errors.passwordConfirmation = "Las contraseñas no coinciden.";
  }

  if (Object.keys(errors).length > 0) {
    return {
      normalizedProfile: null,
      errors,
    };
  }

  const normalizedProfile: NormalizedInstallerProfile = {
    schemaVersion: 1,
    locale,
    localeCode: shortLocale(locale),
    localeConf: localeConf(locale),
    timezone,
    keyboardLayout,
    keyboardVariant,
    targetDisk,
    user: {
      fullName,
      username,
      hostname,
      password,
    },
    installMode: "erase-disk",
    rootMode: "same-as-user",
  };

  return {
    normalizedProfile,
    errors: {},
  };
}

export function normalizeProfile(
  payload: InstallerProfilePayload,
  options?: { availableDisks?: DiskSummary[] },
): NormalizedInstallerProfile {
  const result = validateProfile(payload, options);
  if (result.errors && Object.keys(result.errors).length > 0 || !result.normalizedProfile) {
    throw new Error(`Perfil inválido: ${JSON.stringify(result.errors)}`);
  }
  return result.normalizedProfile;
}
