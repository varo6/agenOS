import { motion } from "framer-motion";
import { Clock3, Globe, Keyboard, Type } from "lucide-react";

import type {
  InstallerProfilePayload,
  ValidateErrorMap,
} from "../../../shared/installer-types";
import {
  KEYBOARD_LAYOUT_OPTIONS,
  KEYBOARD_VARIANT_OPTIONS,
  LANGUAGE_PRESETS,
  TIMEZONE_SUGGESTIONS,
} from "../data/presets";

type LanguageSlideProps = {
  errors: ValidateErrorMap;
  onApplyPreset: (presetId: string) => void;
  onUpdateField: <
    Key extends keyof Pick<
      InstallerProfilePayload,
      "locale" | "timezone" | "keyboardLayout" | "keyboardVariant"
    >,
  >(
    key: Key,
    value: InstallerProfilePayload[Key],
  ) => void;
  profile: InstallerProfilePayload;
  selectedPresetId: string;
};

const stagger = { animate: { transition: { staggerChildren: 0.07 } } };
const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
};

export function LanguageSlide({
  errors,
  onApplyPreset,
  onUpdateField,
  profile,
  selectedPresetId,
}: LanguageSlideProps) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col justify-center overflow-y-auto px-2 py-2">
      <motion.div
        animate="animate"
        className="space-y-6"
        initial="initial"
        variants={stagger}
      >
        <motion.div className="space-y-3 text-center" variants={fadeUp}>
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/20 bg-sky-300/10 px-4 py-1.5 text-sm font-medium text-sky-300">
            <Globe className="h-4 w-4" />
            Configuracion regional
          </div>
          <h2 className="font-display text-4xl font-semibold tracking-tight text-white md:text-5xl">
            Idioma, zona horaria y teclado
          </h2>
          <p className="mx-auto max-w-2xl text-base text-white/55">
            El preset ajusta locale, zona horaria y layout por defecto. Puedes
            afinar cualquier campo antes de continuar.
          </p>
        </motion.div>

        <motion.div className="space-y-3" variants={fadeUp}>
          <p className="text-sm font-medium text-white/70">Presets sugeridos</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {LANGUAGE_PRESETS.map((preset) => (
              <button
                className={[
                  "glass-panel px-3 py-3 text-left text-sm transition-all",
                  selectedPresetId === preset.id
                    ? "border border-accent/35 bg-accent/12 text-white"
                    : "text-white/62 hover:bg-white/[0.05] hover:text-white",
                ].join(" ")}
                key={preset.id}
                onClick={() => onApplyPreset(preset.id)}
                type="button"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </motion.div>

        <motion.div className="grid grid-cols-1 gap-5 md:grid-cols-2" variants={fadeUp}>
          <label className="space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium text-white/70">
              <Type className="h-4 w-4 text-accent-light" />
              Locale
            </span>
            <input
              aria-label="Locale"
              className={["glass-input", errors.locale ? "field-error" : ""].join(" ")}
              onChange={(event) => onUpdateField("locale", event.target.value)}
              placeholder="es_ES.UTF-8"
              type="text"
              value={profile.locale}
            />
            {errors.locale ? (
              <p className="text-xs text-danger">{errors.locale}</p>
            ) : null}
          </label>

          <label className="space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium text-white/70">
              <Clock3 className="h-4 w-4 text-emerald-300" />
              Zona horaria
            </span>
            <select
              aria-label="Zona horaria"
              className={["glass-select", errors.timezone ? "field-error" : ""].join(" ")}
              onChange={(event) => onUpdateField("timezone", event.target.value)}
              value={profile.timezone}
            >
              <option value="">Selecciona una zona horaria</option>
              {TIMEZONE_SUGGESTIONS.map((timezone) => (
                <option key={timezone} value={timezone}>
                  {timezone}
                </option>
              ))}
            </select>
            {errors.timezone ? (
              <p className="text-xs text-danger">{errors.timezone}</p>
            ) : null}
          </label>

          <label className="space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium text-white/70">
              <Keyboard className="h-4 w-4 text-accent-light" />
              Layout de teclado
            </span>
            <select
              aria-label="Layout de teclado"
              className={[
                "glass-select",
                errors.keyboardLayout ? "field-error" : "",
              ].join(" ")}
              onChange={(event) =>
                onUpdateField("keyboardLayout", event.target.value)
              }
              value={profile.keyboardLayout}
            >
              <option value="">Selecciona un layout</option>
              {KEYBOARD_LAYOUT_OPTIONS.map((layout) => (
                <option key={layout.value} value={layout.value}>
                  {layout.label}
                </option>
              ))}
            </select>
            {errors.keyboardLayout ? (
              <p className="text-xs text-danger">{errors.keyboardLayout}</p>
            ) : null}
          </label>

          <label className="space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium text-white/70">
              <Keyboard className="h-4 w-4 text-amber-200" />
              Variante de teclado
            </span>
            <select
              aria-label="Variante de teclado"
              className={[
                "glass-select",
                errors.keyboardVariant ? "field-error" : "",
              ].join(" ")}
              onChange={(event) =>
                onUpdateField("keyboardVariant", event.target.value)
              }
              value={profile.keyboardVariant}
            >
              {KEYBOARD_VARIANT_OPTIONS.map((variant) => (
                <option key={variant.value || "default"} value={variant.value}>
                  {variant.label}
                </option>
              ))}
            </select>
            {errors.keyboardVariant ? (
              <p className="text-xs text-danger">{errors.keyboardVariant}</p>
            ) : (
              <p className="text-xs text-white/30">
                Vacia para usar la variante predeterminada del layout.
              </p>
            )}
          </label>
        </motion.div>
      </motion.div>
    </div>
  );
}
