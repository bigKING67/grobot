import { runRuntimeStatusSurfaceSmoke } from "./runtime-smoke/status-surface.mjs";
import { runRuntimeRecoverySurfaceSmoke } from "./runtime-smoke/recovery-surface.mjs";
import { runRuntimeFailoverAndToolSmoke } from "./runtime-smoke/failover-and-tools.mjs";
import { runRuntimeInteractivePlanFlowSmoke } from "./runtime-smoke/interactive-plan-flow.mjs";
import { runRuntimePlanEventsPolicySmoke } from "./runtime-smoke/plan-events-policy.mjs";
import { runRuntimeContextQualityFlowSmoke } from "./runtime-smoke/context-quality-flows.mjs";
import { assertContextEngineControlSmoke } from "./runtime-smoke/context-engine-controls.mjs";
import { assertExperienceSchedulerControlSmoke } from "./runtime-smoke/experience-scheduler-controls.mjs";
import { assertExperienceRuntimeControlSmoke } from "./runtime-smoke/experience-runtime-controls.mjs";
import { assertMcpInstructionControlSmoke } from "./runtime-smoke/mcp-instruction-controls.mjs";
import { assertStatusLineControlSmoke } from "./runtime-smoke/status-line-controls.mjs";
import { runRuntimeDescribeFallbackSmoke } from "./runtime-smoke/runtime-describe-fallbacks.mjs";

export async function runTsRustExecutionSmoke() {
  await runRuntimeStatusSurfaceSmoke();
  await runRuntimeRecoverySurfaceSmoke();
  await runRuntimeFailoverAndToolSmoke();
  const planEventsPaths = await runRuntimeInteractivePlanFlowSmoke();
  await runRuntimePlanEventsPolicySmoke(planEventsPaths);
  await runRuntimeContextQualityFlowSmoke();
  assertContextEngineControlSmoke();
  assertExperienceSchedulerControlSmoke();
  assertExperienceRuntimeControlSmoke();
  assertMcpInstructionControlSmoke();
  assertStatusLineControlSmoke();
  await runRuntimeDescribeFallbackSmoke();
}
