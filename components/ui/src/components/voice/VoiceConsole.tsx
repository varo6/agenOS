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

export type VoiceConsoleProps = {
  status: VoiceStatus;
  /** Etiqueta accesible del botón, dependiente de la fase. */
  buttonLabel: string;
  onActivate: () => void;
  onCancel: () => void;
  className?: string;
};

function VoiceConsoleComponent({
  status,
  buttonLabel,
  onActivate,
  onCancel,
  className,
}: VoiceConsoleProps) {
  const skin = ORB_SKIN[status.tone];
  const Icon = PHASE_ICON[status.phase];
  const isCapturing = status.phase === "listening" || status.phase === "transcribing";
  const isSpinning = status.phase === "thinking" || status.phase === "working";
  const isInteractive = status.canListen || status.phase === "listening";

  return (
    <div className={cx("flex flex-col items-center gap-7", className)}>
      <button
        /*
         * Nunca se deshabilita del todo: así quien navega con teclado o lector
         * de pantalla puede llegar al botón y oír por qué no puede hablar
         * ahora. La acción se ignora cuando no procede.
         */
        aria-disabled={isInteractive ? undefined : "true"}
        aria-label={buttonLabel}
        className={cx(
          "relative grid h-32 w-32 place-items-center rounded-pill border-2 bg-surface transition-colors duration-300 sm:h-40 sm:w-40",
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
            "relative h-9 w-9 transition-colors sm:h-11 sm:w-11",
            skin.icon,
            isSpinning && "animate-spin",
          )}
          strokeWidth={1.5}
        />
      </button>

      <div className="max-w-md text-center">
        <p className="font-display text-xl font-medium tracking-tight text-ink sm:text-2xl">
          {status.title}
        </p>
        <p className="mt-2 text-sm leading-6 text-ink-muted">{status.hint}</p>
      </div>

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
