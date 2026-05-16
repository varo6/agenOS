import { POLICY_RULES } from "./policy-rules";

export type AgentSource = "ui" | "openclaw" | "system";
export type PolicyDecision = "allow" | "confirm" | "deny";

export type PolicyRequest = {
  tool: string;
  source: AgentSource;
  explicitUserIntent?: boolean;
  correlationId?: string;
};

export type PolicyResult = {
  decision: PolicyDecision;
  ruleId: string;
  reason: string;
};

export function decidePolicy(request: PolicyRequest): PolicyResult {
  const matched = POLICY_RULES.find((rule) => rule.matches(request));
  if (matched) {
    return {
      decision: matched.decision,
      ruleId: matched.ruleId,
      reason: matched.reason,
    };
  }

  return {
    decision: "deny",
    ruleId: "agent.default.deny",
    reason: `Tool no permitida: ${request.tool}`,
  };
}

export function createPolicyAuditRecord(request: PolicyRequest, result: PolicyResult) {
  return {
    ruleId: result.ruleId,
    tool: request.tool,
    source: request.source,
    decision: result.decision,
    reason: result.reason,
    correlationId: request.correlationId ?? null,
  };
}
