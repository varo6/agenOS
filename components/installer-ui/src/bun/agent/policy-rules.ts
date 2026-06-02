import type { AgentSource, PolicyDecision, PolicyRequest } from "./policy";

export type PolicyRule = {
  ruleId: string;
  tool: string;
  source: string;
  decision: PolicyDecision;
  reason: string;
  matches(request: PolicyRequest): boolean;
};

function sourceIs(source: AgentSource): (request: PolicyRequest) => boolean {
  return (request) => request.source === source;
}

function toolIs(tool: string): (request: PolicyRequest) => boolean {
  return (request) => request.tool === tool;
}

function all(...predicates: Array<(request: PolicyRequest) => boolean>): (request: PolicyRequest) => boolean {
  return (request) => predicates.every((predicate) => predicate(request));
}

export const POLICY_RULES: PolicyRule[] = [
  {
    ruleId: "agent.ui.superuser.allow",
    tool: "*",
    source: "ui",
    decision: "allow",
    reason: "Accion local explicita desde el frontend de AgenOS.",
    matches: sourceIs("ui"),
  },
  {
    ruleId: "agent.shell.deny",
    tool: "shell.exec",
    source: "*",
    decision: "deny",
    reason: "La ejecucion shell arbitraria no esta permitida en AgenOS.",
    matches: toolIs("shell.exec"),
  },
  {
    ruleId: "agent.memory.background.confirm",
    tool: "memory.write",
    source: "openclaw",
    decision: "confirm",
    reason: "Guardar memoria desde el agente requiere confirmacion.",
    matches: all(toolIs("memory.write"), sourceIs("openclaw")),
  },
  {
    ruleId: "agent.outbound.background.confirm",
    tool: "outbound.send",
    source: "openclaw",
    decision: "confirm",
    reason: "Enviar mensajes externos desde el agente requiere confirmacion.",
    matches: (request) => request.source === "openclaw" && (
      request.tool === "outbound.send"
      || request.tool === "mail.send"
      || request.tool === "telegram.send"
      || request.tool === "whatsapp.send"
    ),
  },
  {
    ruleId: "agent.admin.config.confirm",
    tool: "admin.config.write",
    source: "ui",
    decision: "confirm",
    reason: "Cambiar configuracion del backend requiere confirmacion.",
    matches: all(toolIs("admin.config.write"), sourceIs("ui")),
  },
  {
    ruleId: "agent.admin.restart.confirm",
    tool: "admin.service.restart",
    source: "ui",
    decision: "confirm",
    reason: "Reiniciar el servicio del backend requiere confirmacion.",
    matches: all(toolIs("admin.service.restart"), sourceIs("ui")),
  },
  {
    ruleId: "agent.admin.queue.clear.confirm",
    tool: "admin.queue.clear",
    source: "ui",
    decision: "confirm",
    reason: "Vaciar la cola del backend requiere confirmacion.",
    matches: all(toolIs("admin.queue.clear"), sourceIs("ui")),
  },
  {
    ruleId: "agent.memory.ui.allow",
    tool: "memory.write",
    source: "ui",
    decision: "allow",
    reason: "Accion explicita del usuario.",
    matches: (request) => request.tool === "memory.write" && request.source === "ui" && request.explicitUserIntent === true,
  },
  {
    ruleId: "agent.low-risk.allow",
    tool: "local.low-risk",
    source: "*",
    decision: "allow",
    reason: "Herramienta local de bajo riesgo permitida.",
    matches: (request) => LOW_RISK_TOOLS.has(request.tool),
  },
];

const LOW_RISK_TOOLS = new Set([
  "apps.list",
  "apps.open",
  "browser.open_url",
  "workspaces.focus",
  "memory.read",
  "contacts.lookup",
  "tasks.enqueue",
]);
