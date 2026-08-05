import { execFile } from "node:child_process";

export type AdminEffectResult = {
  ok: boolean;
  message: string;
};

export type RestartWorkerOptions = {
  exec?: (command: string, args: string[]) => Promise<{ exitCode: number; stderr: string }>;
};

export async function restartAgentWorker(options: RestartWorkerOptions = {}): Promise<AdminEffectResult> {
  const run = options.exec ?? exec;
  const result = await run("pkexec", ["/usr/local/bin/agenos-shell-helper", "restart-agent"]);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim();
    return {
      ok: false,
      message: `No se pudo reiniciar el worker de AgenOS${detail ? `: ${detail}` : ". Comprueba polkit y agenos-openclaw.service."}`,
    };
  }

  return {
    ok: true,
    message: "Worker de AgenOS reiniciado.",
  };
}

function exec(command: string, args: string[]): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 15_000 }, (error, _stdout, stderr) => {
      const exitCode = typeof (error as NodeJS.ErrnoException & { code?: unknown } | null)?.code === "number"
        ? (error as NodeJS.ErrnoException & { code: number }).code
        : error
          ? 1
          : 0;
      resolve({ exitCode, stderr: stderr || (error instanceof Error ? error.message : "") });
    });
  });
}
