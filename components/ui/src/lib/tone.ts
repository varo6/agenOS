/**
 * Tonos semánticos del shell. Vive en `lib` (y no en los componentes) para que
 * la lógica pura pueda decidir el tono sin depender de la capa de render.
 */
export type Tone = "neutral" | "accent" | "positive" | "warning" | "danger" | "info";
