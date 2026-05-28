export type AgentCommand =
  | { kind: "foreground" }
  | { kind: "memory"; namespace: "facts"; content: string }
  | { kind: "background"; message: string };

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

  return { kind: "foreground" };
}

export function isBrokerCommand(command: AgentCommand): boolean {
  return command.kind === "memory" || command.kind === "background";
}
