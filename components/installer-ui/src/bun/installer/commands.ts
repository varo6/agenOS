import { runClassic, runGuided } from "./calamares";

export async function runHelperCommand(
  mode: "classic" | "guided",
  options: {
    profile?: string;
  } = {},
): Promise<number> {
  if (mode === "classic") {
    return runClassic();
  }

  if (!options.profile) {
    throw new Error("Falta --profile <path>.");
  }

  return runGuided(options.profile);
}
