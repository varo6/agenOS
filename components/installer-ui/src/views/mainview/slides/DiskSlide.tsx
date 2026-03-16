import { motion } from "framer-motion";
import { AlertTriangle, Cpu, Database, HardDrive, Usb } from "lucide-react";

import type { ValidateErrorMap } from "../../../shared/installer-types";
import type { DiskCardModel } from "../mappers";

type DiskSlideProps = {
  disks: DiskCardModel[];
  errors: ValidateErrorMap;
  onSelectDisk: (path: string) => void;
  selectedDiskPath: string;
};

const transportIcons: Record<string, typeof HardDrive> = {
  NVME: Cpu,
  SATA: Database,
  USB: Usb,
};

const stagger = { animate: { transition: { staggerChildren: 0.06 } } };
const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
};

export function DiskSlide({
  disks,
  errors,
  onSelectDisk,
  selectedDiskPath,
}: DiskSlideProps) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col justify-center overflow-y-auto px-2 py-2">
      <motion.div
        animate="animate"
        className="space-y-6"
        initial="initial"
        variants={stagger}
      >
        <motion.div className="space-y-3 text-center" variants={fadeUp}>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-1.5 text-sm font-medium text-emerald-300">
            <HardDrive className="h-4 w-4" />
            Disco de destino
          </div>
          <h2 className="font-display text-4xl font-semibold tracking-tight text-white md:text-5xl">
            Elige el disco de destino
          </h2>
          <p className="mx-auto max-w-2xl text-base text-white/55">
            La iteracion v1 sigue soportando solo instalacion sobre disco completo.
            Todo el contenido del disco seleccionado se destruira.
          </p>
        </motion.div>

        <motion.div
          className="glass-panel border border-danger/30 bg-danger/10 p-4"
          variants={fadeUp}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger animate-pulse-glow" />
            <div>
              <p className="text-sm font-semibold text-danger">
                Borrado total del disco
              </p>
              <p className="mt-1 text-sm text-white/55">
                No hay particionado manual en este modo guiado. Si necesitas un
                layout avanzado, usa el modo clasico desde la navegacion.
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div className="space-y-3" variants={fadeUp}>
          {disks.map((disk, index) => {
            const Icon = transportIcons[disk.transportLabel] ?? HardDrive;
            const isSelected = disk.path === selectedDiskPath;

            return (
              <motion.button
                className={[
                  "glass-panel flex w-full items-center gap-4 p-5 text-left transition-all",
                  isSelected
                    ? "border border-accent/45 bg-accent/10 shadow-[0_0_30px_rgba(244,171,57,0.14)]"
                    : "hover:bg-white/[0.05]",
                ].join(" ")}
                key={disk.path}
                onClick={() => onSelectDisk(disk.path)}
                transition={{ delay: index * 0.04 }}
                type="button"
                variants={fadeUp}
              >
                <div
                  className={[
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
                    isSelected ? "bg-accent/18" : "bg-white/6",
                  ].join(" ")}
                >
                  <Icon
                    className={[
                      "h-6 w-6",
                      isSelected ? "text-accent-light" : "text-white/40",
                    ].join(" ")}
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-white">
                      {disk.vendorModel}
                    </p>
                    <span
                      className={[
                        "rounded-full px-2 py-0.5 font-mono text-[11px]",
                        isSelected
                          ? "bg-accent/20 text-accent-light"
                          : "bg-white/8 text-white/40",
                      ].join(" ")}
                    >
                      {disk.transportLabel}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-mono text-white/38">{disk.path}</p>
                </div>

                <div className="text-right">
                  <p
                    className={[
                      "text-lg font-bold",
                      isSelected ? "text-accent-light" : "text-white/68",
                    ].join(" ")}
                  >
                    {disk.sizeLabel}
                  </p>
                </div>
              </motion.button>
            );
          })}
        </motion.div>

        {errors.targetDisk ? (
          <motion.p
            animate={{ opacity: 1 }}
            className="text-center text-sm text-danger"
            initial={{ opacity: 0 }}
          >
            {errors.targetDisk}
          </motion.p>
        ) : null}
      </motion.div>
    </div>
  );
}
