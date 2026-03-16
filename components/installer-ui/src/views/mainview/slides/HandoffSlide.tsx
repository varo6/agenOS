import { motion } from "framer-motion";
import { CheckCircle2, ExternalLink, Rocket, Terminal } from "lucide-react";

type HandoffSlideProps = {
  launchMessage: string;
  launchMode: "guided" | "classic" | null;
  onClassicLaunch: () => void;
};

export function HandoffSlide({
  launchMessage,
  launchMode,
  onClassicLaunch,
}: HandoffSlideProps) {
  const isGuided = launchMode === "guided";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col justify-center overflow-y-auto px-2 py-2 text-center">
      <motion.div
        animate="animate"
        className="space-y-8"
        initial="initial"
        variants={{ animate: { transition: { staggerChildren: 0.08 } } }}
      >
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          className="relative mx-auto h-24 w-24"
          initial={{ opacity: 0, scale: 0.55 }}
          transition={{ type: "spring", stiffness: 180, damping: 18 }}
        >
          <div className="absolute inset-0 rounded-full bg-accent/18 animate-ping" />
          <div className="absolute inset-2 flex items-center justify-center rounded-full bg-[linear-gradient(135deg,rgba(244,171,57,0.95),rgba(87,193,123,0.92))] shadow-[0_0_40px_rgba(244,171,57,0.2)]">
            {isGuided ? (
              <Rocket className="h-9 w-9 text-white animate-float" />
            ) : (
              <CheckCircle2 className="h-9 w-9 text-white" />
            )}
          </div>
        </motion.div>

        <motion.div
          variants={{ initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 } }}
        >
          <h2 className="font-display text-4xl font-semibold tracking-tight text-white md:text-5xl">
            Calamares toma el tramo final
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-base text-white/55">
            {isGuided
              ? "El perfil guiado ya se ha preparado y el helper actual conserva el mismo handoff a Calamares."
              : "Se ha solicitado el modo clasico para continuar con el instalador completo de Calamares."}
          </p>
        </motion.div>

        <motion.div
          className="glass-panel mx-auto max-w-2xl p-6 text-left"
          variants={{ initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 } }}
        >
          <div className="flex items-center gap-3">
            <div className="h-2.5 w-2.5 rounded-full bg-success animate-pulse" />
            <p className="text-sm font-medium text-white/70">
              {isGuided ? "Lanzamiento guiado en curso" : "Lanzamiento clasico solicitado"}
            </p>
          </div>
          <p className="mt-4 text-base leading-relaxed text-white/70">
            {launchMessage || "Esperando a que Calamares tome el control..."}
          </p>
        </motion.div>

        <motion.div
          className="space-y-4"
          variants={{ initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 } }}
        >
          <p className="text-sm text-white/40">
            Si necesitas salir del flujo guiado, puedes volver a pedir el modo
            clasico desde aqui o desde el lanzador del sistema live.
          </p>
          <div className="flex items-center justify-center">
            <button
              className="btn-secondary flex items-center gap-2"
              onClick={onClassicLaunch}
              type="button"
            >
              <Terminal className="h-4 w-4" />
              <span>Abrir modo clasico</span>
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
