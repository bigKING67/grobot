import { runContextGraphContracts } from "./gateway-contract-smoke/context-graph-contracts.mjs";
import { runContextHistoryContracts } from "./gateway-contract-smoke/context-history-contracts.mjs";
import { runContextPromptQualityContracts } from "./gateway-contract-smoke/context-prompt-quality-contracts.mjs";
import {
  runSemanticBenchmarkFullContracts,
  runSemanticBenchmarkSmokeContracts,
} from "./gateway-contract-smoke/core-contracts.mjs";
import {
  runTuiActivityStatusContracts,
  runTuiAskSkillContracts,
  runTuiBottomAskPanelContracts,
  runTuiBrowserHealthContracts,
  runTuiRenderingContracts,
} from "./gateway-contract-smoke/tui-contracts.mjs";
import {
  runPlanAgentsInstructionsContract,
  runPlanBridgeApplyFailureContract,
  runPlanBridgeCliContract,
  runPlanBridgeErrorCodesSchemaContract,
  runPlanEventsPolicyGuardContract,
  runPlanFailurePolicyContracts,
  runPlanInputKeybindingContract,
  runPlanModeContract,
  runPlanQualityBenchmarkContract,
  runPlanSlashSuggestionsContract,
  runPlanUserCommandContracts,
} from "./gateway-contract-smoke/plan-command-contracts.mjs";
import {
  runRuntimeInterruptContractSmoke,
  runRuntimeStatusContractSmoke,
  runRuntimeStatusWindowSizeSmoke,
  runRuntimeStdioEventStreamContractSmoke,
} from "./runtime-smoke/status-surface.mjs";
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
  runRuntimeDescribeExperienceInputValidationSmoke,
  runRuntimeDescribeFallbackDiagnosticSmoke,
  runRuntimeDescribeInterruptTtlValidationSmoke,
  runRuntimeDescribeInvalidSchemaStartSmoke,
  runRuntimeDescribeInvalidSchemaStatusSmoke,
  runRuntimeDescribeLegacyEnvRejectSmoke,
  runRuntimeDescribeLegacyFlagRejectSmoke,
  runRuntimeDescribeMemoryInputValidationSmoke,
  runRuntimeDescribeMemoryLegacyFallbackSmoke,
  runRuntimeDescribePythonGatewayRejectSmoke,
  runRuntimeDescribeServeConfigPolicyAutoSmoke,
  runRuntimeDescribeServeConfigPolicyDisabledSmoke,
  runRuntimeDescribeUnavailableSmoke,
} from "./runtime-smoke/runtime-describe-fallbacks.mjs";
import {
  assertRuntimeModelCliEnvControlSmoke,
  assertRuntimeModelKimiOptionControlSmoke,
  assertRuntimeModelPromptCacheControlSmoke,
  assertRuntimeModelProviderControlSmoke,
  assertRuntimeModelSearchRoutingControlSmoke,
  assertRuntimeModelValidBoundarySmoke,
} from "./runtime-smoke/runtime-model-controls.mjs";
import {
  runRuntimeProviderCleanAlternateStatusSmoke,
  runRuntimeProviderManagementApiStatusSmoke,
  runRuntimeProviderPersistedFailureStatusSmoke,
  runRuntimeProviderUpstreamFailureStatusSmoke,
} from "./runtime-smoke/provider-status.mjs";
import {
  assertContextEngineControlSmoke,
  assertContextEngineEnvControlSmoke,
  assertContextEngineStatusControlSmoke,
  assertContextEngineTomlControlSmoke,
  assertContextEngineValidBoundarySmoke,
} from "./runtime-smoke/context-engine-controls.mjs";
import {
  assertExperienceRuntimeControlSmoke,
  assertExperienceRuntimeServeControlSmoke,
  assertExperienceRuntimeStartControlSmoke,
} from "./runtime-smoke/experience-runtime-controls.mjs";
import {
  assertExperienceSchedulerControlSmoke,
  assertExperienceSchedulerEnvControlSmoke,
  assertExperienceSchedulerTomlControlSmoke,
  assertExperienceSchedulerValidBoundarySmoke,
} from "./runtime-smoke/experience-scheduler-controls.mjs";
import { assertMcpInstructionControlSmoke } from "./runtime-smoke/mcp-instruction-controls.mjs";
import { assertRuntimeBinControlSmoke } from "./runtime-smoke/runtime-bin-controls.mjs";
import {
  assertStatusLineBasicControlSmoke,
  assertStatusLineCacheControlSmoke,
  assertStatusLineControlSmoke,
  assertStatusLineSegmentOrderControlSmoke,
  assertStatusLineSegmentToggleControlSmoke,
  assertStatusLineThresholdControlSmoke,
  assertStatusLineValidBoundarySmoke,
} from "./runtime-smoke/status-line-controls.mjs";
import { assertToolSurfaceProfileControlSmoke } from "./runtime-smoke/tool-surface-profile-controls.mjs";
import {
  runRuntimeGcCliControlSmoke,
  runRuntimeGcControlSmoke,
  runRuntimeGcEnvControlSmoke,
  runRuntimeGcTomlControlSmoke,
  runRuntimeExperienceControlSurfaceSmoke,
  runRuntimeExperiencePublishControlSmoke,
  runRuntimeExperienceRecallControlSmoke,
  runRuntimeStartAskUserTtlEnvControlSmoke,
  runRuntimeStartControlSmoke,
  runRuntimeStartContextWindowEnvControlSmoke,
  runRuntimeStartMaintenanceEnvControlSmoke,
  runRuntimeStartMemoryMaintenanceEnvControlSmoke,
  runRuntimeStartOptionControlSmoke,
  runRuntimeStartProviderEnvControlSmoke,
  runRuntimeStorageCliControlSmoke,
  runRuntimeStorageControlSmoke,
  runRuntimeStorageEnvControlSmoke,
  runRuntimeStorageSessionControlSurfaceSmoke,
  runRuntimeStorageTomlControlSmoke,
  runRuntimeSessionControlSmoke,
  runRuntimeSessionHandoffEnvControlSmoke,
  runRuntimeSessionHistoryControlSmoke,
  runRuntimeSessionRewindControlSmoke,
  runRuntimeManagementConfigCliControlSmoke,
  runRuntimeManagementConfigControlSmoke,
  runRuntimeManagementConfigEnvControlSmoke,
  runRuntimeManagementConfigExperienceControlSmoke,
  runRuntimeManagementConfigPolicyControlSmoke,
  runRuntimeManagementConfigStorageControlSmoke,
  runRuntimeManagementConfigTokenControlSmoke,
  runRuntimeContextStatusControlSmoke,
  runRuntimeToolContextControlSurfaceSmoke,
  runRuntimeToolStartControlSurfaceSmoke,
  runRuntimeToolStatusControlSurfaceSmoke,
} from "./runtime-smoke/control-surface.mjs";
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

