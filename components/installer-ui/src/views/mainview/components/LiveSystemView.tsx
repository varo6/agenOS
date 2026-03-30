import { Mic } from "lucide-react";

export function LiveSystemView({
  isInstalled,
  isSwitching,
  onOpenInstaller,
}: {
  isInstalled: boolean;
  isSwitching: boolean;
  onOpenInstaller?: () => void;
}) {
  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-24">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(255,216,140,0.14),transparent_18%),radial-gradient(circle_at_50%_58%,rgba(123,191,255,0.10),transparent_22%)]" />

      <section className="relative flex w-full max-w-4xl flex-col items-center gap-8 text-center">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.42em] text-white/48">
            {isInstalled ? "Installed System" : "Live System"}
          </p>
          <h1 className="font-display text-5xl tracking-tight text-white sm:text-6xl">
            AgenOS
          </h1>
          <p className="mx-auto max-w-xl text-base text-white/60 sm:text-lg">
            El placeholder del sistema ya vive aqui. De momento solo expone el micro
            centrado y queda listo para crecer como app principal.
          </p>
        </div>

        <div className="relative">
          <div className="absolute inset-[-36px] rounded-full bg-[radial-gradient(circle,rgba(244,171,57,0.26),transparent_62%)] blur-2xl" />
          <div className="glass-panel animate-float relative flex h-48 w-48 items-center justify-center rounded-full border border-white/14 sm:h-56 sm:w-56">
            <div className="animate-pulse-glow flex h-28 w-28 items-center justify-center rounded-full bg-[linear-gradient(135deg,rgba(255,232,187,0.98),rgba(244,171,57,0.92))] text-[#1f1208] shadow-[0_24px_60px_rgba(244,171,57,0.24)]">
              <Mic className="h-12 w-12 sm:h-14 sm:w-14" strokeWidth={2.2} />
            </div>
          </div>
        </div>

        <div className="glass-panel w-full max-w-2xl px-6 py-5 text-sm text-white/62">
          <p>
            {isSwitching
              ? "Cambiando al live system..."
              : "El flujo de sistema queda cargado en esta app dedicada. Cuando el sistema este instalado, esta sera la unica UI visible."}
          </p>
        </div>

        {onOpenInstaller ? (
          <button
            className="btn-secondary"
            onClick={onOpenInstaller}
            type="button"
          >
            Volver al instalador
          </button>
        ) : null}
      </section>
    </div>
  );
}
