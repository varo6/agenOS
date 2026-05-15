export type AgentSource = "ui" | "openclaw" | "system";
export type PolicyDecision = "allow" | "confirm" | "deny";

export type PolicyRequest = {
  tool: string;
  source: AgentSource;
  explicitUserIntent?: boolean;
};

export type PolicyResult = {
  decision: PolicyDecision;
  reason?: string;
};

const ALLOW_TOOLS = new Set([
  "apps.list",
  "apps.open",
  "browser.open_url",
  "memory.read",
  "contacts.lookup",
  "tasks.enqueue",
]);

const CONFIRM_TOOLS = new Set([
  "mail.send",
  "telegram.send",
  "whatsapp.send",
]);

export function decidePolicy(request: PolicyRequest): PolicyResult {
  if (request.tool === "shell.exec") {
    return {
      decision: "deny",
      reason: "La ejecucion shell arbitraria no esta permitida en este MVP.",
    };
  }

  if (request.tool === "memory.write") {
    return request.source === "ui" && request.explicitUserIntent
      ? { decision: "allow" }
      : { decision: "confirm", reason: "Guardar memoria requiere confirmacion." };
  }

  if (CONFIRM_TOOLS.has(request.tool)) {
    return { decision: "confirm", reason: "Enviar mensajes externos requiere confirmacion." };
  }

  if (ALLOW_TOOLS.has(request.tool)) {
    return { decision: "allow" };
  }

  return {
    decision: "deny",
    reason: `Tool no permitida: ${request.tool}`,
  };
}
