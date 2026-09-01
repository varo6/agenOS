import { homedir } from "node:os";
import { resolve } from "node:path";
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
    ruleId: "agent.shell.agent.deny",
    tool: "shell.exec",
    source: "openclaw|system",
    decision: "deny",
    reason: "Los agentes no reciben shell arbitraria; deben usar tools tipadas del broker.",
    matches: (request) => request.tool === "shell.exec" && request.source !== "ui",
  },
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
    reason: "Comando shell solicitado explicitamente por la UI autenticada de AgenOS.",
    matches: (request) => request.tool === "shell.exec" && request.source === "ui" && request.explicitUserIntent === true,
  },
  {
    ruleId: "agent.computer.run.agent.deny",
    tool: "computer.run",
    source: "openclaw|system",
    decision: "deny",
    reason: "Los agentes en segundo plano no reciben shell; deben usar tools tipadas del broker.",
    matches: (request) => request.tool === "computer.run" && request.source !== "ui",
  },
  {
    // El comando concreto lo vuelve a juzgar la regla de shell.exec cuando el
    // servicio lo ejecuta; aqui solo se abre la puerta a la sesion del usuario.
    ruleId: "agent.computer.run.ui.allow",
    tool: "computer.run",
    source: "ui",
    decision: "allow",
    reason: "Peticion de shell hecha desde la sesion autenticada del usuario.",
    matches: (request) => request.tool === "computer.run" && request.source === "ui",
  },
  {
    ruleId: "agent.desktop.input.agent.deny",
    tool: "desktop.input",
    source: "openclaw|system",
    decision: "deny",
    reason: "Solo el usuario presente puede mover el raton y el teclado; un agente en segundo plano no sintetiza entrada.",
    matches: (request) => request.tool === "desktop.input" && request.source !== "ui",
  },
  {
    ruleId: "agent.desktop.input.ui.allow",
    tool: "desktop.input",
    source: "ui",
    decision: "allow",
    reason: "Control de teclado y raton pedido desde la sesion del usuario.",
    matches: (request) => request.tool === "desktop.input" && request.source === "ui",
  },
  {
    ruleId: "agent.files.write.outside-home.confirm",
    tool: "files.write",
    source: "*",
    decision: "confirm",
    reason: "Escribir fuera de la carpeta personal puede tocar ficheros del sistema y requiere confirmacion.",
    matches: (request) => request.tool === "files.write" && !isInsideHome(request.input),
  },
  {
    ruleId: "agent.files.write.home.allow",
    tool: "files.write",
    source: "*",
    decision: "allow",
    reason: "Escribir en la carpeta personal del usuario es una accion ordinaria del agente.",
    matches: (request) => request.tool === "files.write" && isInsideHome(request.input),
  },
  {
    ruleId: "agent.google.send.confirm",
    tool: "google.send",
    source: "*",
    decision: "confirm",
    reason: "Enviar correo o cambiar el calendario en nombre del usuario requiere su confirmacion.",
    matches: toolIs("google.send"),
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
    ruleId: "agent.packages.install.ui.allow",
    tool: "packages.install",
    source: "ui",
    decision: "allow",
    reason: "La petición explícita de la sesión local puede instalar el paquete validado sin una segunda confirmación.",
    matches: (request) => request.tool === "packages.install"
      && request.source === "ui"
      && request.explicitUserIntent === true,
  },
  {
    ruleId: "agent.packages.install.confirm",
    tool: "packages.install",
    source: "*",
    decision: "confirm",
    reason: "Instalar software cambia el sistema y requiere una confirmación del usuario.",
    matches: toolIs("packages.install"),
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
    ruleId: "agent.memory.delete.ui.allow",
    tool: "memory.delete",
    source: "ui",
    decision: "allow",
    reason: "Olvidar una memoria requiere una peticion explicita del usuario.",
    matches: (request) => request.tool === "memory.delete" && request.source === "ui" && request.explicitUserIntent === true,
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
  "files.open",
  "files.read",
  "files.list",
  "files.search",
  "desktop.inspect",
  "desktop.capabilities",
  "desktop.screenshot",
  "web.control",
  "google.auth",
  "google.read",
  "workspaces.focus",
  "memory.read",
  // Solo lectura del almacen de mejoras: quien escribe ahi es el destilador
  // del broker a partir del boton, nunca el modelo.
  "improvements.read",
  "contacts.lookup",
  "tasks.enqueue",
  "tasks.read",
  "setup.status",
  "setup.run",
  "auth.codex.start",
  "telegram.configure",
  "telegram.test",
  "telegram.enable",
]);

// Las escrituras dentro de la carpeta personal son trabajo normal del agente;
// fuera de ella pueden tocar el sistema, asi que pasan por confirmacion.
function isInsideHome(input: unknown): boolean {
  if (!input || typeof input !== "object") {
    return false;
  }
  const path = (input as { path?: unknown }).path;
  if (typeof path !== "string" || !path.trim()) {
    return false;
  }
  const raw = path.trim();
  if (raw.startsWith("~")) {
    return !raw.startsWith("~/..");
  }
  const home = homedir();
  if (!raw.startsWith("/")) {
    // Las rutas relativas se resuelven contra el home del usuario.
    return !raw.split("/").includes("..");
  }
  const normalized = resolve(raw);
  return normalized === home || normalized.startsWith(`${home}/`);
}

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
