import { resolve } from "node:path";
import {
  buildStartSmokeFlowContext,
} from "./start-smoke-contract/context.mjs";
import {
  isObject,
  parseArgs,
  requireOption,
} from "./start-smoke-contract/helpers.mjs";
import {
  runStartRecoveryGateBlocksSurfaceAdaptation,
  runStatusBrowserEnvironmentToolRecovery,
  runStatusInvalidConfigRuntimeRecovery,
  runStatusMcpEnvironmentToolRecovery,
  runStatusNonRecoverableToolRecovery,
  runStatusNonRecoverableToolRecoveryConsumed,
} from "./start-smoke-contract/recovery-flows.mjs";
import {
  runStartContextPreSendHeadTrimFlow,
  runStartContextQualityGuardFlow,
} from "./start-smoke-contract/context-prompt-flows.mjs";
import {
  runStartContextGraphQualityAutotuneAdaptiveSequenceFlow,
  runStartContextGraphQualityAutotuneFlow,
  runStartContextGraphQualityAutotuneHysteresisFlow,
} from "./start-smoke-contract/context-graph-flows.mjs";
import {
  runStartContextMemoryDecayAutotuneQualityFlow,
  runStartContextMemoryDecayAutotuneQualityRelaxFlow,
} from "./start-smoke-contract/context-memory-decay-quality-flows.mjs";
import {
  runStartContextMemoryDecayAutotuneHysteresisFlow,
} from "./start-smoke-contract/context-memory-decay-hysteresis-flow.mjs";
import {
  runStatusInvalidContextControlsRejectFlow,
  runStatusInvalidRuntimeControlsRejectFlow,
  runStatusTsRust,
} from "./start-smoke-contract/status-ts-rust-flow.mjs";
import {
  runStartRuntimeDescribeFallbackDiagnostic,
  runStartRuntimeDescribeInvalidSchemaProfiles,
  runRuntimeBinRejectFlow,
  runStatusRejectLegacyEnv,
  runStatusRejectLegacyFlag,
  runStatusRejectPythonGateway,
  runStatusRuntimeDescribeInvalidSchemaProfiles,
  runStatusRuntimeDescribeUnavailable,
  runStatusTsRustDeprecatedFlag,
  runStatusTsRustMemoryLegacyFallback,
} from "./start-smoke-contract/status-runtime-flows.mjs";
import {
  runStartBareInteractiveSessionFlow,
  runStartInteractiveDiagnosticsFlow,
  runStartInteractiveDiagnosticsPlanFlow,
  runStartInteractiveDiagnosticsSkillCreatorFlow,
  runStartInteractiveDiagnosticsUserCommandFlow,
  runStartInteractiveInterruptFlow,
  runStartInteractiveSessionCommandsFallbackFlow,
  runStartInteractiveSessionFlow,
  runStartSessionMenuViewModelContract,
} from "./start-smoke-contract/start-interactive-flows.mjs";
import {
  runStartInvalidNamespaceRejectFlow,
  runPackageLauncherRejectsPython,
  runStartImOnlyRejectFlow,
  runStartMessageProviderConfigTsRust,
  runStartMessageSmoke,
} from "./start-smoke-contract/start-basic-flows.mjs";
import {
  runStartInvalidExperienceControlsRejectFlow,
  runStartInvalidExperiencePublishControlsRejectFlow,
  runStartInvalidExperienceRecallControlsRejectFlow,
  runStartInvalidSessionControlsRejectFlow,
  runStartInvalidSessionHandoffEnvControlsRejectFlow,
  runStartInvalidSessionHistoryControlsRejectFlow,
  runStartInvalidSessionRewindControlsRejectFlow,
  runStartInvalidStorageCliControlsRejectFlow,
  runStartInvalidStorageControlsRejectFlow,
  runStartInvalidStorageEnvControlsRejectFlow,
  runStartInvalidStorageTomlControlsRejectFlow,
} from "./start-smoke-contract/experience-state-control-flows.mjs";
import {
  runStartInvalidAskUserTtlEnvControlsRejectFlow,
  runStartInvalidContextWindowEnvControlsRejectFlow,
  runStartInvalidMaintenanceEnvControlsRejectFlow,
  runStartInvalidMemoryMaintenanceEnvControlsRejectFlow,
  runStartInvalidProviderEnvControlsRejectFlow,
  runStartInvalidRuntimeControlsRejectFlow,
  runStartInvalidRuntimeOptionControlsRejectFlow,
} from "./start-smoke-contract/runtime-start-control-flows.mjs";
import {
  runStartInvalidToolSurfaceProfileControlsRejectFlow,
  runStartInvalidToolLoopControlsRejectFlow,
  runStatusInvalidToolsAllowControlsRejectFlow,
} from "./start-smoke-contract/runtime-tool-control-flows.mjs";
import {
  runStartRuntimeModelCliEnvControlsRejectFlow,
  runStartInvalidRuntimeModelControlsRejectFlow,
  runStartRuntimeModelKimiOptionControlsRejectFlow,
  runStartRuntimeModelPromptCacheControlsRejectFlow,
  runStartRuntimeModelProviderControlsRejectFlow,
  runStartRuntimeModelSearchRoutingControlsFlow,
  runStartRuntimeModelValidBoundaryFlow,
} from "./start-smoke-contract/runtime-model-control-flows.mjs";
import {
  runStartInvalidMemoryStrategyProfileControlsRejectFlow,
} from "./start-smoke-contract/memory-strategy-profile-control-flow.mjs";
import {
  runStartInvalidContextEngineControlsRejectFlow,
  runStartInvalidContextEngineEnvAdaptiveControlsRejectFlow,
  runStartInvalidContextEngineEnvControlsRejectFlow,
  runStartInvalidContextEngineEnvCoreControlsRejectFlow,
  runStartInvalidContextEngineTomlBasicControlsRejectFlow,
  runStartInvalidContextEngineTomlControlsRejectFlow,
  runStartInvalidContextEngineTomlThresholdControlsRejectFlow,
  runStartInvalidContextEngineTomlWindowControlsRejectFlow,
  runStartContextEngineValidBoundaryFlow,
  runStatusInvalidContextEngineControlsRejectFlow,
} from "./start-smoke-contract/context-engine-control-flows.mjs";
import {
  runStartInvalidExperienceSchedulerControlsRejectFlow,
  runStartExperienceSchedulerValidBoundaryFlow,
  runStartInvalidExperienceSchedulerEnvControlsRejectFlow,
  runStartInvalidExperienceSchedulerTomlControlsRejectFlow,
} from "./start-smoke-contract/experience-scheduler-control-flows.mjs";
import {
  runStartInvalidPlanArtifactControlsRejectFlow,
  runStartPlanConcurrencyFlow,
  runStartPlanModeFlow,
} from "./start-smoke-contract/start-plan-flows.mjs";
import {
  runStartMcpInstructionEventsFlow,
} from "./start-smoke-contract/mcp-instruction-flows.mjs";
import {
  runStartInvalidMcpInstructionBasicControlsRejectFlow,
  runStartInvalidMcpInstructionControlsRejectFlow,
  runStartInvalidMcpInstructionScopeControlsRejectFlow,
  runStartInvalidMcpInstructionServerControlsRejectFlow,
  runStartMcpInstructionValidDisabledBoundaryFlow,
} from "./start-smoke-contract/mcp-instruction-control-flows.mjs";
import {
  runStartInvalidStatusLineControlsRejectFlow,
  runStartInvalidStatusLineBasicControlsRejectFlow,
  runStartInvalidStatusLineCacheControlsRejectFlow,
  runStartInvalidStatusLineSegmentOrderControlsRejectFlow,
  runStartInvalidStatusLineSegmentToggleControlsRejectFlow,
  runStartInvalidStatusLineThresholdControlsRejectFlow,
  runStartStatusLineValidBoundaryFlow,
} from "./start-smoke-contract/status-line-control-flows.mjs";
import {
  runFailoverRejectsPython,
  runFailoverTsRust,
  runProviderFailureRouteStatusTsRust,
  runProviderPoolMultiTurnTsRust,
  runStartSessionStoreRedisFallback,
} from "./start-smoke-contract/failover-flows.mjs";

