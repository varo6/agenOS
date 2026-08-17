import { memo } from "react";
import {
  AlertTriangle,
  AudioLines,
  Check,
  LoaderCircle,
  Mic,
  MicOff,
} from "lucide-react";

import { cx } from "../../lib/cx";
import type { Tone } from "../../lib/tone";
import type { VoicePhase, VoiceStatus } from "../../lib/voice-status";

type OrbSkin = { ring: string; glow: string; icon: string };

/**
 * Piel del orbe por tono. El color nunca va solo: siempre lo acompañan un icono
 * distinto y un texto, para que la fase se entienda sin distinguir colores.
 */
const ORB_SKIN: Record<Tone, OrbSkin> = {
  neutral: { ring: "border-line-strong", glow: "bg-white/10", icon: "text-ink-muted" },
  info: { ring: "border-listening", glow: "bg-listening/30", icon: "text-listening" },
  accent: { ring: "border-accent", glow: "bg-accent/25", icon: "text-accent" },
  positive: { ring: "border-positive", glow: "bg-positive/25", icon: "text-positive" },
  warning: { ring: "border-warning", glow: "bg-warning/20", icon: "text-warning" },
  danger: { ring: "border-danger", glow: "bg-danger/20", icon: "text-danger" },
};

const PHASE_ICON: Record<VoicePhase, typeof Mic> = {
  idle: Mic,
  listening: Mic,
  transcribing: AudioLines,
  thinking: LoaderCircle,
  working: LoaderCircle,
  done: Check,
  error: AlertTriangle,
  blocked: MicOff,
  unavailable: MicOff,
};

/**
 * `full` es el orbe protagonista de la pantalla de reposo. `compact` lo reduce a
 * un botón que cabe al lado del campo de escribir: el sitio que deja se lo queda
 * la respuesta de Pi, que sin voz de vuelta hay que leer sin tener que
 * desplazarse. En `compact` el orbe va solo, así que quien lo use tiene que
 * pintar `status.title` al lado: la fase nunca puede quedarse dicha solo con el
 * color del orbe.
 */
export type VoiceConsoleSize = "full" | "compact";

export type VoiceConsoleProps = {
  status: VoiceStatus;
  /** Etiqueta accesible del botón, dependiente de la fase. */
  buttonLabel: string;
  onActivate: () => void;
  onCancel: () => void;
  size?: VoiceConsoleSize;
  className?: string;
};

function VoiceConsoleComponent({
  status,
  buttonLabel,
  onActivate,
  onCancel,
  size = "full",
  className,
}: VoiceConsoleProps) {
  const skin = ORB_SKIN[status.tone];
  const Icon = PHASE_ICON[status.phase];
  const isCapturing = status.phase === "listening" || status.phase === "transcribing";
  const isSpinning = status.phase === "thinking" || status.phase === "working";
  const isInteractive = status.canListen || status.phase === "listening";
  const compact = size === "compact";

  return (
    <div className={cx("flex flex-col items-center", compact ? "gap-0" : "gap-7", className)}>
      <button
        /*
         * Nunca se deshabilita del todo: así quien navega con teclado o lector
         * de pantalla puede llegar al botón y oír por qué no puede hablar
         * ahora. La acción se ignora cuando no procede.
         */
        aria-disabled={isInteractive ? undefined : "true"}
        aria-label={buttonLabel}
        /*
         * El objetivo más grande de todo el sistema, y con diferencia: es el
         * gesto principal de un SO por voz y tiene que poder pulsarse sin
         * puntería, incluso con la mano temblorosa.
         */
        className={cx(
          "relative grid place-items-center rounded-pill border-2 bg-surface transition-colors duration-300",
          /*
           * Incluso encogido se queda muy por encima de los 44px de objetivo
           * táctil: sigue siendo el botón más grande de la fila.
           */
          compact ? "h-20 w-20 sm:h-24 sm:w-24" : "h-40 w-40 sm:h-52 sm:w-52",
          skin.ring,
          isInteractive ? "hover:bg-surface-strong" : "cursor-not-allowed opacity-60",
        )}
        onClick={() => {
          if (status.phase === "listening") {
            onCancel();
            return;
          }

          if (status.canListen) {
            onActivate();
          }
        }}
        type="button"
      >
        {/* Halo: solo transform y opacidad, para que lo resuelva la GPU. */}
        {status.busy ? (
          <span
            aria-hidden="true"
            className={cx("absolute inset-0 animate-breathe rounded-pill", skin.glow)}
          />
        ) : null}

        {isCapturing ? (
          <span
            aria-hidden="true"
            className={cx("absolute inset-2 rounded-pill border", skin.ring, "opacity-40")}
          />
        ) : null}

        <Icon
          aria-hidden="true"
          className={cx(
            "relative transition-colors",
            compact ? "h-9 w-9 sm:h-11 sm:w-11" : "h-12 w-12 sm:h-16 sm:w-16",
            skin.icon,
            isSpinning && "animate-spin",
          )}
          strokeWidth={1.5}
        />
      </button>

      {/* Estas dos líneas son la etiqueta visible del orbe: dicen en qué fase
          está y qué se espera de la persona, y nunca desaparecen. */}
      {compact ? null : (
        <div className="max-w-md text-center">
          <p className="font-display text-2xl font-medium tracking-tight text-ink sm:text-3xl">
            {status.title}
          </p>
          <p className="mt-2 text-base text-ink-muted">{status.hint}</p>
        </div>
      )}

      {/*
       * Anuncio para lectores de pantalla. En una interfaz por voz el cambio de
       * fase es la información principal, y sale de la misma fuente que el
       * texto visible para que nunca se contradigan.
       */}
      <p aria-live="polite" className="sr-only" role="status">
        {status.announcement}
      </p>
    </div>
  );
}

export const VoiceConsole = memo(VoiceConsoleComponent);
