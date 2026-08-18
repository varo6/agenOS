import type {
  DesktopCapabilitiesResult,
  DesktopInspectResult,
  DesktopKeysResult,
  DesktopMouseButton,
  DesktopMouseResult,
  DesktopScreenshotResult,
  DesktopScrollDirection,
  DesktopScrollResult,
  DesktopTypeResult,
  DesktopWindowActionResult,
} from "./desktop-control";

// Tool de modelo para manejar el escritorio nativo (Sway/Wayland).
// Sigue el patron del resto de tools del repo: cada fichero redeclara
// PiCustomToolLike para no acoplarse a la version de pi-ai.

type DesktopControllerLike = {
  inspect(): Promise<DesktopInspectResult>;
  focusWindow(id: unknown): Promise<DesktopWindowActionResult>;
  closeWindow(id: unknown): Promise<DesktopWindowActionResult>;
  typeText(text: unknown): Promise<DesktopTypeResult>;
  pressKeys(combo: unknown): Promise<DesktopKeysResult>;
  moveMouse(x: unknown, y: unknown): Promise<DesktopMouseResult>;
  click(
    button?: DesktopMouseButton,
    options?: { x?: unknown; y?: unknown; double?: boolean },
  ): Promise<DesktopMouseResult>;
  scroll(direction: DesktopScrollDirection, amount?: unknown): Promise<DesktopScrollResult>;
  screenshot(path?: string): Promise<DesktopScreenshotResult>;
  capabilities(): Promise<DesktopCapabilitiesResult>;
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

export const DESKTOP_CONTROL_ACTIONS = [
  "inspect",
  "focus",
  "close",
  "type",
  "keys",
  "mouse_move",
  "click",
  "scroll",
  "screenshot",
  "capabilities",
] as const;

export type DesktopControlAction = (typeof DESKTOP_CONTROL_ACTIONS)[number];

// Acciones cuyo efecto solo se ve mirando el escritorio despues.
const ACTIONS_WITH_FOLLOW_UP_INSPECT = new Set<DesktopControlAction>(["focus", "click", "type", "keys"]);

const DESKTOP_CONTROL_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [...DESKTOP_CONTROL_ACTIONS],
      description:
        "Que hacer: inspect (listar ventanas y foco), focus, close, type (escribir texto), keys (atajo de teclado), mouse_move, click, scroll, screenshot, capabilities.",
    },
    id: {
      type: "number",
      description: "Id de la ventana (con_id de Sway) para focus y close. Sale de inspect.",
    },
    text: {
      type: "string",
      description: "Texto exacto a escribir en la ventana enfocada cuando action es type.",
    },
    combo: {
      type: "string",
      description: "Atajo de teclado cuando action es keys, por ejemplo 'ctrl+s', 'alt+Tab', 'ctrl+shift+t', 'Return' o 'Escape'.",
    },
    x: {
      type: "number",
      description: "Coordenada X en pixeles para mouse_move o para clicar en un punto concreto.",
    },
    y: {
      type: "number",
      description: "Coordenada Y en pixeles para mouse_move o para clicar en un punto concreto.",
    },
    button: {
      type: "string",
      enum: ["left", "right", "middle"],
      description: "Boton del raton para click. Por defecto left.",
    },
    direction: {
      type: "string",
      enum: ["up", "down"],
      description: "Direccion de la rueda cuando action es scroll.",
    },
    amount: {
      type: "number",
      description: "Pasos de rueda para scroll. Por defecto 3.",
    },
    path: {
      type: "string",
      description: "Ruta donde guardar la captura cuando action es screenshot. Por defecto ~/Fotos/agenos-captura-<fecha>.png.",
    },
    double: {
      type: "boolean",
      description: "true para hacer doble clic cuando action es click.",
    },
  },
  required: ["action"],
  additionalProperties: false,
};

function isAction(value: unknown): value is DesktopControlAction {
  return typeof value === "string" && (DESKTOP_CONTROL_ACTIONS as readonly string[]).includes(value);
}

function normalizeButton(value: unknown): DesktopMouseButton {
  return value === "right" || value === "middle" ? value : "left";
}

export function describeFocus(inspection: DesktopInspectResult): string {
  if (!inspection.ok) {
    return `No pude comprobar como quedo el escritorio: ${inspection.message}`;
  }

  const focused = inspection.focusedWindow;
  if (!focused) {
    return `Estado actual: ninguna ventana tiene el foco (${inspection.windows.length} ventanas abiertas).`;
  }

  const title = focused.title ? ` — "${focused.title}"` : "";
  return `Estado actual: la ventana enfocada es id ${focused.id} (${focused.appId}${title}) en el workspace ${focused.workspace}.`;
}

