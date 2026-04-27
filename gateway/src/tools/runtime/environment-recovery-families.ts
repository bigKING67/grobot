import {
  formatBrowserEnvironmentRecoveryPlan,
  serializeBrowserEnvironmentRecoveryPlan,
  type BrowserEnvironmentRecoveryPlan,
} from "./browser-environment-recovery";
import {
  formatMcpEnvironmentRecoveryPlan,
  serializeMcpEnvironmentRecoveryPlan,
  type McpEnvironmentRecoveryPlan,
} from "./mcp-environment-recovery";
import {
  formatRuntimeEnvironmentRecoveryPlan,
  serializeRuntimeEnvironmentRecoveryPlan,
  type RuntimeEnvironmentRecoveryPlan,
} from "./runtime-environment-recovery";

export type {
  BrowserEnvironmentRecoveryPlan,
  McpEnvironmentRecoveryPlan,
  RuntimeEnvironmentRecoveryPlan,
};

export interface RuntimeToolEnvironmentRecoveryPlans {
  runtimeEnvironmentRecovery: RuntimeEnvironmentRecoveryPlan | null | undefined;
  browserEnvironmentRecovery: BrowserEnvironmentRecoveryPlan | null | undefined;
  mcpEnvironmentRecovery: McpEnvironmentRecoveryPlan | null | undefined;
}

interface RuntimeToolEnvironmentRecoveryFamily {
  fieldName: string;
  format: (plans: RuntimeToolEnvironmentRecoveryPlans) => string;
  serialize: (plans: RuntimeToolEnvironmentRecoveryPlans) => Record<string, unknown> | null;
}

const RUNTIME_TOOL_ENVIRONMENT_RECOVERY_FAMILIES = [
  {
    fieldName: "runtime_environment_recovery",
    format: (plans) => formatRuntimeEnvironmentRecoveryPlan(plans.runtimeEnvironmentRecovery),
    serialize: (plans) => serializeRuntimeEnvironmentRecoveryPlan(plans.runtimeEnvironmentRecovery),
  },
  {
    fieldName: "browser_environment_recovery",
    format: (plans) => formatBrowserEnvironmentRecoveryPlan(plans.browserEnvironmentRecovery),
    serialize: (plans) => serializeBrowserEnvironmentRecoveryPlan(plans.browserEnvironmentRecovery),
  },
  {
    fieldName: "mcp_environment_recovery",
    format: (plans) => formatMcpEnvironmentRecoveryPlan(plans.mcpEnvironmentRecovery),
    serialize: (plans) => serializeMcpEnvironmentRecoveryPlan(plans.mcpEnvironmentRecovery),
  },
] satisfies readonly RuntimeToolEnvironmentRecoveryFamily[];

export function formatRuntimeToolEnvironmentRecoveryFields(
  plans: RuntimeToolEnvironmentRecoveryPlans,
): string[] {
  return RUNTIME_TOOL_ENVIRONMENT_RECOVERY_FAMILIES.map((family) => (
    `${family.fieldName}=${family.format(plans)}`
  ));
}

export function serializeRuntimeToolEnvironmentRecoveryFields(
  plans: RuntimeToolEnvironmentRecoveryPlans,
  options: {
    fieldPrefix?: string;
  } = {},
): Record<string, unknown> {
  const fieldPrefix = options.fieldPrefix ?? "";
  return Object.fromEntries(
    RUNTIME_TOOL_ENVIRONMENT_RECOVERY_FAMILIES.map((family) => [
      `${fieldPrefix}${family.fieldName}`,
      family.serialize(plans),
    ]),
  );
}
