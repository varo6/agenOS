import { useCallback, useMemo, useState } from "react";

import { toUserError, type ToUserErrorOptions, type UserError } from "../lib/user-errors";

/**
 * Punto de entrada de errores para el resto de hooks.
 *
 * Es deliberadamente estable (todas sus funciones tienen dependencias vacías)
 * para poder pasarlo a hooks y efectos sin provocar re-suscripciones.
 */
export type AlertSink = {
  /** Publica un fallo ya traducido a lenguaje llano y lo devuelve. */
  raise: (error: unknown, options?: ToUserErrorOptions) => UserError;
  clear: () => void;
  /** Limpia el aviso solo si cumple una condición (p. ej. ya se ha recuperado). */
  clearIf: (predicate: (current: UserError) => boolean) => void;
};

export type SystemAlertController = {
  alert: UserError | null;
  sink: AlertSink;
};

export function useSystemAlert(): SystemAlertController {
  const [alert, setAlert] = useState<UserError | null>(null);

  const raise = useCallback((error: unknown, options?: ToUserErrorOptions) => {
    const next = toUserError(error, options);
    setAlert(next);
    return next;
  }, []);

  const clear = useCallback(() => {
    setAlert(null);
  }, []);

  const clearIf = useCallback((predicate: (current: UserError) => boolean) => {
    setAlert((current) => (current && predicate(current) ? null : current));
  }, []);

  const sink = useMemo<AlertSink>(() => ({ raise, clear, clearIf }), [raise, clear, clearIf]);

  return { alert, sink };
}
