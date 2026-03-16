import { motion } from "framer-motion";
import { LoaderCircle } from "lucide-react";

export function LoadingScreen() {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-6">
      <motion.div
        animate={{ opacity: 1, scale: 1 }}
        className="glass-panel flex w-full max-w-lg flex-col items-center gap-6 px-8 py-10 text-center"
        initial={{ opacity: 0, scale: 0.96 }}
      >
        <div className="relative h-20 w-20">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-full border border-white/8 bg-white/6 p-4">
              <LoaderCircle className="h-7 w-7 animate-spin text-accent-light" />
            </div>
          </div>
        </div>

        <div>
          <h2 className="font-display text-3xl font-semibold text-white">
            Preparando instalador
          </h2>
          <p className="mt-2 text-sm text-white/55">
            Detectando hardware, comprobando la sesion live y leyendo los discos
            disponibles.
          </p>
        </div>

        <div className="h-1.5 w-56 overflow-hidden rounded-full bg-white/6">
          <div className="animate-shimmer h-full rounded-full" />
        </div>
      </motion.div>
    </div>
  );
}
