import {
  launchBrowserUrl,
  type BrowserLauncherOptions,
  type BrowserLaunchResult,
} from "./browser-launcher";
import type { GraphicalLaunchStatus } from "./graphical-launcher";

export type BrowserOpenResponse = {
  ok: boolean;
  url?: string;
  status?: GraphicalLaunchStatus;
  message: string;
};

type BrowserLauncherLike = (
  url: string,
  options?: BrowserLauncherOptions,
) => BrowserLaunchResult | BrowserOpenResponse | Promise<BrowserLaunchResult | BrowserOpenResponse>;

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
  ): Promise<{ content: Array<{ type: "text"; text: string }>; details: BrowserOpenResponse }>;
};

const OPEN_BROWSER_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    url: {
      type: "string",
      description: "URL http/https que se quiere abrir. Para sitios conocidos usa su URL canónica, por ejemplo https://www.youtube.com/.",
    },
    workspace: {
      type: "number",
      description: "Workspace de AgenOS donde abrir el navegador. Por defecto 3 (web).",
    },
    focus: {
      type: "boolean",
      description: "Cambiar el foco cuando la ventana del navegador aparezca. Por defecto true.",
    },
  },
  required: ["url"],
  additionalProperties: false,
};

export function createOpenBrowserModelTool(
  browserLauncher: BrowserLauncherLike = launchBrowserUrl,
  launcherOptions: BrowserLauncherOptions = {},
): PiCustomToolLike {
  return {
    name: "browser_open",
    label: "Abrir web",
    description: "Abre una URL o un sitio web en Chromium y confirma que su ventana aparece.",
    promptSnippet: "browser_open: abre sitios web y URLs en Chromium; por ejemplo YouTube se abre como https://www.youtube.com/.",
    promptGuidelines: [
      "Usa browser_open cuando el usuario pida abrir una web, URL o servicio web como YouTube, Netflix o Gmail.",
      "Convierte nombres de sitios conocidos a su URL https canónica antes de llamar la herramienta.",
      "Ante una intención sin sitio concreto (jugar al ajedrez, leer el correo, ver el tiempo), elige tú el sitio gratuito y sin registro más conocido y ábrelo; no preguntes cuál de dos webs prefiere.",
      "Si no hay aplicación local para lo que pide, abre la web equivalente en vez de responder que no se puede.",
      "No uses apps_open para un sitio web; apps_open es solo para aplicaciones locales instaladas.",
      "Deja workspace en 3 y focus en true salvo que el usuario pida otra cosa.",
    ],
    parameters: OPEN_BROWSER_TOOL_PARAMETERS,
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        const result = await browserLauncher(
          typeof params.url === "string" ? params.url : "",
          {
            ...launcherOptions,
            workspace: params.workspace ?? launcherOptions.workspace ?? 3,
            focus: typeof params.focus === "boolean" ? params.focus : launcherOptions.focus !== false,
            signal,
            onProgress: (message) => {
              launcherOptions.onProgress?.(message);
              onUpdate?.({
                content: [{ type: "text", text: message }],
                details: { ok: true, status: "starting", message },
              });
            },
          },
        );
        const response: BrowserOpenResponse = {
          ok: result.ok,
          url: result.url,
          status: result.status,
          message: result.message,
        };
        return {
          content: [{ type: "text", text: response.message }],
          details: response,
        };
      } catch (error) {
        const response: BrowserOpenResponse = {
          ok: false,
          message: error instanceof Error ? error.message : "No pude abrir Chromium.",
        };
        return {
          content: [{ type: "text", text: response.message }],
          details: response,
        };
      }
    },
  };
}
