import type { AgentConfirmation } from "./system-types";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

/** Solo campos que la persona necesita revisar, nunca un volcado del payload. */
export function confirmationDetails(confirmation: AgentConfirmation) {
  const input = record(confirmation.input);
  let data = input;
  let title = "Revisar acción";
  let fields: [string, string][] = [];
  if (confirmation.tool === "google.send") {
    data = record(input.input);
    const action = input.action;
    title = action === "sendMessage" ? "Enviar correo"
      : action === "replyToMessage" ? "Responder al correo"
      : action === "createEvent" ? "Crear cita"
      : action === "deleteEvent" ? "Borrar cita" : "Cambiar tu cuenta de Google";
    fields = [["to", "Para"], ["cc", "Copia"], ["bcc", "Copia oculta"], ["subject", "Asunto"], ["body", "Mensaje"],
      ["summary", "Título"], ["start", "Inicio"], ["end", "Fin"], ["description", "Descripción"], ["location", "Lugar"], ["id", "Referencia"]];
  } else if (confirmation.tool === "shell.exec") {
    title = "Ejecutar un comando";
    fields = [["command", "Comando"], ["cwd", "Carpeta"]];
  } else if (confirmation.tool === "files.write") {
    title = "Escribir un archivo";
    fields = [["path", "Archivo"], ["content", "Contenido"]];
  } else if (confirmation.tool === "packages.install") {
    title = "Instalar una aplicación";
    fields = [["displayName", "Aplicación"], ["packageName", "Paquete"]];
  } else if (confirmation.tool === "memory.write") {
    title = "Recordar información";
    fields = [["content", "Información"]];
  }
  return {
    title,
    fields: fields.flatMap(([key, label]) => typeof data[key] === "string" && data[key]
      ? [{ label, value: data[key] as string }] : []),
  };
}

export function isLearningProposal(confirmation: AgentConfirmation): boolean {
  return confirmation.tool === "memory.write" && Boolean(record(confirmation.input).learned);
}
