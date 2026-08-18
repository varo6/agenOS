import type { createFilesContentService, FilesContentEntry } from "./files-content";

type FilesContentService = ReturnType<typeof createFilesContentService>;

type ToolUpdateCallback = (update: {
  content: Array<{ type: "text"; text: string }>;
  details: unknown;
}) => void;

type PiCustomToolLike = {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
  parameters: unknown;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: ToolUpdateCallback,
    ctx?: unknown,
  ): Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }>;
};

const FILES_MANAGE_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["read", "write", "append", "list", "search"],
      description: "read lee un archivo, write lo crea o sobrescribe, append añade al final, list muestra una carpeta y search busca por nombre de archivo.",
    },
    path: {
      type: "string",
      description: "Ruta del archivo o carpeta. Acepta ~ para la carpeta del usuario, por ejemplo ~/Documentos/notas.md. En search es la carpeta raíz de la búsqueda.",
    },
    content: {
      type: "string",
      description: "Texto a escribir o añadir. Obligatorio en write y append.",
    },
    query: {
      type: "string",
      description: "Texto a buscar dentro de los nombres de archivo. Obligatorio en search.",
    },
  },
  required: ["action"],
  additionalProperties: false,
};

export function createFilesContentModelTool(service: FilesContentService): PiCustomToolLike {
  return {
    name: "files_manage",
    label: "Leer y escribir archivos",
    description: "Lee, escribe, añade, lista y busca archivos del usuario por su ruta.",
    promptSnippet: "files_manage: lee, escribe, añade, lista y busca archivos y carpetas del usuario, por ejemplo ~/Documentos/notas.md.",
    promptGuidelines: [
      "Usa files_manage para leer y escribir documentos del usuario, notas, listas y archivos de configuración.",
      "Antes de modificar un archivo que ya existe, léelo con action=read para no perder lo que había.",
      "Usa action=append cuando el usuario quiera añadir algo a una nota o lista sin borrar el contenido anterior.",
      "Si no sabes la ruta exacta, usa action=search desde ~ o action=list para localizar el archivo antes de tocarlo.",
      "Para operaciones complejas o de sistema (permisos, mover en masa, comprimir, procesos, paquetes) usa computer_run.",
      "Nunca afirmes haber leído o escrito un archivo sin haber llamado a este tool y visto su resultado.",
    ],
    parameters: FILES_MANAGE_TOOL_PARAMETERS,
    async execute(_toolCallId, params) {
      const action = typeof params.action === "string" ? params.action.trim() : "";
      const path = typeof params.path === "string" ? params.path : "";
      const content = typeof params.content === "string" ? params.content : undefined;
      const query = typeof params.query === "string" ? params.query : "";

      if (action === "read") {
        if (!path.trim()) {
          return invalid(action, "Necesito la ruta del archivo que quieres leer.");
        }
        const result = await service.read(path);
        if (!result.ok) {
          return { content: [{ type: "text", text: result.message }], details: { action, ...result } };
        }
        const body = result.content.length ? result.content : "(el archivo está vacío)";
        const notice = result.truncated ? "\n[contenido truncado]" : "";
        return {
          content: [{ type: "text", text: `${result.path}:\n${body}${notice}` }],
          details: { action, ...result },
        };
      }

      if (action === "write" || action === "append") {
        if (!path.trim()) {
          return invalid(action, `Necesito la ruta del archivo en el que quieres ${action === "write" ? "escribir" : "añadir texto"}.`);
        }
        if (content === undefined) {
          return invalid(action, `Necesito el texto a ${action === "write" ? "escribir" : "añadir"} en el parámetro content.`);
        }
        const result = action === "write" ? await service.write(path, content) : await service.append(path, content);
        return { content: [{ type: "text", text: result.message }], details: { action, ...result } };
      }

      if (action === "list") {
        if (!path.trim()) {
          return invalid(action, "Necesito la ruta de la carpeta que quieres listar.");
        }
        const result = await service.list(path);
        if (!result.ok) {
          return { content: [{ type: "text", text: result.message }], details: { action, ...result } };
        }
        const listing = result.entries.map(formatEntry).join("\n");
        return {
          content: [{ type: "text", text: listing ? `${result.message}\n${listing}` : result.message }],
          details: { action, ...result },
        };
      }

      if (action === "search") {
        if (!path.trim()) {
          return invalid(action, "Necesito la carpeta desde la que buscar, por ejemplo ~ o ~/Documentos.");
        }
        if (!query.trim()) {
          return invalid(action, "Necesito el texto a buscar en el parámetro query.");
        }
        const result = await service.search(path, query);
        if (!result.ok) {
          return { content: [{ type: "text", text: result.message }], details: { action, ...result } };
        }
        const listing = result.matches.map((match) => (match.isDirectory ? `${match.path}/` : match.path)).join("\n");
        return {
          content: [{ type: "text", text: listing ? `${result.message}\n${listing}` : result.message }],
          details: { action, ...result },
        };
      }

      return invalid(action, "Acción no válida: usa read, write, append, list o search.");
    },
  };
}

function formatEntry(entry: FilesContentEntry): string {
  if (entry.isDirectory) {
    return `${entry.name}/`;
  }
  return typeof entry.size === "number" ? `${entry.name} (${entry.size} bytes)` : entry.name;
}

function invalid(action: string, message: string): { content: Array<{ type: "text"; text: string }>; details: unknown } {
  return {
    content: [{ type: "text", text: message }],
    details: { ok: false, action, message },
  };
}
