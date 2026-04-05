export type FirmwareType = "UEFI" | "BIOS";
export type ShellMode = "installer" | "system";
export type MaintenanceAction = "terminal";

export type StepId =
  | "welcome"
  | "language"
  | "disk"
  | "identity"
  | "confirm"
  | "handoff";

export type PreflightCheck = {
  id: string;
  label: string;
  status: "ok" | "warning" | "error";
  detail: string;
};

export type PreflightResponse = {
  firmware: FirmwareType;
  isLiveSession: boolean;
  totalRamBytes: number;
  installableDiskBytes: number;
  checks: PreflightCheck[];
};

export type DiskSummary = {
  path: string;
  model: string;
  vendor: string;
  transport: string;
  sizeBytes: number;
  sizeLabel: string;
  systemDisk: boolean;
};

export type ValidateErrorMap = Record<string, string>;

export type InstallerProfilePayload = {
  schemaVersion: 1;
  locale: string;
  timezone: string;
  keyboardLayout: string;
  keyboardVariant: string;
  targetDisk: string;
  user: {
    fullName: string;
    username: string;
    hostname: string;
    password: string;
    passwordConfirmation?: string;
  };
  installMode: "erase-disk";
  rootMode: "same-as-user";
};

export type NormalizedInstallerProfile = {
  schemaVersion: 1;
  locale: string;
  localeCode: string;
  localeConf: Record<string, string>;
  timezone: string;
  keyboardLayout: string;
  keyboardVariant: string;
  targetDisk: string;
  user: {
    fullName: string;
    username: string;
    hostname: string;
    password: string;
  };
  installMode: "erase-disk";
  rootMode: "same-as-user";
};

export type ValidationResponse = {
  ok: boolean;
  errors: ValidateErrorMap;
  normalizedProfile?: NormalizedInstallerProfile;
};

export type LaunchResponse = {
  ok: boolean;
  launched?: boolean;
  errors?: ValidateErrorMap;
  message?: string;
};

export type SwitchModeRequest = {
  mode: ShellMode;
};

export type ApiMessageResponse = {
  ok: boolean;
  message?: string;
};