function runCli(argv) {
  const { command, options } = parseArgs(argv);
  const repoRoot = resolve(requireOption(options, "repo-root"));
  let payload;
    switch (command) {
    case "package-launcher-rejects-python":
      payload = runPackageLauncherRejectsPython(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-message-smoke":
      payload = runStartMessageSmoke(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-namespace-reject-flow":
      payload = runStartInvalidNamespaceRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-runtime-controls-reject-flow":
      payload = runStartInvalidRuntimeControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-runtime-option-controls-reject-flow":
      payload = runStartInvalidRuntimeOptionControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-provider-env-controls-reject-flow":
      payload = runStartInvalidProviderEnvControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-maintenance-env-controls-reject-flow":
      payload = runStartInvalidMaintenanceEnvControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-memory-maintenance-env-controls-reject-flow":
      payload = runStartInvalidMemoryMaintenanceEnvControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-context-window-env-controls-reject-flow":
      payload = runStartInvalidContextWindowEnvControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-ask-user-ttl-env-controls-reject-flow":
      payload = runStartInvalidAskUserTtlEnvControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-runtime-model-controls-reject-flow":
      payload = runStartInvalidRuntimeModelControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-runtime-model-kimi-option-controls-reject-flow":
      payload = runStartRuntimeModelKimiOptionControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-runtime-model-prompt-cache-controls-reject-flow":
      payload = runStartRuntimeModelPromptCacheControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-runtime-model-provider-controls-reject-flow":
      payload = runStartRuntimeModelProviderControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-runtime-model-search-routing-controls-flow":
      payload = runStartRuntimeModelSearchRoutingControlsFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-runtime-model-cli-env-controls-reject-flow":
      payload = runStartRuntimeModelCliEnvControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-runtime-model-valid-boundary-flow":
      payload = runStartRuntimeModelValidBoundaryFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-memory-strategy-profile-controls-reject-flow":
      payload = runStartInvalidMemoryStrategyProfileControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-context-engine-controls-reject-flow":
      payload = runStartInvalidContextEngineControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-context-engine-env-controls-reject-flow":
      payload = runStartInvalidContextEngineEnvControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-context-engine-env-core-controls-reject-flow":
      payload = runStartInvalidContextEngineEnvCoreControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-context-engine-env-adaptive-controls-reject-flow":
      payload = runStartInvalidContextEngineEnvAdaptiveControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-context-engine-toml-controls-reject-flow":
      payload = runStartInvalidContextEngineTomlControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-context-engine-toml-basic-controls-reject-flow":
      payload = runStartInvalidContextEngineTomlBasicControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-context-engine-toml-threshold-controls-reject-flow":
      payload = runStartInvalidContextEngineTomlThresholdControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-context-engine-toml-window-controls-reject-flow":
      payload = runStartInvalidContextEngineTomlWindowControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "status-invalid-context-engine-controls-reject-flow":
      payload = runStatusInvalidContextEngineControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-context-engine-valid-boundary-flow":
      payload = runStartContextEngineValidBoundaryFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-experience-scheduler-controls-reject-flow":
      payload = runStartInvalidExperienceSchedulerControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-experience-scheduler-env-controls-reject-flow":
      payload = runStartInvalidExperienceSchedulerEnvControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-experience-scheduler-toml-controls-reject-flow":
      payload = runStartInvalidExperienceSchedulerTomlControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-experience-scheduler-valid-boundary-flow":
      payload = runStartExperienceSchedulerValidBoundaryFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-experience-controls-reject-flow":
      payload = runStartInvalidExperienceControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-experience-publish-controls-reject-flow":
      payload = runStartInvalidExperiencePublishControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-experience-recall-controls-reject-flow":
      payload = runStartInvalidExperienceRecallControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-storage-controls-reject-flow":
      payload = runStartInvalidStorageControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-storage-cli-controls-reject-flow":
      payload = runStartInvalidStorageCliControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-storage-env-controls-reject-flow":
      payload = runStartInvalidStorageEnvControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-storage-toml-controls-reject-flow":
      payload = runStartInvalidStorageTomlControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-session-controls-reject-flow":
      payload = runStartInvalidSessionControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-session-history-controls-reject-flow":
      payload = runStartInvalidSessionHistoryControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-session-rewind-controls-reject-flow":
      payload = runStartInvalidSessionRewindControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-session-handoff-env-controls-reject-flow":
      payload = runStartInvalidSessionHandoffEnvControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-tool-loop-controls-reject-flow":
      payload = runStartInvalidToolLoopControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-tool-surface-profile-controls-reject-flow":
      payload = runStartInvalidToolSurfaceProfileControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "status-invalid-tools-allow-controls-reject-flow":
      payload = runStatusInvalidToolsAllowControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-message-provider-config-ts-rust":
      payload = runStartMessageProviderConfigTsRust(
        buildStartSmokeFlowContext(repoRoot),
        requireOption(options, "provider-base-url"),
        requireOption(options, "provider-api-key"),
        requireOption(options, "provider-model"),
      );
      break;
    case "start-interactive-session-flow":
      payload = runStartInteractiveSessionFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-bare-interactive-session-flow":
      payload = runStartBareInteractiveSessionFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-interactive-diagnostics-compact-flow":
      payload = runStartInteractiveDiagnosticsFlow(buildStartSmokeFlowContext(repoRoot), "compact");
      break;
    case "start-interactive-diagnostics-verbose-flow":
      payload = runStartInteractiveDiagnosticsFlow(buildStartSmokeFlowContext(repoRoot), "verbose");
      break;
    case "start-interactive-diagnostics-trace-flow":
      payload = runStartInteractiveDiagnosticsFlow(buildStartSmokeFlowContext(repoRoot), "trace");
      break;
    case "start-interactive-diagnostics-plan-compact-flow":
      payload = runStartInteractiveDiagnosticsPlanFlow(buildStartSmokeFlowContext(repoRoot), "compact");
      break;
    case "start-interactive-diagnostics-plan-verbose-flow":
      payload = runStartInteractiveDiagnosticsPlanFlow(buildStartSmokeFlowContext(repoRoot), "verbose");
      break;
    case "start-interactive-diagnostics-skill-creator-compact-flow":
      payload = runStartInteractiveDiagnosticsSkillCreatorFlow(buildStartSmokeFlowContext(repoRoot), "compact");
      break;
    case "start-interactive-diagnostics-skill-creator-verbose-flow":
      payload = runStartInteractiveDiagnosticsSkillCreatorFlow(buildStartSmokeFlowContext(repoRoot), "verbose");
      break;
    case "start-interactive-diagnostics-user-command-compact-flow":
      payload = runStartInteractiveDiagnosticsUserCommandFlow(buildStartSmokeFlowContext(repoRoot), "compact");
      break;
    case "start-interactive-diagnostics-user-command-verbose-flow":
      payload = runStartInteractiveDiagnosticsUserCommandFlow(buildStartSmokeFlowContext(repoRoot), "verbose");
      break;
    case "start-im-only-reject-flow":
      payload = runStartImOnlyRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-interactive-session-commands-fallback-flow":
      payload = runStartInteractiveSessionCommandsFallbackFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-interactive-interrupt-flow":
      payload = runStartInteractiveInterruptFlow(
        buildStartSmokeFlowContext(repoRoot),
        requireOption(options, "provider-base-url"),
        requireOption(options, "provider-api-key"),
        requireOption(options, "provider-model"),
      );
      break;
    case "start-session-menu-view-model-contract":
      payload = runStartSessionMenuViewModelContract(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-plan-mode-flow":
      payload = runStartPlanModeFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-plan-artifact-controls-reject-flow":
      payload = runStartInvalidPlanArtifactControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-plan-concurrency-flow":
      payload = runStartPlanConcurrencyFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-mcp-instruction-events-flow":
      payload = runStartMcpInstructionEventsFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-mcp-instruction-controls-reject-flow":
      payload = runStartInvalidMcpInstructionControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-mcp-instruction-basic-controls-reject-flow":
      payload = runStartInvalidMcpInstructionBasicControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-mcp-instruction-scope-controls-reject-flow":
      payload = runStartInvalidMcpInstructionScopeControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-mcp-instruction-server-controls-reject-flow":
      payload = runStartInvalidMcpInstructionServerControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-mcp-instruction-valid-disabled-boundary-flow":
      payload = runStartMcpInstructionValidDisabledBoundaryFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-status-line-controls-reject-flow":
      payload = runStartInvalidStatusLineControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-status-line-basic-controls-reject-flow":
      payload = runStartInvalidStatusLineBasicControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-status-line-segment-order-controls-reject-flow":
      payload = runStartInvalidStatusLineSegmentOrderControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-status-line-threshold-controls-reject-flow":
      payload = runStartInvalidStatusLineThresholdControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-status-line-cache-controls-reject-flow":
      payload = runStartInvalidStatusLineCacheControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-invalid-status-line-segment-toggle-controls-reject-flow":
      payload = runStartInvalidStatusLineSegmentToggleControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-status-line-valid-boundary-flow":
      payload = runStartStatusLineValidBoundaryFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "failover-rejects-python":
      payload = runFailoverRejectsPython(buildStartSmokeFlowContext(repoRoot));
      break;
    case "failover-runs-ts-rust":
      payload = runFailoverTsRust(buildStartSmokeFlowContext(repoRoot));
      break;
    case "provider-failure-route-status-ts-rust":
      payload = runProviderFailureRouteStatusTsRust(
        buildStartSmokeFlowContext(repoRoot),
        options.get("success-provider-base-url"),
      );
      break;
    case "start-recovery-gate-blocks-surface-adaptation":
      payload = runStartRecoveryGateBlocksSurfaceAdaptation(buildStartSmokeFlowContext(repoRoot));
      break;
    case "provider-pool-multi-turn-ts-rust":
      payload = runProviderPoolMultiTurnTsRust(
        buildStartSmokeFlowContext(repoRoot),
        requireOption(options, "provider-base-url"),
        Number.parseInt(options.get("provider-count") ?? "10", 10),
        Number.parseInt(options.get("turn-count") ?? "6", 10),
      );
      break;
    case "start-session-store-redis-fallback":
      payload = runStartSessionStoreRedisFallback(buildStartSmokeFlowContext(repoRoot));
      break;
    case "status-ts-rust":
      payload = runStatusTsRust(buildStartSmokeFlowContext(repoRoot));
      break;
    case "status-invalid-runtime-controls-reject-flow":
      payload = runStatusInvalidRuntimeControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "status-invalid-context-controls-reject-flow":
      payload = runStatusInvalidContextControlsRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "status-ts-rust-window-size": {
      const parsedWindowSize = Number.parseInt(options.get("window-size") ?? "7", 10);
      const normalizedWindowSize =
        Number.isFinite(parsedWindowSize) && parsedWindowSize > 0 ? parsedWindowSize : 7;
      payload = runStatusTsRust(buildStartSmokeFlowContext(repoRoot), normalizedWindowSize);
      break;
    }
    case "status-nonrecoverable-tool-recovery":
      payload = runStatusNonRecoverableToolRecovery(buildStartSmokeFlowContext(repoRoot));
      break;
    case "status-invalid-config-runtime-recovery":
      payload = runStatusInvalidConfigRuntimeRecovery(buildStartSmokeFlowContext(repoRoot));
      break;
    case "status-browser-environment-tool-recovery":
      payload = runStatusBrowserEnvironmentToolRecovery(buildStartSmokeFlowContext(repoRoot));
      break;
    case "status-mcp-environment-tool-recovery":
      payload = runStatusMcpEnvironmentToolRecovery(buildStartSmokeFlowContext(repoRoot));
      break;
    case "status-nonrecoverable-tool-recovery-consumed":
      payload = runStatusNonRecoverableToolRecoveryConsumed(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-context-pre-send-head-trim-flow":
      payload = runStartContextPreSendHeadTrimFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-context-quality-guard-flow":
      payload = runStartContextQualityGuardFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-context-graph-quality-autotune-flow":
      payload = runStartContextGraphQualityAutotuneFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-context-graph-quality-autotune-hysteresis-flow":
      payload = runStartContextGraphQualityAutotuneHysteresisFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-context-graph-quality-autotune-adaptive-sequence-flow":
      payload = runStartContextGraphQualityAutotuneAdaptiveSequenceFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-context-memory-decay-autotune-quality-flow":
      payload = runStartContextMemoryDecayAutotuneQualityFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-context-memory-decay-autotune-quality-relax-flow":
      payload = runStartContextMemoryDecayAutotuneQualityRelaxFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-context-memory-decay-autotune-hysteresis-flow":
      payload = runStartContextMemoryDecayAutotuneHysteresisFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "status-ts-rust-deprecated-flag":
      payload = runStatusTsRustDeprecatedFlag(buildStartSmokeFlowContext(repoRoot));
      break;
    case "status-ts-rust-memory-legacy-fallback":
      payload = runStatusTsRustMemoryLegacyFallback(buildStartSmokeFlowContext(repoRoot));
      break;
    case "status-runtime-describe-unavailable":
      payload = runStatusRuntimeDescribeUnavailable(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-runtime-describe-fallback-diagnostic":
      payload = runStartRuntimeDescribeFallbackDiagnostic(buildStartSmokeFlowContext(repoRoot));
      break;
    case "status-runtime-describe-invalid-schema-profiles":
      payload = runStatusRuntimeDescribeInvalidSchemaProfiles(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-runtime-describe-invalid-schema-profiles":
      payload = runStartRuntimeDescribeInvalidSchemaProfiles(buildStartSmokeFlowContext(repoRoot));
      break;
    case "runtime-bin-reject-flow":
      payload = runRuntimeBinRejectFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "status-reject-legacy-flag":
      payload = runStatusRejectLegacyFlag(buildStartSmokeFlowContext(repoRoot));
      break;
    case "status-reject-python-gateway":
      payload = runStatusRejectPythonGateway(buildStartSmokeFlowContext(repoRoot));
      break;
    case "status-reject-legacy-env":
      payload = runStatusRejectLegacyEnv(buildStartSmokeFlowContext(repoRoot));
      break;
    default:
      throw new Error(`unknown command: ${command}`);
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  return 0;
}

const entryScript = process.argv[1] ?? "";
const shouldRun = entryScript.includes("start-smoke-contract");

if (shouldRun) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    const message = isObject(error) && typeof error.message === "string" ? error.message : String(error);
    process.stderr.write(`start-smoke-contract fatal: ${message}\n`);
    process.exitCode = 1;
  }
}
