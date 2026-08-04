/**
 * Pantalla de arranque. Cuenta en lenguaje llano qué se está comprobando en vez
 * de dejar un spinner mudo, y no promete nada que no pueda cumplir.
 */
export function BootScreen() {
  return (
    <div
      aria-busy="true"
      className="fixed inset-0 z-40 flex items-center justify-center bg-canvas/85 px-6 backdrop-blur-sm"
      role="status"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <span aria-hidden="true" className="relative grid h-16 w-16 place-items-center">
          <span className="absolute inset-0 animate-breathe rounded-pill bg-accent/25" />
          <span className="relative h-3 w-3 rounded-pill bg-accent" />
        </span>
        <div>
          <p className="font-display text-lg font-medium text-ink">Preparando AgenOS</p>
          <p className="mt-2 text-sm leading-6 text-ink-muted">
            Un momento: estoy comprobando el micrófono, la red y tu cuenta.
          </p>
        </div>
      </div>
    </div>
  );
}
