import type { OpenClawSetupService } from "./setup";

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
    onUpdate?: unknown,
    ctx?: unknown,
  ): Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }>;
};

const OPENCLAW_SETUP_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["status", "run", "codex_login", "telegram_configure", "telegram_test", "telegram_enable"],
      description: "Acción de setup a ejecutar.",
    },
    token: {
      type: "string",
      description: "Token de Telegram. Solo se requiere cuando la action es telegram_configure.",
    },
  },
  required: ["action"],
  additionalProperties: false,
};

export function createOpenClawSetupModelTool(setupService: Pick<OpenClawSetupService, "status" | "run" | "startCodexLogin" | "configureTelegram" | "testTelegram" | "enableTelegram">): PiCustomToolLike {
  return {
    name: "openclaw_setup",
    label: "Configurar OpenClaw",
    description: "Permite gestionar y configurar el backend de OpenClaw y sus canales.",
    promptSnippet: "openclaw_setup: permite revisar el estado y configurar OpenClaw, Codex y Telegram.",
    promptGuidelines: [
      "Usa openclaw_setup para consultar el estado del setup (action: 'status') o ejecutar acciones de configuracion.",
      "Siempre revisa el status antes de sugerir el siguiente paso.",
      "Para telegram_configure, necesitas que el usuario te proporcione el token de Telegram primero.",
    ],
    parameters: OPENCLAW_SETUP_TOOL_PARAMETERS,
    async execute(_toolCallId, params) {
      const action = params.action as string;
      let result;
      let text = "";

      switch (action) {
        case "status":
          result = await setupService.status();
          text = `Estado del setup: fase=${result.phase}, mensaje=${result.message}`;
          break;
        case "run":
          result = await setupService.run();
          text = `Detección re-ejecutada: fase=${result.phase}, mensaje=${result.message}`;
          break;
        case "codex_login":
          result = await setupService.startCodexLogin();
          text = `Login de Codex iniciado. Mensaje: ${result.message}`;
          break;
        case "telegram_configure":
          if (typeof params.token !== "string" || !params.token.trim()) {
            return {
              content: [{ type: "text", text: "Error: Se requiere un token de Telegram para esta acción." }],
              details: { error: "Missing token" },
            };
          }
          result = await setupService.configureTelegram(params.token);
          text = `Configuración de Telegram: ${result.message}`;
          break;
        case "telegram_test":
          result = await setupService.testTelegram();
          text = `Test de Telegram: ${result.message}`;
          break;
        case "telegram_enable":
          result = await setupService.enableTelegram();
          text = `Activación de Telegram: ${result.message}`;
          break;
        default:
          return {
            content: [{ type: "text", text: `Error: Acción desconocida '${action}'.` }],
            details: { error: "Unknown action" },
          };
      }

      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },
  };
}
