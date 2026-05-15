import { spawn } from "node:child_process";

export function normalizeBrowserUrl(input: string): string {
  const raw = input.trim();
  if (!raw) {
    throw new Error("La URL es obligatoria.");
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withScheme);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Solo se permiten URLs http o https.");
  }

  return url.toString();
}

export type BrowserToolOptions = {
  spawnCommand?: (command: string, args: string[]) => void;
};

export function createBrowserTool(options: BrowserToolOptions = {}) {
  const spawnCommand = options.spawnCommand ?? ((command: string, args: string[]) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  });

  return {
    async openUrl(input: string) {
      const url = normalizeBrowserUrl(input);
      spawnCommand("xdg-open", [url]);
      return {
        ok: true,
        message: `Abriendo ${url}.`,
      };
    },
  };
}
