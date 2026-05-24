import { readFileSync } from "node:fs";
import { join } from "node:path";

function readPiSystemContextMarkdown(): string {
  const configuredPath = process.env.AGENOS_PI_SYSTEM_CONTEXT_PATH?.trim();
  const candidates: Array<string | URL> = [
    ...(configuredPath ? [configuredPath] : []),
    new URL("./pi-system-context.md", import.meta.url),
    join(process.cwd(), "components", "agent", "pi-system-context.md"),
    join(process.cwd(), "..", "agent", "pi-system-context.md"),
    join(process.cwd(), "pi-system-context.md"),
  ];

  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8").trim();
    } catch {
      // Try the next candidate so packaged builds can override the path.
    }
  }

  throw new Error("No se pudo leer el contexto Markdown de Pi.");
}

export const PI_SYSTEM_CONTEXT_MARKDOWN = readPiSystemContextMarkdown();
