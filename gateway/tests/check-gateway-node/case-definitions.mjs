import { runContextGraphContracts } from "./gateway-contract-smoke/context-graph-contracts.mjs";
import { runContextHistoryContracts } from "./gateway-contract-smoke/context-history-contracts.mjs";
import { runContextPromptQualityContracts } from "./gateway-contract-smoke/context-prompt-quality-contracts.mjs";
import {
  runRuntimeBareInteractiveSessionFlowSmoke,
  runRuntimeImOnlyRejectFlowSmoke,
  runRuntimeInteractiveDiagnosticsBaseFlowSmoke,
  runRuntimeInteractiveDiagnosticsCommandFlowSmoke,
  runRuntimeInteractiveSessionCommandsFallbackFlowSmoke,
  runRuntimeInvalidPlanArtifactControlsFlowSmoke,
  runRuntimePlanConcurrencyFlowSmoke,
  runRuntimePlanModeFlowSmoke,
  runRuntimeSessionMenuViewModelFlowSmoke,
} from "./runtime-smoke/interactive-plan-flow.mjs";
import {
  runRuntimePlanEventSourceFlowSmoke,
  runRuntimePlanEventsPolicySmoke,
} from "./runtime-smoke/plan-events-policy.mjs";
import {
  assertRuntimeModelCliEnvControlSmoke,
  assertRuntimeModelKimiOptionControlSmoke,
  assertRuntimeModelPromptCacheControlSmoke,
  assertRuntimeModelProviderControlSmoke,
  assertRuntimeModelSearchRoutingControlSmoke,
  assertRuntimeModelValidBoundarySmoke,
} from "./runtime-smoke/runtime-model-controls.mjs";
import { assertContextEngineControlSmoke } from "./runtime-smoke/context-engine-controls.mjs";
import { assertExperienceRuntimeControlSmoke } from "./runtime-smoke/experience-runtime-controls.mjs";
import { assertExperienceSchedulerControlSmoke } from "./runtime-smoke/experience-scheduler-controls.mjs";
import { assertMcpInstructionControlSmoke } from "./runtime-smoke/mcp-instruction-controls.mjs";
import { assertRuntimeBinControlSmoke } from "./runtime-smoke/runtime-bin-controls.mjs";
import { assertStatusLineControlSmoke } from "./runtime-smoke/status-line-controls.mjs";
import { assertToolSurfaceProfileControlSmoke } from "./runtime-smoke/tool-surface-profile-controls.mjs";
import {
  runRuntimeContextGraphAutotuneAdaptiveSequenceFlowSmoke,
  runRuntimeContextGraphAutotuneFlowSmoke,
  runRuntimeContextGraphAutotuneHysteresisFlowSmoke,
  runRuntimeContextMcpInstructionFlowSmoke,
  runRuntimeContextMemoryDecayAutotuneHysteresisFlowSmoke,
  runRuntimeContextMemoryDecayAutotuneQualityFlowSmoke,
  runRuntimeContextMemoryDecayAutotuneRelaxFlowSmoke,
  runRuntimeContextPreSendHeadTrimFlowSmoke,
  runRuntimeContextQualityGuardFlowSmoke,
} from "./runtime-smoke/context-quality-flows.mjs";

