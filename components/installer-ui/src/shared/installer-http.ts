export const INSTALLER_API_HOST = "127.0.0.1";
export const INSTALLER_API_PORT = 4173;
export const INSTALLER_API_BASE_DEFAULT = `http://${INSTALLER_API_HOST}:${INSTALLER_API_PORT}`;
export const INSTALLER_API_PREFIX = "/api/installer";

export const INSTALLER_ROUTES = {
  health: "/health",
  preflight: `${INSTALLER_API_PREFIX}/preflight`,
  disks: `${INSTALLER_API_PREFIX}/disks`,
  validateProfile: `${INSTALLER_API_PREFIX}/validate-profile`,
  startGuided: `${INSTALLER_API_PREFIX}/start-guided`,
  startClassic: `${INSTALLER_API_PREFIX}/start-classic`,
} as const;

export function resolveInstallerApiBase(override: string | null | undefined): string {
  const trimmed = override?.trim();
  return trimmed || INSTALLER_API_BASE_DEFAULT;
}

export function installerRouteUrl(path: string, baseUrl: string): string {
  return new URL(path, baseUrl).toString();
}
