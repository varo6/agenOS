import { useEffect, useRef, type RefObject } from "react";

/**
 * Mantiene el último valor en una ref.
 *
 * Se usa para que los efectos con temporizadores (sondeo de turnos, de login)
 * dependan solo de su identificador y no de la identidad de los callbacks: así
 * un re-render de la App no reinicia los intervalos.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  });

  return ref;
}
