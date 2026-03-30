import { useState } from "react";

import type {
  DiskSummary,
  InstallerProfilePayload,
  NormalizedInstallerProfile,
  StepId,
  ValidateErrorMap,
} from "../../../shared/installer-types";
import {
  LANGUAGE_PRESETS,
  presetForLocale,
} from "../data/presets";

export const STEP_ORDER: StepId[] = [
  "welcome",
  "language",
  "disk",
  "identity",
  "confirm",
  "handoff",
];

export type InstallerStoreSnapshot = {
  step: StepId;
  selectedPresetId: string;
  profile: InstallerProfilePayload;
  launchMode: "guided" | "classic" | null;
  launchMessage: string;
};

const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const KEYBOARD_RE = /^[A-Za-z0-9_,+-]+$/;

export function buildDefaultProfile(): InstallerProfilePayload {
  const preset = LANGUAGE_PRESETS[0]!;

  return {
    schemaVersion: 1,
    locale: preset.locale,
    timezone: preset.timezone,
    keyboardLayout: preset.keyboardLayout,
    keyboardVariant: preset.keyboardVariant,
    targetDisk: "",
    user: {
      fullName: "",
      username: "",
      hostname: "",
      password: "",
      passwordConfirmation: "",
    },
    installMode: "erase-disk",
    rootMode: "same-as-user",
  };
}

