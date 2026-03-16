export type LanguagePreset = {
  id: string;
  label: string;
  locale: string;
  timezone: string;
  keyboardLayout: string;
  keyboardVariant: string;
};

export type KeyboardOption = {
  label: string;
  value: string;
};

export const LANGUAGE_PRESETS: LanguagePreset[] = [
  {
    id: "es-es",
    label: "Espanol (Espana)",
    locale: "es_ES.UTF-8",
    timezone: "Europe/Madrid",
    keyboardLayout: "es",
    keyboardVariant: "",
  },
  {
    id: "es-mx",
    label: "Espanol (Mexico)",
    locale: "es_MX.UTF-8",
    timezone: "America/Mexico_City",
    keyboardLayout: "latam",
    keyboardVariant: "",
  },
  {
    id: "en-us",
    label: "Ingles (Estados Unidos)",
    locale: "en_US.UTF-8",
    timezone: "America/New_York",
    keyboardLayout: "us",
    keyboardVariant: "",
  },
  {
    id: "en-gb",
    label: "Ingles (Reino Unido)",
    locale: "en_GB.UTF-8",
    timezone: "Europe/London",
    keyboardLayout: "gb",
    keyboardVariant: "",
  },
  {
    id: "fr-fr",
    label: "Frances (Francia)",
    locale: "fr_FR.UTF-8",
    timezone: "Europe/Paris",
    keyboardLayout: "fr",
    keyboardVariant: "",
  },
  {
    id: "de-de",
    label: "Aleman (Alemania)",
    locale: "de_DE.UTF-8",
    timezone: "Europe/Berlin",
    keyboardLayout: "de",
    keyboardVariant: "",
  },
];

export const TIMEZONE_SUGGESTIONS = [
  "Europe/Madrid",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/Bogota",
  "UTC",
];

export const KEYBOARD_LAYOUT_OPTIONS: KeyboardOption[] = [
  { value: "es", label: "Espanol" },
  { value: "latam", label: "Latinoamerica" },
  { value: "us", label: "US" },
  { value: "gb", label: "Reino Unido" },
  { value: "fr", label: "Frances" },
  { value: "de", label: "Aleman" },
];

export const KEYBOARD_VARIANT_OPTIONS: KeyboardOption[] = [
  { value: "", label: "Predeterminada" },
  { value: "intl", label: "Internacional" },
  { value: "altgr-intl", label: "AltGr internacional" },
  { value: "nodeadkeys", label: "Sin dead keys" },
  { value: "winkeys", label: "Teclas Windows" },
];

export function presetForLocale(locale: string): LanguagePreset | null {
  return LANGUAGE_PRESETS.find((preset) => preset.locale === locale) ?? null;
}
