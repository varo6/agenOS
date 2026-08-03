import type { PiTurnProgress } from "./pi-types";

/**
 * Qué está haciendo Pi, contado como se lo contarías a alguien que no sabe qué
 * es una "tool". La clave es el nombre técnico de la herramienta; el valor, la
 * frase que ve la persona.
 */
const TOOL_ACTIVITY_LABELS: Record<string, string> = {
  openclaw_setup: "configurando el asistente",
  apps_open: "abriendo una aplicación",
  apps_install: "instalando una aplicación",
  files_open: "abriendo un archivo",
  browser_open: "abriendo una página web",
  workspaces_focus: "cambiando de escritorio",
  memory_append: "guardando lo que le has pedido recordar",
  learning_memory: "repasando lo que ha aprendido de ti",
  agent_task: "trabajando en segundo plano",
  bash: "ejecutando una tarea del sistema",
  read: "leyendo archivos",
  edit: "editando archivos",
  write: "escribiendo archivos",
  grep: "buscando dentro de tus archivos",
  find: "buscando archivos",
  ls: "revisando una carpeta",
};

/** Frase en llano para una herramienta concreta. */
export function describeTool(tool: string): string {
  return TOOL_ACTIVITY_LABELS[tool] ?? "trabajando en tu petición";
}

export function hasToolLabel(tool: string): boolean {
  return tool in TOOL_ACTIVITY_LABELS;
}

/**
 * Actividad actual de un turno en curso. Devuelve `null` cuando no hay turno,
 * para que quien llame decida el texto de reposo.
 */
export function describeTurnActivity(turn: PiTurnProgress | null | undefined): string | null {
  if (!turn) {
    return null;
  }

  if (turn.currentTool) {
    return `Pi está ${describeTool(turn.currentTool)}…`;
  }

  if (turn.completedTools.length > 0) {
    return "Pi está revisando lo que ha encontrado…";
  }

  return "Pi está pensando…";
}
