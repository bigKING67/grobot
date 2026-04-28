import type { ToolSurfaceProfile } from "../../models/types";
import type { RuntimeToolSurfaceProjectionMode, RuntimeToolSurfaceProjectionSummary } from "./default-enabled-tools";

export const RUNTIME_TOOL_SURFACE_BUDGET_POLICY_VERSION = "v1";

export interface RuntimeToolSurfaceBudgetPolicy {
  profile: ToolSurfaceProfile;
  projectionMode: RuntimeToolSurfaceProjectionMode;
  visibleToolCountMax: number;
  schemaPropertyCountMax: number;
  fullSchemaPropertyCountMax: number;
  suppressedSchemaPropertyCountMax: number;
  schemaEstimatedTokensMax: number;
}

export interface RuntimeToolSurfaceBudgetValidation {
  ok: boolean;
  profile: ToolSurfaceProfile;
  projectionMode: RuntimeToolSurfaceProjectionMode;
  violations: string[];
}

type RuntimeToolSurfaceBudgetLike = Pick<
  RuntimeToolSurfaceProjectionSummary,
  | "profile"
  | "projectionMode"
  | "visibleToolCount"
  | "schemaPropertyCount"
  | "fullSchemaPropertyCount"
  | "suppressedSchemaPropertyCount"
  | "schemaEstimatedTokens"
>;

export const RUNTIME_TOOL_SURFACE_BUDGETS: Record<ToolSurfaceProfile, RuntimeToolSurfaceBudgetPolicy> = {
  minimal: {
    profile: "minimal",
    projectionMode: "slim",
    visibleToolCountMax: 4,
    schemaPropertyCountMax: 9,
    fullSchemaPropertyCountMax: 15,
    suppressedSchemaPropertyCountMax: 6,
    schemaEstimatedTokensMax: 420,
  },
  coding: {
    profile: "coding",
    projectionMode: "slim",
    visibleToolCountMax: 7,
    schemaPropertyCountMax: 27,
    fullSchemaPropertyCountMax: 30,
    suppressedSchemaPropertyCountMax: 3,
    schemaEstimatedTokensMax: 920,
  },
  browser: {
    profile: "browser",
    projectionMode: "slim",
    visibleToolCountMax: 4,
    schemaPropertyCountMax: 16,
    fullSchemaPropertyCountMax: 47,
    suppressedSchemaPropertyCountMax: 31,
    schemaEstimatedTokensMax: 560,
  },
  browser_advanced: {
    profile: "browser_advanced",
    projectionMode: "advanced",
    visibleToolCountMax: 4,
    schemaPropertyCountMax: 39,
    fullSchemaPropertyCountMax: 47,
    suppressedSchemaPropertyCountMax: 8,
    schemaEstimatedTokensMax: 1230,
  },
  context: {
    profile: "context",
    projectionMode: "slim",
    visibleToolCountMax: 3,
    schemaPropertyCountMax: 10,
    fullSchemaPropertyCountMax: 20,
    suppressedSchemaPropertyCountMax: 10,
    schemaEstimatedTokensMax: 300,
  },
  mcp: {
    profile: "mcp",
    projectionMode: "slim",
    visibleToolCountMax: 3,
    schemaPropertyCountMax: 6,
    fullSchemaPropertyCountMax: 9,
    suppressedSchemaPropertyCountMax: 3,
    schemaEstimatedTokensMax: 250,
  },
  full_debug: {
    profile: "full_debug",
    projectionMode: "full",
    visibleToolCountMax: 14,
    schemaPropertyCountMax: 92,
    fullSchemaPropertyCountMax: 92,
    suppressedSchemaPropertyCountMax: 0,
    schemaEstimatedTokensMax: 2680,
  },
};

export function validateRuntimeToolSurfaceBudget(
  input: RuntimeToolSurfaceBudgetLike,
): RuntimeToolSurfaceBudgetValidation {
  const budget = RUNTIME_TOOL_SURFACE_BUDGETS[input.profile];
  const violations: string[] = [];
  if (input.projectionMode !== budget.projectionMode) {
    violations.push(
      `projection_mode:${input.projectionMode}>expected:${budget.projectionMode}`,
    );
  }
  if (input.visibleToolCount > budget.visibleToolCountMax) {
    violations.push(
      `visible_tool_count:${String(input.visibleToolCount)}>${String(budget.visibleToolCountMax)}`,
    );
  }
  if (input.schemaPropertyCount > budget.schemaPropertyCountMax) {
    violations.push(
      `schema_property_count:${String(input.schemaPropertyCount)}>${String(budget.schemaPropertyCountMax)}`,
    );
  }
  if (input.fullSchemaPropertyCount > budget.fullSchemaPropertyCountMax) {
    violations.push(
      `full_schema_property_count:${String(input.fullSchemaPropertyCount)}>${String(budget.fullSchemaPropertyCountMax)}`,
    );
  }
  if (input.suppressedSchemaPropertyCount > budget.suppressedSchemaPropertyCountMax) {
    violations.push(
      `suppressed_schema_property_count:${String(input.suppressedSchemaPropertyCount)}>${String(budget.suppressedSchemaPropertyCountMax)}`,
    );
  }
  if (input.schemaEstimatedTokens > budget.schemaEstimatedTokensMax) {
    violations.push(
      `schema_estimated_tokens:${String(input.schemaEstimatedTokens)}>${String(budget.schemaEstimatedTokensMax)}`,
    );
  }
  return {
    ok: violations.length === 0,
    profile: input.profile,
    projectionMode: input.projectionMode,
    violations,
  };
}
