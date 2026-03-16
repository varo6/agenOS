import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";

type GlobalErrorProps = {
  error: string | null;
  onDismiss: () => void;
};

export function GlobalError({ error, onDismiss }: GlobalErrorProps) {
  return (
    <AnimatePresence>
      {error ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="fixed left-1/2 top-4 z-50 w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2"
          exit={{ opacity: 0, y: -16 }}
          initial={{ opacity: 0, y: -16 }}
          role="alert"
        >
          <div className="glass-panel flex items-start gap-3 border border-danger/30 bg-danger/10 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">
                No se pudo continuar con el instalador
              </p>
              <p className="mt-1 text-sm text-white/65">{error}</p>
            </div>
            <button
              aria-label="Cerrar error"
              className="rounded-full p-1 text-white/45 transition-colors hover:text-white"
              onClick={onDismiss}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
