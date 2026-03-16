import { spawn, type ChildProcess } from "node:child_process";

function run(command: string, args: string[]): ChildProcess {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
  });

  child.once("error", (error) => {
    console.error(error.message);
  });

  return child;
}

async function main(): Promise<void> {
  const children = [
    run("bun", ["run", "dev:api"]),
    run("bun", ["run", "dev:view"]),
  ];

  const terminate = (signal?: NodeJS.Signals) => {
    for (const child of children) {
      if (!child.killed) {
        child.kill(signal);
      }
    }
  };

  process.once("SIGINT", () => {
    terminate("SIGINT");
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    terminate("SIGTERM");
    process.exit(143);
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    for (const child of children) {
      child.once("exit", (code) => {
        if (settled) {
          return;
        }

        settled = true;
        terminate("SIGTERM");
        if ((code ?? 0) === 0) {
          resolve();
          return;
        }

        reject(new Error(`El proceso hijo terminó con código ${code ?? 1}.`));
      });
    }
  });
}

if (import.meta.main) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
