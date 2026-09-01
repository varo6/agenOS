import { readFile, stat } from "node:fs/promises";

export type ToolTextContent = { type: "text"; text: string; data?: never; mimeType?: never };
export type ToolImageContent = { type: "image"; data: string; mimeType: string; text?: never };
export type ToolContent = ToolTextContent | ToolImageContent;

export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type ScreenshotResult = {
  ok: boolean;
  message: string;
  path?: string;
};

/** Contexto que pi entrega a `execute`; solo se mira el modelo activo. */
type ToolExecutionContextLike = {
  model?: { input?: unknown } | undefined;
};

export type ScreenshotContentOptions = {
  /** Quinto argumento de `execute`, para saber si el modelo acepta imágenes. */
  ctx?: unknown;
  /** Entorno inyectable; por defecto `process.env`. */
  env?: Record<string, string | undefined>;
};

function textContent(text: string): ToolTextContent {
  return { type: "text", text };
}

function withAttachmentFailure(message: string, reason: string): ToolContent[] {
  return [textContent(`${message}\n${reason}`)];
}

/**
 * La visión es condicionada: el texto es siempre la vía principal y el PNG solo
 * se adjunta si el modelo activo declara entrada de imagen. Cuando el contexto
 * no dice nada se adjunta, que es el caso de los modelos que usa AgenOS; con
 * `AGENOS_TOOL_VISION=off` el operador puede desactivarlo sin tocar código.
 */
export function screenshotVisionAllowed(
  ctx?: unknown,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.AGENOS_TOOL_VISION?.trim().toLowerCase() === "off") {
    return false;
  }
  const model = (ctx as ToolExecutionContextLike | undefined)?.model;
  const accepted = model?.input;
  if (!Array.isArray(accepted)) {
    return true;
  }
  return accepted.includes("image");
}

/**
 * Converts a screenshot saved by a controller into the multimodal content that
 * pi-ai sends to the model. The path remains part of `details`; the model also
 * gets the PNG bytes and does not have to read the local filesystem itself.
 */
export async function screenshotToolContent(
  result: ScreenshotResult,
  options: ScreenshotContentOptions = {},
): Promise<ToolContent[]> {
  if (!result.ok || !result.path) {
    return [textContent(result.message)];
  }

  if (!screenshotVisionAllowed(options.ctx, options.env)) {
    return [textContent(result.message)];
  }

  try {
    const metadata = await stat(result.path);
    if (!metadata.isFile()) {
      return withAttachmentFailure(result.message, "No pude adjuntar la captura porque la ruta no es un archivo.");
    }
    if (metadata.size > MAX_SCREENSHOT_BYTES) {
      return withAttachmentFailure(
        result.message,
        `No adjunté la captura al modelo porque supera el límite de ${MAX_SCREENSHOT_BYTES / 1024 / 1024} MiB.`,
      );
    }

    const image = await readFile(result.path);
    if (image.byteLength > MAX_SCREENSHOT_BYTES) {
      return withAttachmentFailure(
        result.message,
        `No adjunté la captura al modelo porque supera el límite de ${MAX_SCREENSHOT_BYTES / 1024 / 1024} MiB.`,
      );
    }
    if (image.byteLength < PNG_SIGNATURE.byteLength || !image.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)) {
      return withAttachmentFailure(result.message, "No pude adjuntar la captura porque el archivo no es un PNG válido.");
    }

    return [
      textContent(result.message),
      { type: "image", data: image.toString("base64"), mimeType: "image/png" },
    ];
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return withAttachmentFailure(result.message, `No pude leer la captura para mostrársela al modelo: ${reason}`);
  }
}