const aggregateOnly = (run) => Object.assign(run, { aggregateOnly: true });

export const CASES = Object.freeze({
  "gateway:semantic-benchmark:smoke": {
    suite: "gateway:semantic-benchmark",
    description: "Semantic retrieval quick timing benchmark.",
    run: runSemanticBenchmarkSmokeContracts,
  },
  "gateway:semantic-benchmark:aggregate": {
    suite: "gateway:semantic-benchmark",
    description: "Semantic retrieval full timing benchmark aggregate reproduction.",
    run: aggregateOnly(runSemanticBenchmarkFullContracts),
  },
  "gateway:tui:browser-health": {
    suite: "gateway:tui",
    description: "Browser structured MCP, doctor schema, provider health, usage, help, and info panel contracts.",
    run: runTuiBrowserHealthContracts,
  },
  "gateway:tui:rendering": {
    suite: "gateway:tui",
    description: "CLI renderer, turn screen, and start TUI surface contracts.",
    run: runTuiRenderingContracts,
  },
  "gateway:tui:activity-status": {
    suite: "gateway:tui",
    description: "Activity feed/state, status line, indicator, stability, sanitizer, and interactive frame contracts.",
    run: runTuiActivityStatusContracts,
  },
  "gateway:tui:bottom-ask-panel": {
    suite: "gateway:tui",
    description: "Bottom pane, terminal markdown, and ask-user panel contracts.",
    run: runTuiBottomAskPanelContracts,
  },
  "gateway:tui:ask-skill": {
    suite: "gateway:tui",
    description: "Ask-user tool and GA skill prompt contracts.",
    run: runTuiAskSkillContracts,
  },
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
  "gateway:plan:input-keybinding": {
    suite: "gateway:plan",
    description: "Plan-adjacent input keybinding and prompt UI contracts.",
    run: runPlanInputKeybindingContract,
  },
  "gateway:plan:failure-policy": {
    suite: "gateway:plan",
    description: "Start and bridge plan failure policy contracts.",
    run: runPlanFailurePolicyContracts,
  },
  "gateway:plan:mode": {
    suite: "gateway:plan",
    description: "Plan mode lifecycle, surfaces, and apply contracts.",
    run: runPlanModeContract,
  },
  "gateway:plan:user-commands": {
    suite: "gateway:plan",
    description: "User command contracts for plan command surfaces.",
    run: runPlanUserCommandContracts,
  },
  "gateway:plan:agents-instructions": {
    suite: "gateway:plan",
    description: "AGENTS instructions discovery contract.",
    run: runPlanAgentsInstructionsContract,
  },
  "gateway:plan:slash-suggestions": {
    suite: "gateway:plan",
    description: "Plan slash suggestions and recommendation contracts.",
    run: runPlanSlashSuggestionsContract,
  },
  "gateway:plan:bridge-cli": {
    suite: "gateway:plan",
    description: "Bridge CLI plan command contract.",
    run: runPlanBridgeCliContract,
  },
  "gateway:plan:bridge-apply-failure": {
    suite: "gateway:plan",
    description: "Bridge plan apply failure contract.",
    run: runPlanBridgeApplyFailureContract,
  },
  "gateway:plan:bridge-error-codes": {
    suite: "gateway:plan",
    description: "Bridge error code schema contract.",
    run: runPlanBridgeErrorCodesSchemaContract,
  },
  "gateway:plan:events-policy": {
    suite: "gateway:plan",
    description: "Plan events policy guard contract.",
    run: runPlanEventsPolicyGuardContract,
  },
  "gateway:plan:quality-benchmark": {
    suite: "gateway:plan",
    description: "Plan quality benchmark contract.",
    run: runPlanQualityBenchmarkContract,
  },
  "runtime:status:interrupt": {
    suite: "runtime:status",
    description: "Runtime interrupt contract.",
    run: runRuntimeInterruptContractSmoke,
  },
  "runtime:status:stdio-event-stream": {
    suite: "runtime:status",
    description: "Runtime stdio event stream contract.",
    run: runRuntimeStdioEventStreamContractSmoke,
  },
  "runtime:status:surface": {
    suite: "runtime:status",
    description: "Runtime status JSON/text surface contract.",
    run: runRuntimeStatusContractSmoke,
  },
  "runtime:status:window-size": {
    suite: "runtime:status",
    description: "Runtime status context graph window-size contract.",
    run: runRuntimeStatusWindowSizeSmoke,
  },
  "runtime:controls:context-engine": {
    suite: "runtime:controls",
    description: "Context engine aggregate control rejection smoke.",
    run: aggregateOnly(assertContextEngineControlSmoke),
  },
  "runtime:controls:context-engine-env": {
    suite: "runtime:controls",
    description: "Context engine environment control rejection smoke.",
    run: assertContextEngineEnvControlSmoke,
  },
  "runtime:controls:context-engine-toml": {
    suite: "runtime:controls",
    description: "Context engine project TOML control rejection smoke.",
    run: assertContextEngineTomlControlSmoke,
  },
  "runtime:controls:context-engine-status": {
    suite: "runtime:controls",
    description: "Context engine status surface control rejection smoke.",
    run: assertContextEngineStatusControlSmoke,
  },
  "runtime:controls:context-engine-valid-boundary": {
    suite: "runtime:controls",
    description: "Context engine valid boundary reaches runtime.",
    run: assertContextEngineValidBoundarySmoke,
  },
  "runtime:controls:experience-scheduler": {
    suite: "runtime:controls",
    description: "Experience scheduler aggregate control rejection smoke.",
    run: aggregateOnly(assertExperienceSchedulerControlSmoke),
  },
  "runtime:controls:experience-scheduler-env": {
    suite: "runtime:controls",
    description: "Experience scheduler environment control rejection smoke.",
    run: assertExperienceSchedulerEnvControlSmoke,
  },
  "runtime:controls:experience-scheduler-toml": {
    suite: "runtime:controls",
    description: "Experience scheduler project TOML control rejection smoke.",
    run: assertExperienceSchedulerTomlControlSmoke,
  },
  "runtime:controls:experience-scheduler-valid-boundary": {
    suite: "runtime:controls",
    description: "Experience scheduler valid boundary reaches runtime.",
    run: assertExperienceSchedulerValidBoundarySmoke,
  },
  "runtime:controls:experience-runtime": {
    suite: "runtime:controls",
    description: "Experience runtime aggregate control rejection smoke.",
    run: aggregateOnly(assertExperienceRuntimeControlSmoke),
  },
  "runtime:controls:experience-runtime-start": {
    suite: "runtime:controls",
    description: "Experience runtime start boundary control rejection smoke.",
    run: assertExperienceRuntimeStartControlSmoke,
  },
  "runtime:controls:experience-runtime-serve": {
    suite: "runtime:controls",
    description: "Experience runtime serve boundary control rejection smoke.",
    run: assertExperienceRuntimeServeControlSmoke,
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
    description: "Status line aggregate control rejection smoke.",
    run: aggregateOnly(assertStatusLineControlSmoke),
  },
  "runtime:controls:status-line-basic": {
    suite: "runtime:controls",
    description: "Status line basic config control rejection smoke.",
    run: assertStatusLineBasicControlSmoke,
  },
  "runtime:controls:status-line-segment-order": {
    suite: "runtime:controls",
    description: "Status line segment order control rejection smoke.",
    run: assertStatusLineSegmentOrderControlSmoke,
  },
  "runtime:controls:status-line-thresholds": {
    suite: "runtime:controls",
    description: "Status line threshold control rejection smoke.",
    run: assertStatusLineThresholdControlSmoke,
  },
  "runtime:controls:status-line-cache": {
    suite: "runtime:controls",
    description: "Status line cache and width control rejection smoke.",
    run: assertStatusLineCacheControlSmoke,
  },
  "runtime:controls:status-line-segment-toggle": {
    suite: "runtime:controls",
    description: "Status line segment toggle control rejection smoke.",
    run: assertStatusLineSegmentToggleControlSmoke,
  },
  "runtime:controls:status-line-valid-boundary": {
    suite: "runtime:controls",
    description: "Status line valid boundary reaches runtime.",
    run: assertStatusLineValidBoundarySmoke,
  },
  "runtime:start-controls:runtime-options": {
    suite: "runtime:start-controls",
    description: "Runtime start CLI option validation controls.",
    run: runRuntimeStartOptionControlSmoke,
  },
  "runtime:start-controls:provider-env": {
    suite: "runtime:start-controls",
    description: "Runtime start provider environment validation controls.",
    run: runRuntimeStartProviderEnvControlSmoke,
  },
  "runtime:start-controls:maintenance-env": {
    suite: "runtime:start-controls",
    description: "Runtime start maintenance and prompt-quality environment validation controls.",
    run: aggregateOnly(runRuntimeStartMaintenanceEnvControlSmoke),
  },
  "runtime:start-controls:memory-maintenance-env": {
    suite: "runtime:start-controls",
    description: "Runtime start memory maintenance environment validation controls.",
    run: runRuntimeStartMemoryMaintenanceEnvControlSmoke,
  },
  "runtime:start-controls:context-window-env": {
    suite: "runtime:start-controls",
    description: "Runtime start context graph window environment validation controls.",
    run: runRuntimeStartContextWindowEnvControlSmoke,
  },
  "runtime:start-controls:ask-user-ttl-env": {
    suite: "runtime:start-controls",
    description: "Runtime start ask-user TTL environment validation controls.",
    run: runRuntimeStartAskUserTtlEnvControlSmoke,
  },
  "runtime:start-controls:runtime-controls": {
    suite: "runtime:start-controls",
    description: "Runtime start aggregate control rejection smoke.",
    run: aggregateOnly(runRuntimeStartControlSmoke),
  },
  "runtime:experience-state-controls:experience": {
    suite: "runtime:experience-state-controls",
    description: "Runtime experience aggregate control rejection smoke.",
    run: aggregateOnly(runRuntimeExperienceControlSurfaceSmoke),
  },
  "runtime:experience-state-controls:experience-publish": {
    suite: "runtime:experience-state-controls",
    description: "Runtime experience publish mode validation controls.",
    run: runRuntimeExperiencePublishControlSmoke,
  },
  "runtime:experience-state-controls:experience-recall": {
    suite: "runtime:experience-state-controls",
    description: "Runtime experience recall limit validation controls.",
    run: runRuntimeExperienceRecallControlSmoke,
  },
  "runtime:experience-state-controls:storage-session": {
    suite: "runtime:experience-state-controls",
    description: "Runtime storage/session aggregate control rejection smoke.",
    run: aggregateOnly(runRuntimeStorageSessionControlSurfaceSmoke),
  },
  "runtime:experience-state-controls:storage": {
    suite: "runtime:experience-state-controls",
    description: "Runtime storage aggregate control rejection smoke.",
    run: aggregateOnly(runRuntimeStorageControlSmoke),
  },
  "runtime:experience-state-controls:storage-cli": {
    suite: "runtime:experience-state-controls",
    description: "Runtime storage CLI validation controls.",
    run: runRuntimeStorageCliControlSmoke,
  },
  "runtime:experience-state-controls:storage-env": {
    suite: "runtime:experience-state-controls",
    description: "Runtime storage environment validation controls.",
    run: runRuntimeStorageEnvControlSmoke,
  },
  "runtime:experience-state-controls:storage-toml": {
    suite: "runtime:experience-state-controls",
    description: "Runtime storage TOML validation controls.",
    run: runRuntimeStorageTomlControlSmoke,
  },
  "runtime:experience-state-controls:session": {
    suite: "runtime:experience-state-controls",
    description: "Runtime session aggregate control rejection smoke.",
    run: aggregateOnly(runRuntimeSessionControlSmoke),
  },
  "runtime:experience-state-controls:session-history": {
    suite: "runtime:experience-state-controls",
    description: "Runtime session history and handoff count validation controls.",
    run: runRuntimeSessionHistoryControlSmoke,
  },
  "runtime:experience-state-controls:session-rewind": {
    suite: "runtime:experience-state-controls",
    description: "Runtime session rewind mode validation controls.",
    run: runRuntimeSessionRewindControlSmoke,
  },
  "runtime:experience-state-controls:session-handoff-env": {
    suite: "runtime:experience-state-controls",
    description: "Runtime session handoff environment validation controls.",
    run: runRuntimeSessionHandoffEnvControlSmoke,
  },
  "runtime:management-gc-controls:management-config": {
    suite: "runtime:management-gc-controls",
    description: "Management config aggregate control rejection smoke.",
    run: aggregateOnly(runRuntimeManagementConfigControlSmoke),
  },
  "runtime:management-gc-controls:management-cli": {
    suite: "runtime:management-gc-controls",
    description: "Management config CLI flag validation controls.",
    run: aggregateOnly(runRuntimeManagementConfigCliControlSmoke),
  },
  "runtime:management-gc-controls:management-policy": {
    suite: "runtime:management-gc-controls",
    description: "Management config read policy validation controls.",
    run: runRuntimeManagementConfigPolicyControlSmoke,
  },
  "runtime:management-gc-controls:management-storage": {
    suite: "runtime:management-gc-controls",
    description: "Management session store and Redis validation controls.",
    run: runRuntimeManagementConfigStorageControlSmoke,
  },
  "runtime:management-gc-controls:management-env": {
    suite: "runtime:management-gc-controls",
    description: "Management config environment validation controls.",
    run: runRuntimeManagementConfigEnvControlSmoke,
  },
  "runtime:management-gc-controls:management-token": {
    suite: "runtime:management-gc-controls",
    description: "Management config token and TOML validation controls.",
    run: runRuntimeManagementConfigTokenControlSmoke,
  },
  "runtime:management-gc-controls:management-experience": {
    suite: "runtime:management-gc-controls",
    description: "Management experience control validation.",
    run: runRuntimeManagementConfigExperienceControlSmoke,
  },
  "runtime:management-gc-controls:gc": {
    suite: "runtime:management-gc-controls",
    description: "GC aggregate input validation smoke.",
    run: aggregateOnly(runRuntimeGcControlSmoke),
  },
  "runtime:management-gc-controls:gc-cli": {
    suite: "runtime:management-gc-controls",
    description: "GC CLI input validation smoke.",
    run: runRuntimeGcCliControlSmoke,
  },
  "runtime:management-gc-controls:gc-env": {
    suite: "runtime:management-gc-controls",
    description: "GC environment input validation smoke.",
    run: runRuntimeGcEnvControlSmoke,
  },
  "runtime:management-gc-controls:gc-toml": {
    suite: "runtime:management-gc-controls",
    description: "GC TOML and valid default input validation smoke.",
    run: runRuntimeGcTomlControlSmoke,
  },
  "runtime:tool-context-controls:tool-start": {
    suite: "runtime:tool-context-controls",
    description: "Runtime tool-loop start control rejection smoke.",
    run: runRuntimeToolStartControlSurfaceSmoke,
  },
  "runtime:tool-context-controls:tool-status": {
    suite: "runtime:tool-context-controls",
    description: "Runtime tools-allow status control rejection smoke.",
    run: runRuntimeToolStatusControlSurfaceSmoke,
  },
  "runtime:tool-context-controls:context-status": {
    suite: "runtime:tool-context-controls",
    description: "Runtime context status control rejection smoke.",
    run: runRuntimeContextStatusControlSmoke,
  },
  "runtime:tool-context-controls:aggregate": {
    suite: "runtime:tool-context-controls",
    description: "Runtime tool/context aggregate control rejection smoke.",
    run: aggregateOnly(runRuntimeToolContextControlSurfaceSmoke),
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
  "runtime:provider-status:upstream-failure": {
    suite: "runtime:provider-status",
    description: "Provider upstream failure human status and redaction smoke.",
    run: runRuntimeProviderUpstreamFailureStatusSmoke,
  },
  "runtime:provider-status:persisted-failure": {
    suite: "runtime:provider-status",
    description: "Provider failure persisted status and registry smoke.",
    run: runRuntimeProviderPersistedFailureStatusSmoke,
  },
  "runtime:provider-status:clean-alternate": {
    suite: "runtime:provider-status",
    description: "Provider failure clean alternate route status smoke.",
    run: runRuntimeProviderCleanAlternateStatusSmoke,
  },
  "runtime:provider-status:management-api": {
    suite: "runtime:provider-status",
    description: "Provider failure management API status smoke.",
    run: runRuntimeProviderManagementApiStatusSmoke,
  },
  "runtime:describe:memory-legacy-fallback": {
    suite: "runtime:describe",
    description: "Runtime describe legacy memory fallback status smoke.",
    run: runRuntimeDescribeMemoryLegacyFallbackSmoke,
  },
  "runtime:describe:unavailable": {
    suite: "runtime:describe",
    description: "Runtime describe unavailable fallback status smoke.",
    run: runRuntimeDescribeUnavailableSmoke,
  },
  "runtime:describe:fallback-diagnostic": {
    suite: "runtime:describe",
    description: "Runtime describe fallback compact diagnostic smoke.",
    run: runRuntimeDescribeFallbackDiagnosticSmoke,
  },
  "runtime:describe:invalid-schema-status": {
    suite: "runtime:describe",
    description: "Runtime describe invalid schema status quality smoke.",
    run: runRuntimeDescribeInvalidSchemaStatusSmoke,
  },
  "runtime:describe:invalid-schema-start": {
    suite: "runtime:describe",
    description: "Runtime describe invalid schema start diagnostic smoke.",
    run: runRuntimeDescribeInvalidSchemaStartSmoke,
  },
  "runtime:describe:legacy-flag": {
    suite: "runtime:describe",
    description: "Runtime describe legacy flag rejection smoke.",
    run: runRuntimeDescribeLegacyFlagRejectSmoke,
  },
  "runtime:describe:python-gateway": {
    suite: "runtime:describe",
    description: "Runtime describe legacy gateway implementation rejection smoke.",
    run: runRuntimeDescribePythonGatewayRejectSmoke,
  },
  "runtime:describe:legacy-env": {
    suite: "runtime:describe",
    description: "Runtime describe legacy environment rejection smoke.",
    run: runRuntimeDescribeLegacyEnvRejectSmoke,
  },
  "runtime:describe:serve-config-policy-auto": {
    suite: "runtime:describe",
    description: "Runtime describe serve config read policy auto smoke.",
    run: runRuntimeDescribeServeConfigPolicyAutoSmoke,
  },
  "runtime:describe:serve-config-policy-disabled": {
    suite: "runtime:describe",
    description: "Runtime describe serve config read policy disabled smoke.",
    run: runRuntimeDescribeServeConfigPolicyDisabledSmoke,
  },
  "runtime:describe:interrupt-ttl": {
    suite: "runtime:describe",
    description: "Runtime describe management interrupt TTL validation smoke.",
    run: runRuntimeDescribeInterruptTtlValidationSmoke,
  },
  "runtime:describe:memory-input": {
    suite: "runtime:describe",
    description: "Runtime describe management memory input validation smoke.",
    run: runRuntimeDescribeMemoryInputValidationSmoke,
  },
  "runtime:describe:experience-input": {
    suite: "runtime:describe",
    description: "Runtime describe management experience input validation smoke.",
    run: runRuntimeDescribeExperienceInputValidationSmoke,
  },
});
