import { motion } from "framer-motion";
import {
  AlertTriangle,
  Clock3,
  Globe,
  HardDrive,
  Keyboard,
  ShieldAlert,
  UserRound,
} from "lucide-react";

import type { InstallerProfilePayload } from "../../../shared/installer-types";
import type { DiskCardModel } from "../mappers";

type ConfirmSlideProps = {
  profile: InstallerProfilePayload;
  selectedDisk: DiskCardModel | null;
};

const stagger = { animate: { transition: { staggerChildren: 0.07 } } };
const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
};

function SummaryRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Globe;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Icon className="h-4 w-4 text-accent-light/85" />
      <span className="w-28 shrink-0 text-xs uppercase tracking-[0.18em] text-white/35">
        {label}
      </span>
      <span className="truncate text-sm font-medium text-white">{value}</span>
    </div>
  );
}

export function ConfirmSlide({ profile, selectedDisk }: ConfirmSlideProps) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col justify-center overflow-y-auto px-2 py-2">
      <motion.div
        animate="animate"
        className="space-y-6"
        initial="initial"
        variants={stagger}
      >
        <motion.div className="space-y-3 text-center" variants={fadeUp}>
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent-light">
            <ShieldAlert className="h-4 w-4" />
            Revision final
          </div>
          <h2 className="font-display text-4xl font-semibold tracking-tight text-white md:text-5xl">
            Revision final antes del handoff
          </h2>
          <p className="mx-auto max-w-2xl text-base text-white/55">
            Este flujo guiado sigue escribiendo el mismo `profile.json` y entrega
            el ultimo tramo a Calamares. El cambio en esta iteracion es solo
            visual.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.08fr_0.92fr]">
          <motion.div className="glass-panel p-6" variants={fadeUp}>
            <p className="text-xs uppercase tracking-[0.28em] text-emerald-200/55">
              Destino
            </p>
            <div className="mt-4 space-y-2">
              <SummaryRow
                icon={HardDrive}
                label="Disco"
                value={selectedDisk?.path ?? "Sin seleccionar"}
              />
              <SummaryRow
                icon={HardDrive}
                label="Modelo"
                value={selectedDisk?.vendorModel ?? "Selecciona un disco"}
              />
              <SummaryRow
                icon={HardDrive}
                label="Tamano"
                value={selectedDisk?.sizeLabel ?? "Sin dato"}
              />
            </div>
          </motion.div>

          <motion.div className="glass-panel p-6" variants={fadeUp}>
            <p className="text-xs uppercase tracking-[0.28em] text-amber-100/55">
              Identidad
            </p>
            <div className="mt-4 space-y-2">
              <SummaryRow
                icon={UserRound}
                label="Nombre"
                value={profile.user.fullName || "Sin nombre"}
              />
              <SummaryRow
                icon={UserRound}
                label="Usuario"
                value={profile.user.username || "Sin usuario"}
              />
              <SummaryRow
                icon={UserRound}
                label="Hostname"
                value={profile.user.hostname || "Sin hostname"}
              />
            </div>
          </motion.div>

          <motion.div className="glass-panel p-6 lg:col-span-2" variants={fadeUp}>
            <p className="text-xs uppercase tracking-[0.28em] text-white/45">
              Regional y teclado
            </p>
            <div className="mt-4 grid grid-cols-1 gap-x-8 md:grid-cols-2">
              <SummaryRow icon={Globe} label="Locale" value={profile.locale} />
              <SummaryRow icon={Clock3} label="Timezone" value={profile.timezone} />
              <SummaryRow
                icon={Keyboard}
                label="Layout"
                value={profile.keyboardLayout}
              />
              <SummaryRow
                icon={Keyboard}
                label="Variante"
                value={profile.keyboardVariant || "Predeterminada"}
              />
            </div>
          </motion.div>
        </div>

        <motion.div
          className="glass-panel border border-danger/35 bg-danger/10 p-5"
          variants={fadeUp}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger animate-pulse-glow" />
            <div>
              <p className="text-sm font-semibold text-danger">
                Accion destructiva e irreversible
              </p>
              <p className="mt-1 text-sm leading-relaxed text-white/58">
                Al continuar se escribira un `profile.json` temporal y se abrira
                Calamares con el perfil guiado minimo. El disco seleccionado sera
                el candidato de borrado completo.
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
