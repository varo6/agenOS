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
    ruleId: "agent.shell.destructive.confirm",
    tool: "shell.exec",
    source: "*",
    decision: "confirm",
    reason: "Este comando shell puede borrar datos o cambiar servicios criticos y requiere confirmacion.",
    matches: (request) => request.tool === "shell.exec" && isDestructiveShellInput(request.input),
  },
  {
    ruleId: "agent.shell.local.allow",
    tool: "shell.exec",
    source: "*",
    decision: "allow",
    reason: "Comando shell local permitido para operar AgenOS.",
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
    ruleId: "agent.memory.learning.confirm",
    tool: "memory.write",
    source: "system",
    decision: "confirm",
    reason: "Activar conocimiento destilado automaticamente requiere confirmacion del usuario.",
    matches: all(toolIs("memory.write"), sourceIs("system")),
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
  {
    ruleId: "agent.ui.superuser.allow",
    tool: "*",
    source: "ui",
    decision: "allow",
    reason: "Accion local explicita desde el frontend de AgenOS.",
    matches: sourceIs("ui"),
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

function isDestructiveShellInput(input: unknown): boolean {
  if (!input || typeof input !== "object") {
    return false;
  }

  const command = (input as { command?: unknown }).command;
  if (typeof command !== "string") {
    return false;
  }

  const normalized = command.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const destructivePatterns = [
    /\brm\s+(-[^\s]*r[^\s]*f|-f[^\s]*r|-[^\s]*rf)\b/,
    /\b(shred|wipefs|mkfs|mke2fs|parted|fdisk|sfdisk|sgdisk|cryptsetup\s+luksformat)\b/,
    /\bdd\b.*\bof=\/dev\//,
    /\b(systemctl|service)\s+(disable|mask)\b/,
    /\b(systemctl|service)\s+(stop|restart)\s+(ssh|sshd|networkmanager|dbus|display-manager|gdm|sddm|lightdm|agenos|ui|kiosk)\b/,
    /\b(chown|chmod)\b.*\s(\/|\/etc|\/usr|\/bin|\/sbin|\/boot)\b/,
    />\s*\/(etc|boot|usr|bin|sbin)\//,
  ];

  return destructivePatterns.some((pattern) => pattern.test(normalized));
}
