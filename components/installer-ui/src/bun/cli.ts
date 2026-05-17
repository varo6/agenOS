import type { LaunchResponse } from "../shared/installer-types";
import { runInstallerApiServer } from "./server";
import { runHelperCommand } from "./installer/commands";
import { launchClassic, launchGuided, loadLaunchProfile } from "./installer/launch";
import { createWorkerAdapter } from "./agent/worker";
import { createSupportBundle } from "./diagnostics/support-bundle";

export type CliDependencies = {
  createSupportBundle?: typeof createSupportBundle;
  console?: Pick<Console, "log" | "error">;
};

function profileArg(args: string[]): string {
  const index = args.indexOf("--profile");
  if (index === -1 || !args[index + 1]) {
    throw new Error("Falta --profile <path>.");
  }

  return args[index + 1]!;
}

function printLaunchResponse(response: LaunchResponse): number {
  if (response.message) {
    const writer = response.ok ? console.log : console.error;
    writer(response.message);
  }

  if (response.errors && Object.keys(response.errors).length > 0) {
    console.error(JSON.stringify(response.errors));
  }

  return response.ok && response.launched ? 0 : 1;
}

export async function runCli(args: string[], dependencies: CliDependencies = {}): Promise<{ handled: boolean; exitCode: number }> {
  if (args.length === 0) {
    return {
      handled: false,
      exitCode: 0,
    };
  }

  const [command, ...rest] = args;
  const output = dependencies.console ?? console;

  if (command === "launch-classic") {
    return {
      handled: true,
      exitCode: printLaunchResponse(await launchClassic()),
    };
  }

  if (command === "launch-guided") {
    const profile = loadLaunchProfile(profileArg(rest));
    return {
      handled: true,
      exitCode: printLaunchResponse(await launchGuided(profile)),
    };
  }

  if (command === "helper") {
    const [subcommand, ...helperArgs] = rest;

    if (subcommand === "classic") {
      return {
        handled: true,
        exitCode: await runHelperCommand("classic"),
      };
    }

    if (subcommand === "guided") {
      return {
        handled: true,
        exitCode: await runHelperCommand("guided", {
          profile: profileArg(helperArgs),
        }),
      };
    }

    throw new Error(`Comando helper no soportado: ${subcommand ?? ""}`.trim());
  }

  if (command === "server") {
    await runInstallerApiServer();
    return {
      handled: true,
      exitCode: 0,
    };
  }

  if (command === "api") {
    await runInstallerApiServer();
    return {
      handled: true,
      exitCode: 0,
    };
  }

  if (command === "worker") {
    await runAgentWorkerLoop();
    return {
      handled: true,
      exitCode: 0,
    };
  }

  if (command === "doctor") {
    const bundle = await (dependencies.createSupportBundle ?? createSupportBundle)();
    output.log(JSON.stringify(bundle, null, 2));
    return {
      handled: true,
      exitCode: 0,
    };
  }

  throw new Error(`Comando no soportado: ${command}`);
}

async function runAgentWorkerLoop(): Promise<void> {
  const adapter = createWorkerAdapter();
  const health = await adapter.health();
  console.log(`[agenos-openclaw-worker] mode=${health.mode} active=${health.serviceActive} stateDir=${health.stateDir}`);

  const interval = setInterval(async () => {
    try {
      await adapter.health();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
  }, 30_000);

  await new Promise<void>((resolve) => {
    const stop = () => {
      clearInterval(interval);
      resolve();
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function main(): Promise<void> {
  const outcome = await runCli(Bun.argv.slice(2));
  if (!outcome.handled) {
    process.exit(0);
  }

  process.exit(outcome.exitCode);
}

if (import.meta.main) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
