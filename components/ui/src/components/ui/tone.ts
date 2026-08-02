import type { Tone } from "../../lib/tone";

export type { Tone };

/**
 * Traducción de los tonos semánticos a clases. Un solo mapa evita que cada
 * panel elija su propio verde o su propio rojo.
 */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-ink-muted",
  accent: "text-accent-light",
  positive: "text-positive",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
};

export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-ink-faint",
  accent: "bg-accent",
  positive: "bg-positive",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export const TONE_SURFACE: Record<Tone, string> = {
  neutral: "border-line bg-surface-strong text-ink-muted",
  accent: "border-accent/35 bg-accent/10 text-accent-light",
  positive: "border-positive/35 bg-positive/10 text-positive",
  warning: "border-warning/35 bg-warning/10 text-warning",
  danger: "border-danger/40 bg-danger/12 text-danger",
  info: "border-info/35 bg-info/10 text-info",
};
