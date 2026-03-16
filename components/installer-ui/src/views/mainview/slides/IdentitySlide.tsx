import { motion } from "framer-motion";
import { AtSign, Eye, EyeOff, Info, Lock, Server, UserRound } from "lucide-react";
import { useState } from "react";

import type { InstallerProfilePayload, ValidateErrorMap } from "../../../shared/installer-types";

type IdentitySlideProps = {
  errors: ValidateErrorMap;
  onUpdateUserField: <Key extends keyof InstallerProfilePayload["user"]>(
    key: Key,
    value: InstallerProfilePayload["user"][Key],
  ) => void;
  user: InstallerProfilePayload["user"];
};

const stagger = { animate: { transition: { staggerChildren: 0.07 } } };
const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
};

export function IdentitySlide({
  errors,
  onUpdateUserField,
  user,
}: IdentitySlideProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col justify-center overflow-y-auto px-2 py-2">
      <motion.div
        animate="animate"
        className="space-y-6"
        initial="initial"
        variants={stagger}
      >
        <motion.div className="space-y-3 text-center" variants={fadeUp}>
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-1.5 text-sm font-medium text-amber-200">
            <UserRound className="h-4 w-4" />
            Identidad principal
          </div>
          <h2 className="font-display text-4xl font-semibold tracking-tight text-white md:text-5xl">
            Tu cuenta principal
          </h2>
          <p className="mx-auto max-w-2xl text-base text-white/55">
            El backend sigue normalizando locale, username y hostname antes de
            lanzar Calamares. Aqui solo adelantamos la validacion local.
          </p>
        </motion.div>

        <motion.div className="grid grid-cols-1 gap-5 md:grid-cols-2" variants={fadeUp}>
          <label className="space-y-2 md:col-span-2">
            <span className="flex items-center gap-2 text-sm font-medium text-white/70">
              <UserRound className="h-4 w-4 text-accent-light" />
              Nombre completo
            </span>
            <input
              aria-label="Nombre completo"
              className={["glass-input", errors.fullName ? "field-error" : ""].join(" ")}
              onChange={(event) => onUpdateUserField("fullName", event.target.value)}
              placeholder="Ada Lovelace"
              type="text"
              value={user.fullName}
            />
            {errors.fullName ? (
              <p className="text-xs text-danger">{errors.fullName}</p>
            ) : null}
          </label>

          <label className="space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium text-white/70">
              <AtSign className="h-4 w-4 text-sky-300" />
              Nombre de usuario
            </span>
            <input
              aria-label="Nombre de usuario"
              className={["glass-input font-mono", errors.username ? "field-error" : ""].join(" ")}
              onChange={(event) =>
                onUpdateUserField("username", event.target.value.toLowerCase())
              }
              placeholder="ada"
              type="text"
              value={user.username}
            />
            {errors.username ? (
              <p className="text-xs text-danger">{errors.username}</p>
            ) : (
              <p className="text-xs text-white/30">
                Solo minusculas, numeros, guion y guion bajo.
              </p>
            )}
          </label>

          <label className="space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium text-white/70">
              <Server className="h-4 w-4 text-emerald-300" />
              Hostname
            </span>
            <input
              aria-label="Hostname"
              className={["glass-input font-mono", errors.hostname ? "field-error" : ""].join(" ")}
              onChange={(event) =>
                onUpdateUserField("hostname", event.target.value.toLowerCase())
              }
              placeholder="agenos"
              type="text"
              value={user.hostname}
            />
            {errors.hostname ? (
              <p className="text-xs text-danger">{errors.hostname}</p>
            ) : (
              <p className="text-xs text-white/30">
                Debe terminar limpio, sin espacios ni guiones al borde.
              </p>
            )}
          </label>

          <label className="space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium text-white/70">
              <Lock className="h-4 w-4 text-accent-light" />
              Contrasena
            </span>
            <div className="relative">
              <input
                aria-label="Contrasena"
                className={[
                  "glass-input pr-11",
                  errors.password ? "field-error" : "",
                ].join(" ")}
                onChange={(event) => onUpdateUserField("password", event.target.value)}
                placeholder="Introduce una contrasena"
                type={showPassword ? "text" : "password"}
                value={user.password}
              />
              <button
                aria-label={showPassword ? "Ocultar contrasena" : "Mostrar contrasena"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 transition-colors hover:text-white/70"
                onClick={() => setShowPassword((current) => !current)}
                type="button"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password ? (
              <p className="text-xs text-danger">{errors.password}</p>
            ) : null}
          </label>

          <label className="space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium text-white/70">
              <Lock className="h-4 w-4 text-amber-200" />
              Confirmar contrasena
            </span>
            <div className="relative">
              <input
                aria-label="Confirmar contrasena"
                className={[
                  "glass-input pr-11",
                  errors.passwordConfirmation ? "field-error" : "",
                ].join(" ")}
                onChange={(event) =>
                  onUpdateUserField("passwordConfirmation", event.target.value)
                }
                placeholder="Repite la contrasena"
                type={showConfirmation ? "text" : "password"}
                value={user.passwordConfirmation ?? ""}
              />
              <button
                aria-label={
                  showConfirmation
                    ? "Ocultar confirmacion"
                    : "Mostrar confirmacion"
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 transition-colors hover:text-white/70"
                onClick={() => setShowConfirmation((current) => !current)}
                type="button"
              >
                {showConfirmation ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {errors.passwordConfirmation ? (
              <p className="text-xs text-danger">{errors.passwordConfirmation}</p>
            ) : null}
          </label>
        </motion.div>

        <motion.div
          className="glass-panel flex items-start gap-3 border border-sky-300/10 bg-sky-300/5 p-4"
          variants={fadeUp}
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
          <p className="text-sm text-white/55">
            La cuenta `root` heredara la misma contrasena del usuario principal y
            la validacion remota seguira siendo la fuente final para nombres
            reservados y normalizacion.
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
