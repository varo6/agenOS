export type PlannerMode = "disabled" | "model-backed";

export type PlannerStep = {
  tool: string;
  input: unknown;
  summary: string;
};

export type PlannerResult = {
  ok: boolean;
  steps: PlannerStep[];
  degradedReason?: string;
};

export type PlannerAdapter = {
  mode: PlannerMode;
  plan(input: {
    correlationId: string;
    taskId: string;
    message: string;
  }): Promise<PlannerResult>;
};

export type CreatePlannerAdapterOptions = {
  mode: PlannerMode;
  planWithModel?: PlannerAdapter["plan"];
  disabledReason?: string;
};

const PROVIDER_AUTH_MISSING = "El proveedor o la autenticacion no estan configurados.";
const BUN_PLANNER_UNAVAILABLE = "El worker Bun no tiene un planner de modelo configurado; usa OpenClaw o configura un planner real.";

export function createPlannerAdapter(options: CreatePlannerAdapterOptions): PlannerAdapter {
  if (options.mode === "disabled") {
    return {
      mode: "disabled",
      async plan() {
        return { ok: false, steps: [], degradedReason: options.disabledReason ?? PROVIDER_AUTH_MISSING };
      },
    };
  }

  return {
    mode: "model-backed",
    async plan(input) {
      if (!options.planWithModel) {
        return { ok: false, steps: [], degradedReason: PROVIDER_AUTH_MISSING };
      }
      return options.planWithModel(input);
    },
  };
}

export { BUN_PLANNER_UNAVAILABLE, PROVIDER_AUTH_MISSING };
