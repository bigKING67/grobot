import { runRuntimeStatusSurfaceSmoke } from "./runtime-smoke/status-surface.mjs";
import { runRuntimeRecoverySurfaceSmoke } from "./runtime-smoke/recovery-surface.mjs";
import { runRuntimeFailoverAndToolSmoke } from "./runtime-smoke/failover-and-tools.mjs";
import { runRuntimeInteractivePlanFlowSmoke } from "./runtime-smoke/interactive-plan-flow.mjs";
import { runRuntimePlanEventsPolicySmoke } from "./runtime-smoke/plan-events-policy.mjs";
import { runRuntimeContextQualityFlowSmoke } from "./runtime-smoke/context-quality-flows.mjs";
import { runRuntimeDescribeFallbackSmoke } from "./runtime-smoke/runtime-describe-fallbacks.mjs";

export async function runTsRustExecutionSmoke() {
  await runRuntimeStatusSurfaceSmoke();
  await runRuntimeRecoverySurfaceSmoke();
  await runRuntimeFailoverAndToolSmoke();
  const planEventsPaths = await runRuntimeInteractivePlanFlowSmoke();
  await runRuntimePlanEventsPolicySmoke(planEventsPaths);
  await runRuntimeContextQualityFlowSmoke();
  await runRuntimeDescribeFallbackSmoke();
}
