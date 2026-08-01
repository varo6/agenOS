import { createFileTool, type FileLaunchOptions, type FileOpenResponse } from "./files";

type FileToolLike = {
  openPath(
    input: string | { path?: unknown; workspace?: unknown; focus?: unknown },
    options?: FileLaunchOptions,
  ): Promise<FileOpenResponse>;
};

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

const OPEN_FILE_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Ruta local a abrir. Soporta rutas absolutas y rutas con ~, por ejemplo ~/Fotos/captura.png.",
    },
    workspace: {
      type: "number",
      description: "Workspace de AgenOS donde abrir el archivo: 2 apps, 4 media. Por defecto media para fotos/videos/audio.",
    },
    focus: {
      type: "boolean",
      description: "Cambiar el foco del usuario al workspace. Por defecto true.",
    },
  },
  required: ["path"],
  additionalProperties: false,
};

export function createOpenFileModelTool(fileTool: FileToolLike = createFileTool()): PiCustomToolLike {
  return {
    name: "files_open",
    label: "Abrir archivo",
    description: "Abre archivos, fotos, videos, audio o carpetas locales cuando el usuario lo pide.",
    promptSnippet: "files_open: abre rutas locales como ~/Fotos/imagen.png o ~/Documentos/reporte.pdf.",
    promptGuidelines: [
      "Usa files_open cuando el usuario pida abrir una foto, imagen, video, audio, documento, carpeta o ruta local.",
      "No pidas confirmacion si el usuario actual pide abrir o ver un archivo local.",
      "Si el usuario menciona un workspace, pasa ese numero en workspace.",
    ],
    parameters: OPEN_FILE_TOOL_PARAMETERS,
    async execute(_toolCallId, params, signal, onUpdate) {
      const response = await fileTool.openPath({
        path: params.path,
        workspace: params.workspace,
        focus: typeof params.focus === "boolean" ? params.focus : true,
      }, {
        signal,
        onProgress: (message) => onUpdate?.({
          content: [{ type: "text", text: message }],
          details: { ok: true, status: "starting", message },
        }),
      });
      return {
        content: [{ type: "text", text: response.message ?? "Solicitud de apertura procesada." }],
        details: response,
      };
    },
  };
}
