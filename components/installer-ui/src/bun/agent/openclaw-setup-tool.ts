import type { OpenClawSetupService, OpenClawSetupState } from "./setup";

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

export type OpenClawSetupToolService = Pick<
  OpenClawSetupService,
  "status" | "run" | "startCodexLogin" | "codexLoginStatus" | "configureTelegram" | "testTelegram" | "enableTelegram"
>;

const OPENCLAW_SETUP_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["status", "run", "codex_login", "codex_login_status", "telegram_configure", "telegram_test", "telegram_enable"],
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

function describeState(state: OpenClawSetupState): string {
  const lines = [
    `fase=${state.phase}`,
    `worker=${state.workerMode}`,
    `openclaw instalado=${state.openclaw.installed ? "si" : "no"}${state.openclaw.version ? ` (${state.openclaw.version})` : ""}`,
    `codex configurado=${state.codex.configured ? "si" : "no"}`,
  ];

  const login = state.codex.login;
  if (login.status === "pending") {
    lines.push(
      login.url
        ? `login codex pendiente: el usuario debe abrir ${login.url}${login.userCode ? ` e introducir el codigo ${login.userCode}` : ""}`
        : "login codex pendiente: esperando URL de autenticacion",
    );
  } else if (login.status === "error" && login.error) {
    lines.push(`login codex fallido: ${login.error}`);
  }

  lines.push(
    `telegram: token=${state.telegram.tokenConfigured ? "configurado" : "falta"}, habilitado=${state.telegram.enabled ? "si" : "no"}`,
    `acciones disponibles: ${state.actions.join(", ")}`,
    `mensaje: ${state.message}`,
  );
  return lines.join("\n");
}

function describeCodexLogin(state: OpenClawSetupState): string {
  const login = state.codex.login;

  if (state.codex.configured || login.status === "success") {
    return "La autenticacion de Codex para el backend ya esta completada. No hay nada mas que hacer.";
  }

  if (login.status === "pending") {
    if (login.url) {
      return [
        "Login de Codex del backend iniciado.",
        `Dile al usuario que abra este enlace en cualquier navegador: ${login.url}`,
        login.userCode ? `Y que introduzca este codigo cuando se lo pida: ${login.userCode}` : "",
        "Cuando el usuario diga que ha terminado, comprueba con action codex_login_status.",
      ].filter(Boolean).join("\n");
    }
    return "Login de Codex iniciado pero aun no hay URL. Espera unos segundos y consulta codex_login_status.";
  }

  if (login.status === "error") {
    return `El login de Codex fallo: ${login.error ?? "error desconocido"}. Puedes reintentarlo con action codex_login.`;
  }

  return `Estado del login de Codex: ${login.status}. ${state.message}`;
}

export function createOpenClawSetupModelTool(setupService: OpenClawSetupToolService): PiCustomToolLike {
  return {
    name: "openclaw_setup",
    label: "Configurar OpenClaw",
    description: "Permite gestionar y configurar el backend de OpenClaw y sus canales.",
    promptSnippet: "openclaw_setup: permite revisar el estado y configurar OpenClaw, Codex y Telegram.",
    promptGuidelines: [
      "Usa openclaw_setup para consultar el estado del setup (action: 'status') o ejecutar acciones de configuracion.",
      "Siempre revisa el status antes de sugerir el siguiente paso.",
      "Para autenticar Codex en el backend usa action codex_login: recibiras una URL y un codigo que debes darle al usuario tal cual.",
      "Despues de que el usuario complete el login en el navegador, verifica con action codex_login_status.",
      "Para telegram_configure, necesitas que el usuario te proporcione el token de Telegram primero.",
    ],
    parameters: OPENCLAW_SETUP_TOOL_PARAMETERS,
    async execute(_toolCallId, params) {
      const action = params.action as string;
      let result: OpenClawSetupState;
      let text = "";

      switch (action) {
        case "status":
          result = await setupService.status();
          text = `Estado del setup de OpenClaw:\n${describeState(result)}`;
          break;
        case "run":
          result = await setupService.run();
          text = `Setup re-ejecutado:\n${describeState(result)}`;
          break;
        case "codex_login":
          result = await setupService.startCodexLogin();
          text = describeCodexLogin(result);
          break;
        case "codex_login_status":
          result = await setupService.codexLoginStatus();
          text = describeCodexLogin(result);
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