export function createDesktopControlModelTool(controller: DesktopControllerLike): PiCustomToolLike {
  return {
    name: "desktop_control",
    label: "Manejar el escritorio",
    description:
      "Maneja el escritorio como una persona: lista ventanas, cambia el foco, cierra ventanas, escribe texto, pulsa atajos de teclado, mueve y clica el raton y hace capturas de pantalla.",
    promptSnippet:
      "desktop_control: ver y manejar las ventanas nativas del escritorio (foco, teclado, raton, capturas) en aplicaciones como LibreOffice, GIMP, el editor o el gestor de archivos.",
    promptGuidelines: [
      "Usa desktop_control para aplicaciones nativas: LibreOffice, GIMP, el editor de textos, el gestor de archivos o cualquier ventana que no sea una pagina web.",
      "Para paginas web usa web_control, que es mucho mas fiable que teclear a ciegas sobre el navegador.",
      "Empieza siempre por action='inspect' para saber que ventanas hay abiertas y cual tiene el foco.",
      "Antes de escribir o pulsar teclas, asegurate de enfocar la ventana correcta con action='focus': el texto va siempre a donde este el foco.",
      "Nunca afirmes que has escrito, pulsado o clicado algo sin haber llamado a este tool y leido su respuesta.",
      "Si algo no se ve claro, haz action='screenshot' y mira el resultado antes de seguir.",
      "Si falta un binario (wtype, ydotool, grim) o el demonio ydotoold no responde, dilo tal cual al usuario en vez de fingir que la accion se hizo.",
    ],
    parameters: DESKTOP_CONTROL_TOOL_PARAMETERS,
    async execute(_toolCallId, params) {
      const action = params.action;
      if (!isAction(action)) {
        const message = `Accion no valida. Usa una de: ${DESKTOP_CONTROL_ACTIONS.join(", ")}.`;
        return { content: [{ type: "text", text: message }], details: { ok: false, action: params.action, message } };
      }

      let result: { ok: boolean; message: string } & Record<string, unknown>;
      try {
        result = await runAction(controller, action, params);
      } catch (error) {
        const message = `El control del escritorio fallo de forma inesperada: ${
          error instanceof Error ? error.message : String(error)
        }`;
        return { content: [{ type: "text", text: message }], details: { ok: false, action, message } };
      }

      const lines: string[] = [result.message];

      if (ACTIONS_WITH_FOLLOW_UP_INSPECT.has(action)) {
        try {
          const inspection = await controller.inspect();
          lines.push(describeFocus(inspection));
          result = { ...result, focusedWindow: inspection.focusedWindow, windowCount: inspection.windows.length };
        } catch (error) {
          lines.push(
            `No pude comprobar como quedo el escritorio: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return {
        content: [{ type: "text", text: lines.filter((line) => line.trim() !== "").join("\n") }],
        details: { action, ...result },
      };
    },
  };
}

async function runAction(
  controller: DesktopControllerLike,
  action: DesktopControlAction,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; message: string } & Record<string, unknown>> {
  switch (action) {
    case "inspect": {
      const inspection = await controller.inspect();
      return { ...inspection };
    }
    case "focus":
      return { ...(await controller.focusWindow(params.id)) };
    case "close":
      return { ...(await controller.closeWindow(params.id)) };
    case "type":
      return { ...(await controller.typeText(params.text)) };
    case "keys":
      return { ...(await controller.pressKeys(params.combo)) };
    case "mouse_move":
      return { ...(await controller.moveMouse(params.x, params.y)) };
    case "click":
      return {
        ...(await controller.click(normalizeButton(params.button), {
          x: params.x,
          y: params.y,
          double: params.double === true,
        })),
      };
    case "scroll": {
      const direction = params.direction;
      if (direction !== "up" && direction !== "down") {
        return { ok: false, message: "Para scroll indica direction 'up' o 'down'." };
      }
      return { ...(await controller.scroll(direction, params.amount)) };
    }
    case "screenshot":
      return {
        ...(await controller.screenshot(typeof params.path === "string" && params.path.trim() !== "" ? params.path : undefined)),
      };
    case "capabilities":
      return { ...(await controller.capabilities()) };
  }
}