export function mergeNormalizedProfile(
  current: InstallerProfilePayload,
  normalized: NormalizedInstallerProfile,
): InstallerProfilePayload {
  return {
    ...normalized,
    user: {
      ...normalized.user,
      passwordConfirmation:
        current.user.passwordConfirmation ?? current.user.password,
    },
  };
}

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("es-ES", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function validateLanguage(profile: InstallerProfilePayload): ValidateErrorMap {
  const errors: ValidateErrorMap = {};

  if (!profile.locale.trim()) {
    errors.locale = "El locale es obligatorio.";
  }

  if (!profile.timezone.trim()) {
    errors.timezone = "La zona horaria es obligatoria.";
  } else if (!isValidTimeZone(profile.timezone.trim())) {
    errors.timezone = "La zona horaria no es valida.";
  }

  if (!profile.keyboardLayout.trim() || !KEYBOARD_RE.test(profile.keyboardLayout)) {
    errors.keyboardLayout = "El layout de teclado no es valido.";
  }

  if (profile.keyboardVariant && !KEYBOARD_RE.test(profile.keyboardVariant)) {
    errors.keyboardVariant = "La variante de teclado no es valida.";
  }

  return errors;
}

function validateDisk(
  profile: InstallerProfilePayload,
  availableDisks: DiskSummary[],
): ValidateErrorMap {
  const errors: ValidateErrorMap = {};

  if (!profile.targetDisk.trim()) {
    errors.targetDisk = "Selecciona el disco que se borrara por completo.";
    return errors;
  }

  if (
    availableDisks.length > 0 &&
    !availableDisks.some((disk) => disk.path === profile.targetDisk)
  ) {
    errors.targetDisk =
      "El disco objetivo no esta disponible en esta sesion live.";
  }

  return errors;
}

function validateIdentity(profile: InstallerProfilePayload): ValidateErrorMap {
  const errors: ValidateErrorMap = {};

  if (!profile.user.fullName.trim()) {
    errors.fullName = "El nombre completo es obligatorio.";
  }

  if (!USERNAME_RE.test(profile.user.username)) {
    errors.username =
      "El nombre de usuario debe empezar en minuscula y solo puede usar a-z, 0-9, _ o -.";
  }

  if (!HOSTNAME_RE.test(profile.user.hostname)) {
    errors.hostname =
      "El hostname solo puede usar minusculas, numeros y guiones.";
  }

  if (!profile.user.password) {
    errors.password = "La contrasena es obligatoria.";
  }

  if (profile.user.password !== profile.user.passwordConfirmation) {
    errors.passwordConfirmation = "Las contrasenas no coinciden.";
  }

  return errors;
}

function validateContract(profile: InstallerProfilePayload): ValidateErrorMap {
  const errors: ValidateErrorMap = {};

  if (profile.schemaVersion !== 1) {
    errors.schemaVersion = "El esquema soportado es la version 1.";
  }

  if (profile.installMode !== "erase-disk") {
    errors.installMode = "Solo se soporta erase-disk en la v1.";
  }

  if (profile.rootMode !== "same-as-user") {
    errors.rootMode = "Solo se soporta same-as-user en la v1.";
  }

  return errors;
}

export function validateLocalProfile(
  profile: InstallerProfilePayload,
  step: "language" | "disk" | "identity" | "confirm",
  availableDisks: DiskSummary[] = [],
): ValidateErrorMap {
  if (step === "language") {
    return validateLanguage(profile);
  }

  if (step === "disk") {
    return validateDisk(profile, availableDisks);
  }

  if (step === "identity") {
    return validateIdentity(profile);
  }

  return {
    ...validateContract(profile),
    ...validateLanguage(profile),
    ...validateDisk(profile, availableDisks),
    ...validateIdentity(profile),
  };
}

export function useInstallerStore() {
  const [step, setStep] = useState<StepId>("welcome");
  const [direction, setDirection] = useState(1);
  const [selectedPresetId, setSelectedPresetId] = useState(LANGUAGE_PRESETS[0]!.id);
  const [profile, setProfile] = useState<InstallerProfilePayload>(buildDefaultProfile());
  const [errors, setErrors] = useState<ValidateErrorMap>({});
  const [busy, setBusy] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [launchMode, setLaunchMode] = useState<"guided" | "classic" | null>(null);
  const [launchMessage, setLaunchMessage] = useState("");

  function clearErrors(keys: string[]) {
    if (keys.length === 0) {
      return;
    }

    setErrors((current) => {
      const next = { ...current };
      for (const key of keys) {
        delete next[key];
      }
      return next;
    });
  }

  function goToStep(nextStep: StepId) {
    const currentIndex = STEP_ORDER.indexOf(step);
    const nextIndex = STEP_ORDER.indexOf(nextStep);

    setDirection(nextIndex >= currentIndex ? 1 : -1);
    setStep(nextStep);
  }

  function updateProfileField<
    Key extends keyof Pick<
      InstallerProfilePayload,
      "locale" | "timezone" | "keyboardLayout" | "keyboardVariant"
    >,
  >(key: Key, value: InstallerProfilePayload[Key]) {
    setProfile((current) => ({
      ...current,
      [key]: value,
    }));

    clearErrors([key]);
    setGlobalError(null);

    if (key === "locale" && typeof value === "string") {
      const preset = presetForLocale(value);
      if (preset) {
        setSelectedPresetId(preset.id);
      }
    }
  }

  function updateUserField<Key extends keyof InstallerProfilePayload["user"]>(
    key: Key,
    value: InstallerProfilePayload["user"][Key],
  ) {
    setProfile((current) => ({
      ...current,
      user: {
        ...current.user,
        [key]: value,
      },
    }));

    clearErrors([key]);
    setGlobalError(null);
  }

  function applyPreset(presetId: string) {
    const preset = LANGUAGE_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) {
      return;
    }

    setSelectedPresetId(presetId);
    setProfile((current) => ({
      ...current,
      locale: preset.locale,
      timezone: preset.timezone,
      keyboardLayout: preset.keyboardLayout,
      keyboardVariant: preset.keyboardVariant,
    }));

    clearErrors(["locale", "timezone", "keyboardLayout", "keyboardVariant"]);
    setGlobalError(null);
  }

  function selectDisk(path: string) {
    setProfile((current) => ({
      ...current,
      targetDisk: path,
    }));

    clearErrors(["targetDisk"]);
    setGlobalError(null);
  }

  function validateCurrentStep(
    availableDisks: DiskSummary[],
    targetStep: "language" | "disk" | "identity" | "confirm",
  ): ValidateErrorMap {
    const nextErrors = validateLocalProfile(profile, targetStep, availableDisks);
    setErrors(nextErrors);
    return nextErrors;
  }

  function applyNormalizedProfile(normalized: NormalizedInstallerProfile) {
    setProfile((current) => mergeNormalizedProfile(current, normalized));
    const preset = presetForLocale(normalized.locale);
    if (preset) {
      setSelectedPresetId(preset.id);
    }
  }

  function applyProfile(nextProfile: InstallerProfilePayload) {
    setProfile(nextProfile);
    const preset = presetForLocale(nextProfile.locale);
    if (preset) {
      setSelectedPresetId(preset.id);
    }
  }

  function snapshot(): InstallerStoreSnapshot {
    return {
      step,
      selectedPresetId,
      profile,
      launchMode,
      launchMessage,
    };
  }

  function restoreSnapshot(nextSnapshot: InstallerStoreSnapshot) {
    setStep(nextSnapshot.step);
    setDirection(1);
    setSelectedPresetId(nextSnapshot.selectedPresetId);
    setProfile(nextSnapshot.profile);
    setLaunchMode(nextSnapshot.launchMode);
    setLaunchMessage(nextSnapshot.launchMessage);
    setErrors({});
    setGlobalError(null);
    setBusy(false);
  }

  return {
    applyNormalizedProfile,
    applyPreset,
    applyProfile,
    busy,
    direction,
    dismissGlobalError: () => setGlobalError(null),
    errors,
    globalError,
    goToStep,
    launchMessage,
    launchMode,
    profile,
    restoreSnapshot,
    selectDisk,
    selectedPresetId,
    setBusy,
    setErrors,
    setGlobalError,
    setLaunchMessage,
    setLaunchMode,
    snapshot,
    step,
    updateProfileField,
    updateUserField,
    validateCurrentStep,
  };
}
