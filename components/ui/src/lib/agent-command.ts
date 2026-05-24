export type AgentCommand =
  | { kind: "foreground" }
  | { kind: "memory"; namespace: "facts"; content: string }
  | { kind: "background"; message: string }
  | { kind: "openclaw-setup" };

export function classifyAgentCommand(input: string): AgentCommand {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith("recuerda que ")) {
    return {
      kind: "memory",
      namespace: "facts",
      content: trimmed.slice("recuerda que ".length).trim(),
    };
  }

  const backgroundPrefix = "manda esto al trabajador de fondo:";
  if (lower.startsWith(backgroundPrefix)) {
    return {
      kind: "background",
      message: trimmed.slice(backgroundPrefix.length).trim(),
    };
  }

  if (
    lower.includes("openclaw") && (
      lower.includes("setup")
      || lower.includes("configura")
      || lower.includes("configurar")
      || lower.includes("onboard")
      || lower.includes("onboarding")
    )
  ) {
    return { kind: "openclaw-setup" };
  }

  if (
    lower.includes("telegram")
    && (lower.includes("backend") || lower.includes("openclaw") || lower.includes("bot"))
    && (lower.includes("conecta") || lower.includes("conectar") || lower.includes("configura") || lower.includes("setup"))
  ) {
    return { kind: "openclaw-setup" };
  }

  return { kind: "foreground" };
}

export function isBrokerCommand(command: AgentCommand): boolean {
  return command.kind === "memory" || command.kind === "background" || command.kind === "openclaw-setup";
}
