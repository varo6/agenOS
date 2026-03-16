import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  HardDrive,
  MemoryStick,
  Monitor,
  Shield,
  XCircle,
} from "lucide-react";

import type { WelcomeModel } from "../mappers";

type WelcomeSlideProps = {
  model: WelcomeModel;
};

const statusIcons = {
  ok: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

const statusColors = {
  ok: "text-success",
  warning: "text-warning",
  error: "text-danger",
};

const statusBackgrounds = {
  ok: "border-success/20 bg-success/10",
  warning: "border-warning/20 bg-warning/10",
  error: "border-danger/20 bg-danger/10",
};

const statIcons = [Monitor, MemoryStick, HardDrive];
const stagger = { animate: { transition: { staggerChildren: 0.07 } } };
const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
};

export function WelcomeSlide({ model }: WelcomeSlideProps) {
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
            <Shield className="h-4 w-4" />
            Preparacion del sistema
          </div>
          <h2 className="font-display text-4xl font-semibold tracking-tight text-white md:text-5xl">
            Todo listo para preparar la instalacion
          </h2>
          <p className="mx-auto max-w-2xl text-base text-white/55">
            Revisa el estado del sistema, confirma que el equipo cumple los
            requisitos basicos y continua con la configuracion inicial.
          </p>
        </motion.div>

        <motion.div className="grid grid-cols-1 gap-3 md:grid-cols-3" variants={fadeUp}>
          {model.stats.map((stat, index) => {
            const Icon = statIcons[index] ?? Shield;

            return (
              <article
                className="glass-panel group p-5 text-center transition-colors hover:bg-white/[0.05]"
                key={stat.label}
              >
                <Icon className="mx-auto h-5 w-5 text-accent-light transition-transform group-hover:scale-110" />
                <p className="mt-3 text-xs uppercase tracking-[0.22em] text-white/38">
                  {stat.label}
                </p>
                <p className="mt-2 text-lg font-semibold text-white">{stat.value}</p>
              </article>
            );
          })}
        </motion.div>

        <motion.div className="space-y-3" variants={fadeUp}>
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-medium text-white/70">
              Comprobaciones de preflight
            </h3>
            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs uppercase tracking-[0.22em] text-white/55">
              {model.summaryLabel}
            </span>
          </div>

          <div className="space-y-2">
            {model.checks.map((check, index) => {
              const Icon = statusIcons[check.status];

              return (
                <motion.article
                  className={[
                    "glass-panel flex items-center gap-3 border p-4",
                    statusBackgrounds[check.status],
                  ].join(" ")}
                  key={check.id}
                  transition={{ delay: index * 0.05 }}
                  variants={fadeUp}
                >
                  <Icon className={["h-5 w-5 shrink-0", statusColors[check.status]].join(" ")} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">{check.label}</p>
                    <p className="mt-0.5 text-sm text-white/48">{check.detail}</p>
                  </div>
                  <span
                    className={[
                      "text-xs uppercase tracking-[0.18em]",
                      statusColors[check.status],
                    ].join(" ")}
                  >
                    {check.status}
                  </span>
                </motion.article>
              );
            })}
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
