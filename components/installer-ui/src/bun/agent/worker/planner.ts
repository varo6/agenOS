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
};

const PROVIDER_AUTH_MISSING = "Provider/auth is not configured.";

export function createPlannerAdapter(options: CreatePlannerAdapterOptions): PlannerAdapter {
  if (options.mode === "disabled") {
    return {
      mode: "disabled",
      async plan() {
        return { ok: false, steps: [], degradedReason: PROVIDER_AUTH_MISSING };
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

export { PROVIDER_AUTH_MISSING };
