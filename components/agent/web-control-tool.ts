import type { WebController } from "./web-control";
import { screenshotToolContent, type ToolContent } from "./screenshot-tool-content";

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
  ): Promise<{ content: ToolContent[]; details: unknown }>;
};

const WEB_CONTROL_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["open", "snapshot", "click", "type", "press_key", "wait_for", "extract", "back", "reload", "screenshot", "status"],
      description: "open abre una URL, snapshot lee la página, click pulsa un elemento, type escribe en un campo, press_key envía una tecla, wait_for espera a que aparezca algo, extract saca textos por selector CSS.",
    },
    url: { type: "string", description: "URL a abrir. Obligatoria en open." },
    ref: { type: "string", description: "Identificador del elemento tomado del snapshot, por ejemplo e12. Obligatorio en click y type." },
    text: { type: "string", description: "Texto a escribir en type, o texto a esperar en wait_for." },
    selector: { type: "string", description: "Selector CSS. Obligatorio en extract." },
    attribute: { type: "string", description: "Atributo a extraer en lugar del texto, por ejemplo href." },
    key: { type: "string", description: "Tecla a pulsar en press_key: Enter, Tab, Escape, ArrowDown..." },
    modifiers: {
      type: "array",
      items: { type: "string" },
      description: "Modificadores de press_key: ctrl, shift, alt, meta.",
    },
    submit: { type: "boolean", description: "En type, envía Enter después de escribir." },
    clear: { type: "boolean", description: "En type, vacía el campo antes de escribir. Por defecto true." },
    timeoutMs: { type: "number", description: "Espera máxima en wait_for." },
    path: { type: "string", description: "Ruta donde guardar la captura en screenshot." },
    maxChars: { type: "number", description: "Tamaño máximo del texto devuelto por snapshot." },
  },
  required: ["action"],
  additionalProperties: false,
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length > 0 ? items : undefined;
}

function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    details: { ok: false, message },
  };
}

