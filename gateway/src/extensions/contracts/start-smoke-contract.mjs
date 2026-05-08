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
  runStatusTsRust,
} from "./start-smoke-contract/status-ts-rust-flow.mjs";
import {
  runStartRuntimeDescribeFallbackDiagnostic,
  runStartRuntimeDescribeInvalidSchemaProfiles,
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
  runStartPlanConcurrencyFlow,
  runStartPlanModeFlow,
} from "./start-smoke-contract/start-plan-flows.mjs";
import {
  runStartMcpInstructionEventsFlow,
} from "./start-smoke-contract/mcp-instruction-flows.mjs";
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
    case "start-plan-concurrency-flow":
      payload = runStartPlanConcurrencyFlow(buildStartSmokeFlowContext(repoRoot));
      break;
    case "start-mcp-instruction-events-flow":
      payload = runStartMcpInstructionEventsFlow(buildStartSmokeFlowContext(repoRoot));
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