export const CASES = Object.freeze({
  "gateway:context:history": {
    suite: "gateway:context",
    description: "Context history contracts.",
    run: runContextHistoryContracts,
  },
  "gateway:context:prompt-quality": {
    suite: "gateway:context",
    description: "Context prompt quality contracts.",
    run: runContextPromptQualityContracts,
  },
  "gateway:context:graph": {
    suite: "gateway:context",
    description: "Context graph contracts.",
    run: runContextGraphContracts,
  },
  "runtime:controls:context-engine": {
    suite: "runtime:controls",
    description: "Context engine control rejection smoke.",
    run: assertContextEngineControlSmoke,
  },
  "runtime:controls:experience-scheduler": {
    suite: "runtime:controls",
    description: "Experience scheduler control rejection smoke.",
    run: assertExperienceSchedulerControlSmoke,
  },
  "runtime:controls:experience-runtime": {
    suite: "runtime:controls",
    description: "Experience runtime control rejection smoke.",
    run: assertExperienceRuntimeControlSmoke,
  },
  "runtime:controls:tool-surface-profile": {
    suite: "runtime:controls",
    description: "Tool surface profile control rejection smoke.",
    run: assertToolSurfaceProfileControlSmoke,
  },
  "runtime:controls:runtime-bin": {
    suite: "runtime:controls",
    description: "Runtime binary control rejection smoke.",
    run: assertRuntimeBinControlSmoke,
  },
  "runtime:controls:mcp-instruction": {
    suite: "runtime:controls",
    description: "MCP instruction control rejection smoke.",
    run: assertMcpInstructionControlSmoke,
  },
  "runtime:controls:status-line": {
    suite: "runtime:controls",
    description: "Status line control rejection smoke.",
    run: assertStatusLineControlSmoke,
  },
  "runtime:context:mcp-instruction": {
    suite: "runtime:context",
    description: "Context MCP instruction event and fallback flow.",
    run: runRuntimeContextMcpInstructionFlowSmoke,
  },
  "runtime:context:pre-send-head-trim": {
    suite: "runtime:context",
    description: "Context pre-send head trim flow.",
    run: runRuntimeContextPreSendHeadTrimFlowSmoke,
  },
  "runtime:context:quality-guard": {
    suite: "runtime:context",
    description: "Context quality guard minimal-stage flow.",
    run: runRuntimeContextQualityGuardFlowSmoke,
  },
  "runtime:context:memory-autotune-tighten": {
    suite: "runtime:context",
    description: "Context memory decay autotune quality tighten flow.",
    run: runRuntimeContextMemoryDecayAutotuneQualityFlowSmoke,
  },
  "runtime:context:memory-autotune-relax": {
    suite: "runtime:context",
    description: "Context memory decay autotune quality relax flow.",
    run: runRuntimeContextMemoryDecayAutotuneRelaxFlowSmoke,
  },
  "runtime:context:memory-autotune-hysteresis": {
    suite: "runtime:context",
    description: "Context memory decay autotune hysteresis flow.",
    run: runRuntimeContextMemoryDecayAutotuneHysteresisFlowSmoke,
  },
  "runtime:context:graph-autotune": {
    suite: "runtime:context",
    description: "Context graph quality autotune flow.",
    run: runRuntimeContextGraphAutotuneFlowSmoke,
  },
  "runtime:context:graph-autotune-hysteresis": {
    suite: "runtime:context",
    description: "Context graph quality autotune hysteresis flow.",
    run: runRuntimeContextGraphAutotuneHysteresisFlowSmoke,
  },
  "runtime:context:graph-autotune-adaptive-sequence": {
    suite: "runtime:context",
    description: "Context graph quality adaptive sequence flow.",
    run: runRuntimeContextGraphAutotuneAdaptiveSequenceFlowSmoke,
  },
  "runtime:plan:mode": {
    suite: "runtime:plan",
    description: "Interactive plan mode flow.",
    run: runRuntimePlanModeFlowSmoke,
  },
  "runtime:plan:artifact-controls": {
    suite: "runtime:plan",
    description: "Plan artifact env control rejection flow.",
    run: runRuntimeInvalidPlanArtifactControlsFlowSmoke,
  },
  "runtime:plan:bare-interactive": {
    suite: "runtime:plan",
    description: "Bare interactive session startup flow.",
    run: runRuntimeBareInteractiveSessionFlowSmoke,
  },
  "runtime:plan:diagnostics-base": {
    suite: "runtime:plan",
    description: "Interactive diagnostics compact, verbose, and trace flows.",
    run: runRuntimeInteractiveDiagnosticsBaseFlowSmoke,
  },
  "runtime:plan:diagnostics-command": {
    suite: "runtime:plan",
    description: "Interactive diagnostics plan, skill, and command flows.",
    run: runRuntimeInteractiveDiagnosticsCommandFlowSmoke,
  },
  "runtime:plan:im-only": {
    suite: "runtime:plan",
    description: "IM-only rejection flow.",
    run: runRuntimeImOnlyRejectFlowSmoke,
  },
  "runtime:plan:session-commands": {
    suite: "runtime:plan",
    description: "Interactive session command fallback flow.",
    run: runRuntimeInteractiveSessionCommandsFallbackFlowSmoke,
  },
  "runtime:plan:session-menu": {
    suite: "runtime:plan",
    description: "Session menu view-model contract flow.",
    run: runRuntimeSessionMenuViewModelFlowSmoke,
  },
  "runtime:plan:concurrency": {
    suite: "runtime:plan",
    description: "Plan artifact concurrency flow.",
    run: runRuntimePlanConcurrencyFlowSmoke,
  },
  "runtime:plan:events-policy": {
    suite: "runtime:plan",
    description: "Plan event source, report, and policy guard flow.",
    async run() {
      await runRuntimePlanEventsPolicySmoke(runRuntimePlanEventSourceFlowSmoke());
    },
  },
  "runtime:model-controls:kimi-options": {
    suite: "runtime:model-controls",
    description: "Runtime Kimi model option validation controls.",
    run: assertRuntimeModelKimiOptionControlSmoke,
  },
  "runtime:model-controls:prompt-cache": {
    suite: "runtime:model-controls",
    description: "Runtime prompt cache validation controls.",
    run: assertRuntimeModelPromptCacheControlSmoke,
  },
  "runtime:model-controls:provider": {
    suite: "runtime:model-controls",
    description: "Runtime provider priority, weight, and kind validation controls.",
    run: assertRuntimeModelProviderControlSmoke,
  },
  "runtime:model-controls:search-routing": {
    suite: "runtime:model-controls",
    description: "Runtime search routing validation and valid boundary controls.",
    run: assertRuntimeModelSearchRoutingControlSmoke,
  },
  "runtime:model-controls:cli-env": {
    suite: "runtime:model-controls",
    description: "Runtime model CLI and environment override validation controls.",
    run: assertRuntimeModelCliEnvControlSmoke,
  },
  "runtime:model-controls:valid-boundary": {
    suite: "runtime:model-controls",
    description: "Runtime model valid boundary reaches runtime.",
    run: assertRuntimeModelValidBoundarySmoke,
  },
});
