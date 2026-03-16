import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildGuiEnv, originalUid, allowedRuntimeDir, validateProfilePath } from "./gui-env";
import { validateProfile } from "./validate-profile";

export const EXEC_SEQUENCE = [
  "partition",
  "mount",
  "unpackfs",
  "dpkg-unsafe-io",
  "sources-media",
  "machineid",
  "fstab",
  "locale",
  "keyboard",
  "localecfg",
  "users",
  "displaymanager",
  "networkcfg",
  "hwclock",
  "services-systemd",
  "agenosdesktop",
  "bootloader-config",
  "grubcfg",
  "bootloader",
  "packages",
  "luksbootkeyfile",
  "plymouthcfg",
  "initramfscfg",
  "initramfs",
  "dpkg-unsafe-io-undo",
  "sources-media-unmount",
  "sources-final",
  "umount",
];

export function loadProfile(path: string): unknown {
  const payload = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const user = (payload.user ?? {}) as Record<string, unknown>;
  const result = validateProfile({
    ...payload,
    user: {
      ...user,
      passwordConfirmation: user.password,
    },
  });

  if (Object.keys(result.errors).length > 0 || !result.normalizedProfile) {
    throw new Error(`Perfil inválido: ${JSON.stringify(result.errors)}`);
  }

  return result.normalizedProfile;
}

export function createGuidedConfig(profilePath: string): string {
  const tempRoot = mkdtempSync(join(tmpdir(), "agenos-calamares-"));
  const configDir = join(tempRoot, "calamares");

  cpSync("/etc/calamares", configDir, { recursive: true });
  mkdirSync(join(configDir, "modules"), { recursive: true });
  symlinkSync("/usr/share/calamares/qml", join(configDir, "qml"), "dir");

  const settings = [
    "---",
    "modules-search:",
    "  - local",
    "  - /usr/lib/calamares/modules",
    "",
    "oem-setup: false",
    "disable-cancel: false",
    "disable-cancel-during-exec: false",
    "quit-at-end: false",
    "",
    "sequence:",
    "  - exec:",
    "      - agenosseed",
    "  - show:",
    "      - partition",
    "      - summary",
    "  - exec:",
    ...EXEC_SEQUENCE.map((moduleName) => `      - ${moduleName}`),
    "  - show:",
    "      - finished",
    "",
    "branding: agenos",
    "prompt-install: false",
    "dont-chroot: false",
    "",
  ];

  writeFileSync(join(configDir, "settings.conf"), settings.join("\n"), "utf8");
  writeFileSync(
    join(configDir, "modules", "agenosseed.conf"),
    ["---", `profilePath: ${JSON.stringify(profilePath)}`, ""].join("\n"),
    "utf8",
  );

  return configDir;
}

export function moveStaleFstab(): boolean {
  if (!existsSync("/etc/fstab")) {
    return false;
  }

  renameSync("/etc/fstab", "/etc/fstab.orig.calamares");
  return true;
}

export function restoreStaleFstab(moved: boolean): void {
  if (!moved || !existsSync("/etc/fstab.orig.calamares")) {
    return;
  }

  renameSync("/etc/fstab.orig.calamares", "/etc/fstab");
}

export function allowRootX11(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.DISPLAY) {
    return;
  }

  spawnSync("xhost", ["+si:localuser:root"], { stdio: "ignore" });
}

export function revokeRootX11(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.DISPLAY) {
    return;
  }

  spawnSync("xhost", ["-si:localuser:root"], { stdio: "ignore" });
}

function summarizeGuiEnv(env: Record<string, string>): Record<string, string> {
  const summary: Record<string, string> = {};

  for (const key of [
    "DISPLAY",
    "XAUTHORITY",
    "WAYLAND_DISPLAY",
    "XDG_RUNTIME_DIR",
    "XDG_SESSION_TYPE",
    "DBUS_SESSION_BUS_ADDRESS",
    "QT_QPA_PLATFORM",
  ]) {
    summary[key] = env[key] ?? "";
  }

  return summary;
}

export function runCalamares(command: string[]): Promise<number> {
  const env = buildGuiEnv();
  console.log(`[agenos-installer-helper] gui env: ${JSON.stringify(summarizeGuiEnv(env))}`);
  console.log(`[agenos-installer-helper] launching: ${command.join(" ")}`);

  return new Promise((resolve) => {
    const child = spawn(command[0]!, command.slice(1), {
      env,
      stdio: "inherit",
    });

    child.once("close", (code) => {
      resolve(code ?? 1);
    });
    child.once("error", () => {
      resolve(1);
    });
  });
}

export async function runGuided(profileArg: string): Promise<number> {
  const profilePath = validateProfilePath(profileArg, allowedRuntimeDir(originalUid()));
  loadProfile(profilePath);
  const configDir = createGuidedConfig(profilePath);
  const movedFstab = moveStaleFstab();

  try {
    allowRootX11();
    return await runCalamares(["/usr/bin/calamares", "-c", configDir]);
  } finally {
    revokeRootX11();
    restoreStaleFstab(movedFstab);
    if (existsSync(profilePath)) {
      unlinkSync(profilePath);
    }
    rmSync(join(configDir, ".."), { recursive: true, force: true });
  }
}

export async function runClassic(): Promise<number> {
  const movedFstab = moveStaleFstab();

  try {
    allowRootX11();
    return await runCalamares(["/usr/bin/calamares"]);
  } finally {
    revokeRootX11();
    restoreStaleFstab(movedFstab);
  }
}
