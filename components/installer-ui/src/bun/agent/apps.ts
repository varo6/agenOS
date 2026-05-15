const DESKTOP_FIELD_CODE_RE = /%[fFuUdDnNickvm]/g;

export function sanitizeDesktopExec(execLine: string): string[] {
  const protectedPercent = execLine.replaceAll("%%", "__PERCENT__");
  const cleaned = protectedPercent
    .replace(DESKTOP_FIELD_CODE_RE, "")
    .replaceAll("__PERCENT__", "%")
    .trim();

  const command = cleaned.match(/"([^"]*)"|'([^']*)'|\S+/g)
    ?.map((part) => part.replace(/^["']|["']$/g, ""))
    .filter(Boolean) ?? [];

  if (command.length === 0) {
    throw new Error("El Exec del .desktop no contiene ningun comando ejecutable.");
  }

  return command;
}
