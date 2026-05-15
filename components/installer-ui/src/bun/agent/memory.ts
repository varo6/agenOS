import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type MemoryNamespace = "contacts" | "preferences" | "facts";

export type MemoryStoreOptions = {
  rootDir?: string;
  now?: () => Date;
};

const DEFAULT_FILES: Record<MemoryNamespace, string> = {
  contacts: "contacts.md",
  preferences: "preferences.md",
  facts: "facts.md",
};

function defaultRootDir(): string {
  return join(homedir(), ".agenos", "memory");
}

function ensureMemoryFiles(rootDir: string): void {
  mkdirSync(rootDir, { recursive: true });
  for (const fileName of Object.values(DEFAULT_FILES)) {
    const path = join(rootDir, fileName);
    try {
      readFileSync(path, "utf8");
    } catch {
      writeFileSync(path, "", { encoding: "utf8", mode: 0o600 });
    }
  }
}

export function isMemoryNamespace(value: unknown): value is MemoryNamespace {
  return value === "contacts" || value === "preferences" || value === "facts";
}

export function createMemoryStore(options: MemoryStoreOptions = {}) {
  const rootDir = options.rootDir ?? defaultRootDir();
  const now = options.now ?? (() => new Date());
  ensureMemoryFiles(rootDir);

  function pathFor(namespace: MemoryNamespace): string {
    return join(rootDir, DEFAULT_FILES[namespace]);
  }

  return {
    read(namespace: MemoryNamespace) {
      return {
        namespace,
        content: readFileSync(pathFor(namespace), "utf8"),
      };
    },
    append(namespace: MemoryNamespace, content: string, source: "ui" | "openclaw" | "system") {
      const trimmed = content.trim();
      if (!trimmed) {
        return { ok: false, message: "La memoria no puede estar vacia." };
      }

      appendFileSync(pathFor(namespace), `${trimmed}\n`, { encoding: "utf8" });
      appendFileSync(
        join(rootDir, "events.ndjson"),
        `${JSON.stringify({
          timestamp: now().toISOString(),
          namespace,
          source,
          action: "memory.append",
        })}\n`,
        { encoding: "utf8" },
      );
      return { ok: true, message: "Memoria guardada." };
    },
  };
}