export function createWebControlModelTool(controller: WebController): PiCustomToolLike {
  // Tras actuar sobre la página, el modelo necesita ver cómo quedó. Devolver el
  // snapshot aquí le ahorra una llamada por paso, que en un flujo tipo Gmail
  // (abrir, buscar, pulsar, escribir, enviar) es la mitad de las llamadas.
  async function withFreshSnapshot(base: { ok: boolean; message: string }, heading: string) {
    if (!base.ok) {
      return { text: base.message, snapshotText: "" };
    }
    const snapshot = await controller.snapshot();
    const snapshotText = snapshot.ok ? snapshot.text : `No pude releer la página: ${snapshot.message}`;
    return { text: `${heading}\n\n${snapshotText}`, snapshotText };
  }

  return {
    name: "web_control",
    label: "Manejar la web",
    description: "Abre y opera páginas web como lo haría una persona: leer, pulsar, escribir, esperar y extraer datos.",
    promptSnippet: "web_control: opera cualquier web (abrir, leer la página, pulsar, escribir, esperar) usando la sesión ya iniciada del usuario.",
    promptGuidelines: [
      "El bucle correcto es: open la URL, lee el snapshot que te devuelve, localiza en la lista de elementos el ref que necesitas por su nombre, y actúa con click o type sobre ese ref.",
      "Después de click y type recibes automáticamente el estado nuevo de la página; léelo antes de decidir el siguiente paso.",
      "Usa wait_for cuando la página cargue en diferido o después de enviar un formulario.",
      "La sesión del usuario ya está iniciada en el navegador. Si ves una pantalla de inicio de sesión, pídele que la complete él y nunca inventes ni escribas credenciales.",
      "Para el correo y el calendario del usuario usa google_workspace, que es más fiable que manejar la web.",
      "Antes de enviar un formulario, publicar o comprar algo en nombre del usuario, enséñale exactamente qué vas a enviar y espera su sí.",
      "El snapshot de texto es tu vía principal: úsalo siempre para decidir. Reserva screenshot para cuando el texto no baste (un mapa, un gráfico, un captcha o una página que no devuelve texto) y dile al usuario para qué lo miras.",
      "Nunca afirmes haber leído, enviado o comprado nada sin que este tool te haya devuelto ok.",
    ],
    parameters: WEB_CONTROL_TOOL_PARAMETERS,
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const action = asText(params.action) || "snapshot";

      try {
        switch (action) {
          case "status": {
            const result = await controller.status();
            return { content: [{ type: "text", text: result.message }], details: result };
          }

          case "open": {
            const url = asText(params.url);
            if (!url.trim()) {
              return fail("Necesito la URL que quieres abrir.");
            }
            onUpdate?.({ content: [{ type: "text", text: `Abriendo ${url}…` }], details: { ok: true } });
            const result = await controller.open(url);
            const { text } = await withFreshSnapshot(result, result.message);
            return { content: [{ type: "text", text }], details: result };
          }

          case "snapshot": {
            const result = await controller.snapshot(
              typeof params.maxChars === "number" ? { maxChars: params.maxChars } : undefined,
            );
            return {
              content: [{ type: "text", text: result.ok ? result.text : result.message }],
              details: result,
            };
          }

          case "click": {
            const ref = asText(params.ref);
            if (!ref.trim()) {
              return fail("Necesito el ref del elemento que quieres pulsar; sácalo de un snapshot.");
            }
            const result = await controller.click(ref);
            const { text } = await withFreshSnapshot(result, result.message);
            return { content: [{ type: "text", text }], details: result };
          }

          case "type": {
            const ref = asText(params.ref);
            const text = asText(params.text);
            if (!ref.trim()) {
              return fail("Necesito el ref del campo donde escribir; sácalo de un snapshot.");
            }
            const result = await controller.type(ref, text, {
              ...(typeof params.submit === "boolean" ? { submit: params.submit } : {}),
              ...(typeof params.clear === "boolean" ? { clear: params.clear } : {}),
            });
            const fresh = await withFreshSnapshot(result, result.message);
            return { content: [{ type: "text", text: fresh.text }], details: result };
          }

          case "press_key": {
            const key = asText(params.key);
            if (!key.trim()) {
              return fail("Necesito saber qué tecla pulsar.");
            }
            const result = await controller.pressKey(key, asStringList(params.modifiers));
            const { text } = await withFreshSnapshot(result, result.message);
            return { content: [{ type: "text", text }], details: result };
          }

          case "wait_for": {
            const result = await controller.waitFor({
              ...(asText(params.text).trim() ? { text: asText(params.text) } : {}),
              ...(asText(params.ref).trim() ? { ref: asText(params.ref) } : {}),
              ...(typeof params.timeoutMs === "number" ? { timeoutMs: params.timeoutMs } : {}),
            });
            return { content: [{ type: "text", text: result.message }], details: result };
          }

          case "extract": {
            const selector = asText(params.selector);
            if (!selector.trim()) {
              return fail("Necesito un selector CSS para extraer datos de la página.");
            }
            const result = await controller.extract(selector, {
              ...(asText(params.attribute).trim() ? { attribute: asText(params.attribute) } : {}),
              ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
            });
            const text = result.ok && result.matches.length > 0
              ? `${result.message}\n${result.matches.map((match, index) => `${index + 1}. ${match}`).join("\n")}`
              : result.message;
            return { content: [{ type: "text", text }], details: result };
          }

          case "back": {
            const result = await controller.back();
            const { text } = await withFreshSnapshot(result, result.message);
            return { content: [{ type: "text", text }], details: result };
          }

          case "reload": {
            const result = await controller.reload();
            const { text } = await withFreshSnapshot(result, result.message);
            return { content: [{ type: "text", text }], details: result };
          }

          case "screenshot": {
            const result = await controller.screenshot(asText(params.path));
            return { content: await screenshotToolContent(result, { ctx }), details: result };
          }

          default:
            return fail(`No conozco la acción «${action}» de web_control.`);
        }
      } catch (error) {
        return fail(error instanceof Error ? error.message : "No pude operar el navegador.");
      }
    },
  };
}
