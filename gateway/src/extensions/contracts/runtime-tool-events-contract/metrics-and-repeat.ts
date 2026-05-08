import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeEvent } from "../../../models/types";
import {
  buildProviderFailureDiagnostics,
  buildProviderFailureToolContext,
  deriveFailureStageFromError,
  recordRuntimeToolMetricsForEvents,
} from "../../../cli/start/turn/diagnostics";
import { RuntimeRpcError, extractRuntimeErrorEvents } from "../../../tools/runtime/runtime-error";
import {
  buildRuntimeToolRecoveryFeedback,
  clearRuntimeToolRecoveryRepeatPressure,
  formatRuntimeToolRecoveryEscalationFields,
  isRuntimeToolRecoveryAction,
  RUNTIME_TOOL_RECOVERY_PROMPT_MAX_CHARS,
  readRuntimeToolSurfaceMetrics,
  recordRuntimeToolSurfaceMetrics,
  type RuntimeToolEventSummary,
  type RuntimeToolRecoveryFeedback,
} from "../../../tools/runtime/tool-events";
import { event, expect, expectEqual, expectPromptIncludes, tmpWorkDir } from "./helpers";

export function runRuntimeToolMetricsAndRepeatContracts(input: {
  contractPath: (name: string) => string;
  events: RuntimeEvent[];
  summary: RuntimeToolEventSummary;
  structuredFeedback: RuntimeToolRecoveryFeedback;
  legacyActionFeedback: RuntimeToolRecoveryFeedback;
  oversizedFeedback: RuntimeToolRecoveryFeedback;
  knownRecoveryActions: readonly string[];
  missingActionSummary: RuntimeToolEventSummary;
}): Record<string, unknown> {
  const nonRecoverableFeedback = buildRuntimeToolRecoveryFeedback({
    metrics: {
      version: 1,
      updatedAt: "2026-04-25T00:01:00.000Z",
      callsTotal: 0,
      failedTotal: 0,
      deferredTotal: 0,
      callsByTool: {},
      failuresByErrorClass: {},
      recoveryStages: { ask_user: 1 },
      recoveryCountsByKey: {},
      latestRecoveryRepeatKey: null,
      latestRecoveryRepeatCount: 0,
      avgDurationMsByTool: {},
      recentRecoveries: [],
      latestRecovery: {
        stage: "ask_user",
        reason: "config_missing",
        recommendedNextAction: "ask_user_for_config_or_switch_provider",
        toolName: "read",
        errorClass: "config_missing",
        recoverable: false,
        observedAt: "2026-04-25T00:01:00.000Z",
      },
      path: input.contractPath("nonrecoverable"),
    },
    nowMs: Date.parse("2026-04-25T00:01:00.000Z"),
  });
  expectEqual(nonRecoverableFeedback.active, true, "nonrecoverable feedback active");
  expectEqual(nonRecoverableFeedback.severity, "warning", "nonrecoverable feedback severity");
  expectEqual(nonRecoverableFeedback.recoverable, false, "nonrecoverable feedback recoverable");
  expectEqual(nonRecoverableFeedback.requiresUserIntervention, true, "nonrecoverable feedback requires intervention");
  expectPromptIncludes(
    nonRecoverableFeedback.promptBlock,
    [
      "Recoverability: requires_user_intervention",
      "Ask the user to provide the missing runtime configuration",
      "Automatic recovery is blocked",
      "Do not retry the failing tool automatically",
    ],
    "nonrecoverable feedback",
  );
  const providerFailureContext = buildProviderFailureToolContext({
    providerName: "kimi",
    errorData: {
      diagnostic_kind: "upstream_http_error",
      source: "model.transport",
      stage: "chat_http_status",
      provider_kind: "kimi",
      model: "kimi-k2.5",
      http_status: 503,
      attempt: 3,
      max_attempts: 3,
      retryable: false,
      body_preview: "must_not_leak",
      response_headers: { "x-request-id": "must_not_leak" },
    },
  });
  expect(
    providerFailureContext.includes("provider=kimi")
      && providerFailureContext.includes("diagnostic_kind=upstream_http_error")
      && providerFailureContext.includes("source=model.transport")
      && providerFailureContext.includes("stage=chat_http_status")
      && providerFailureContext.includes("http_status=503")
      && providerFailureContext.includes("attempt=3")
      && providerFailureContext.includes("max_attempts=3")
      && providerFailureContext.includes("retryable=false"),
    "provider failure tool context includes structured safe diagnostics",
  );
  expect(
    !providerFailureContext.includes("must_not_leak")
      && !providerFailureContext.includes("body_preview")
      && !providerFailureContext.includes("response_headers"),
    "provider failure tool context drops unsafe previews",
  );
  const providerFailureDiagnostics = buildProviderFailureDiagnostics({
    providerName: "kimi",
    errorData: {
      diagnostic_kind: "upstream_http_error",
      source: "model.transport",
      stage: "chat_http_status",
      http_status: 503,
      attempt: 3,
      max_attempts: 3,
      retryable: false,
      body_preview: "must_not_leak",
      response_headers: { "x-request-id": "must_not_leak" },
    },
  });
  expectEqual(
    providerFailureDiagnostics?.diagnosticKind,
    "upstream_http_error",
    "provider failure diagnostics keep structured diagnostic kind",
  );
  expectEqual(providerFailureDiagnostics?.httpStatus, 503, "provider failure diagnostics keep http status");
  expectEqual(providerFailureDiagnostics?.retryable, false, "provider failure diagnostics keep retryability");
  expect(
    !JSON.stringify(providerFailureDiagnostics).includes("must_not_leak")
      && !JSON.stringify(providerFailureDiagnostics).includes("body_preview")
      && !JSON.stringify(providerFailureDiagnostics).includes("response_headers"),
    "provider failure diagnostics drops unsafe previews",
  );
  expectEqual(
    deriveFailureStageFromError("config_invalid", "invalid model config", {
      diagnostic_kind: "config_invalid",
      source: "model_config",
      stage: "catalog_refresh",
    }),
    "planning",
    "structured config provider failure maps to planning stage",
  );
  expectEqual(
    deriveFailureStageFromError("upstream_http_error", "HTTP 503", {
      diagnostic_kind: "upstream_http_error",
      source: "model.transport",
      stage: "chat_http_status",
    }),
    "runtime",
    "structured upstream provider failure maps to runtime stage",
  );

  const turnFailedRuntimeEnvWorkDir = tmpWorkDir("grobot-runtime-turn-failed-env");
  try {
    const turnFailedRuntimeEnvMetrics = recordRuntimeToolSurfaceMetrics({
      workDir: turnFailedRuntimeEnvWorkDir,
      events: [
        event("turn_failed", {
          error_class: "config_missing",
          error_message: "missing required env: GROBOT_API_KEY",
          error_data: {
            diagnostic_kind: "config_missing",
            required_config: "model_config.api_key",
            source: "model_config",
          },
        }),
      ],
    });
    expectEqual(turnFailedRuntimeEnvMetrics.callsTotal, 0, "turn_failed runtime environment recovery does not count a tool call");
    expectEqual(turnFailedRuntimeEnvMetrics.failuresByErrorClass.config_missing, 1, "turn_failed runtime environment recovery records error class");
    expectEqual(
      turnFailedRuntimeEnvMetrics.latestRecovery?.recommendedNextAction,
      "ask_user_for_config_or_switch_provider",
      "turn_failed runtime environment recovery uses config action",
    );
    const turnFailedRuntimeEnvFeedback = buildRuntimeToolRecoveryFeedback({
      metrics: turnFailedRuntimeEnvMetrics,
      nowMs: Date.parse(turnFailedRuntimeEnvMetrics.latestRecovery?.observedAt ?? ""),
    });
    expectEqual(
      turnFailedRuntimeEnvFeedback.runtimeEnvironmentRecovery?.requiredConfig,
      "model_config.api_key",
      "turn_failed runtime environment feedback keeps required config",
    );
  } finally {
    rmSync(turnFailedRuntimeEnvWorkDir, { recursive: true, force: true });
  }

  const turnFailedDiagnosticWorkDir = tmpWorkDir("grobot-runtime-turn-failed-diagnostic");
  try {
    const stderrLines: string[] = [];
    recordRuntimeToolMetricsForEvents({
      workDir: turnFailedDiagnosticWorkDir,
      source: "runtime_failure",
      writeStderr: (message) => {
        stderrLines.push(message);
      },
      events: [
        event("turn_failed", {
          error_class: "config_invalid",
          error_message: "model=auto returned no available models for provider=kimi",
          error_data: {
            diagnostic_kind: "config_invalid",
            source: "model.catalog",
            stage: "auto_model_select",
            provider: "kimi",
            model_count: 0,
            recovery_hint: "set an explicit model or fix provider catalog access",
          },
        }),
      ],
    });
    const turnFailedDiagnosticMetrics = readRuntimeToolSurfaceMetrics(turnFailedDiagnosticWorkDir);
    expectEqual(
      turnFailedDiagnosticMetrics.callsTotal,
      0,
      "turn_failed diagnostic recovery still does not count a tool call",
    );
    expectEqual(
      turnFailedDiagnosticMetrics.latestRecovery?.errorClass,
      "config_invalid",
      "turn_failed diagnostic recovery is persisted by CLI diagnostic bridge",
    );
    expectEqual(
      turnFailedDiagnosticMetrics.latestRecovery?.recommendedNextAction,
      "ask_user_for_config_or_switch_provider",
      "turn_failed diagnostic recovery keeps config action",
    );
    expect(
      stderrLines.some((line) => line.includes("[tool-recovery] stage=ask_user reason=config_invalid")),
      "turn_failed diagnostic recovery emits tool-recovery stderr line",
    );
  } finally {
    rmSync(turnFailedDiagnosticWorkDir, { recursive: true, force: true });
  }

  const workDir = input.contractPath("metrics-state");
  mkdirSync(workDir, { recursive: true });
  try {
    const initial = readRuntimeToolSurfaceMetrics(workDir);
    expectEqual(initial.callsTotal, 0, "initial calls");
    expectEqual(initial.updatedAt, null, "initial updatedAt");

    const first = recordRuntimeToolSurfaceMetrics({ workDir, events: input.events });
    expectEqual(first.callsTotal, 3, "first calls");
    expectEqual(first.failedTotal, 1, "first failed");
    expectEqual(first.deferredTotal, 1, "first deferred");
    expectEqual(first.avgDurationMsByTool.read, 12, "first read avg");
    expectEqual(first.avgDurationMsByTool.edit, 18, "first edit avg");
    expectEqual(first.recentRecoveries.length, 1, "first recent recoveries length");
    expectEqual(first.latestRecovery?.stage, "observe_first", "first latest recovery");
    expectEqual(typeof first.latestRecovery?.observedAt, "string", "first latest recovery observedAt");

    const activeFeedback = buildRuntimeToolRecoveryFeedback({
      metrics: first,
      nowMs: Date.parse(first.latestRecovery?.observedAt ?? ""),
    });
    expectEqual(activeFeedback.active, true, "active feedback enabled");
    expectEqual(activeFeedback.severity, "info", "active feedback severity");
    expectEqual(activeFeedback.recommendedNextAction, "observe_prior_tool_result", "active feedback action");
    expectEqual(
      activeFeedback.errorMessage,
      "deferred until the prior high-risk tool result is observed",
      "active feedback error detail",
    );
    expectEqual(activeFeedback.recoverable, true, "active feedback recoverable");
    expectEqual(activeFeedback.requiresUserIntervention, false, "active feedback does not require intervention");
    expectPromptIncludes(
      activeFeedback.promptBlock,
      [
        "Error detail: deferred until",
        "Recoverability: auto_recoverable",
        "do not repeat an identical failing tool call",
      ],
      "active feedback",
    );

    const readBack = readRuntimeToolSurfaceMetrics(workDir);
    expectEqual(readBack.callsTotal, 3, "readback calls");
    expectEqual(readBack.recentRecoveries.length, 1, "readback recent recoveries length");
    expectEqual(readBack.latestRecovery?.recommendedNextAction, "observe_prior_tool_result", "readback latest action");

    const second = recordRuntimeToolSurfaceMetrics({ workDir, events: input.events.slice(0, 2) });
    expectEqual(second.callsTotal, 5, "second cumulative calls");
    expectEqual(second.failedTotal, 2, "second cumulative failed");
    expectEqual(second.callsByTool.read, 2, "second read count");
    expectEqual(second.callsByTool.edit, 2, "second edit count");
    expectEqual(second.recentRecoveries.length, 1, "second recent recoveries length is unchanged without recovery events");

    const staleFeedback = buildRuntimeToolRecoveryFeedback({
      metrics: second,
      nowMs: Date.parse(second.latestRecovery?.observedAt ?? "") + 2_000,
      maxAgeMs: 1,
    });
    expectEqual(staleFeedback.active, false, "stale feedback disabled");
    expectEqual(staleFeedback.reason, "stale_recovery", "stale feedback reason");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  const repeatedWorkDir = input.contractPath("repeated-recovery");
  mkdirSync(repeatedWorkDir, { recursive: true });
  try {
    const oldStateDir = join(repeatedWorkDir, ".grobot/runtime");
    mkdirSync(oldStateDir, { recursive: true });
    writeFileSync(
      join(oldStateDir, "tool-surface-metrics.json"),
      `${JSON.stringify({
        version: 1,
        updatedAt: "2026-04-25T00:00:00.000Z",
        callsTotal: 0,
        failedTotal: 0,
        deferredTotal: 0,
        callsByTool: {},
        failuresByErrorClass: {},
        recoveryStages: {},
        durationTotalMsByTool: {},
        durationCountByTool: {},
        recentRecoveries: [],
      }, null, 2)}\n`,
      "utf8",
    );
    const oldStateReadback = readRuntimeToolSurfaceMetrics(repeatedWorkDir);
    expectEqual(Object.keys(oldStateReadback.recoveryCountsByKey).length, 0, "old state without recoveryCountsByKey is backward tolerant");
    expectEqual(oldStateReadback.latestRecoveryRepeatKey, null, "old state repeat key defaults null");
    expectEqual(oldStateReadback.latestRecoveryRepeatCount, 0, "old state repeat count defaults zero");

    const repeatedRecoveryEvents: RuntimeEvent[] = [
      event("tool_end", {
        tool_name: "read",
        status: "failed",
        error_class: "path_not_found",
        duration_ms: 4,
      }),
      event("tool_recovery", {
        tool_name: "read",
        error_class: "path_not_found",
        recovery_stage: "local_fix",
        recovery_reason: "path_not_found",
        recommended_next_action: "locate_path_with_glob_before_retry",
        recoverable: true,
      }),
    ];

    const firstRepeated = recordRuntimeToolSurfaceMetrics({
      workDir: repeatedWorkDir,
      events: repeatedRecoveryEvents,
    });
    expectEqual(firstRepeated.latestRecovery?.stage, "local_fix", "first repeated recovery keeps local fix");
    expectEqual(firstRepeated.latestRecovery?.sameToolErrorCount, 1, "first repeated recovery count");
    expectEqual(firstRepeated.latestRecovery?.escalated, false, "first repeated recovery not escalated");
    expectEqual(firstRepeated.recoveryCountsByKey["tool_error:read:path_not_found"], 1, "first repeated recovery key count");
    expectEqual(firstRepeated.latestRecoveryRepeatKey, "tool_error:read:path_not_found", "first latest repeat key");
    expectEqual(firstRepeated.latestRecoveryRepeatCount, 1, "first latest repeat count");

    const secondRepeated = recordRuntimeToolSurfaceMetrics({
      workDir: repeatedWorkDir,
      events: repeatedRecoveryEvents,
    });
    const secondFeedback = buildRuntimeToolRecoveryFeedback({
      metrics: secondRepeated,
      nowMs: Date.parse(secondRepeated.latestRecovery?.observedAt ?? ""),
    });
    expectEqual(secondRepeated.latestRecovery?.stage, "strategy_switch", "second repeated recovery escalates stage");
    expectEqual(secondRepeated.latestRecovery?.recommendedNextAction, "switch_tool_strategy", "second repeated recovery escalates action");
    expectEqual(secondRepeated.latestRecovery?.recoverable, true, "second repeated recovery remains recoverable");
    expectEqual(secondRepeated.latestRecovery?.sameToolErrorCount, 2, "second repeated recovery count");
    expectEqual(secondRepeated.latestRecovery?.escalated, true, "second repeated recovery escalated flag");
    expectEqual(secondRepeated.latestRecovery?.escalationReason, "same_tool_error_repeated", "second repeated recovery reason");
    expectEqual(secondRepeated.latestRecovery?.baseStage, "local_fix", "second repeated recovery base stage");
    expectEqual(
      secondRepeated.latestRecovery?.baseRecommendedNextAction,
      "locate_path_with_glob_before_retry",
      "second repeated recovery base action",
    );
    expectEqual(secondRepeated.latestRecoveryRepeatCount, 2, "second latest repeat count");
    expectEqual(secondFeedback.active, true, "second repeated feedback active");
    expectEqual(secondFeedback.reason, "repeated_recovery_escalated", "second repeated feedback reason");
    expectEqual(secondFeedback.severity, "warning", "second repeated feedback severity");
    expectEqual(secondFeedback.requiresUserIntervention, false, "second repeated feedback remains automatic");
    expect(secondFeedback.promptBlock.includes("same_tool_error_count=2 escalated=true"), "second repeated feedback prompt includes repeat count");
    expect(
      formatRuntimeToolRecoveryEscalationFields(secondFeedback).includes("base_recovery_stage=local_fix"),
      "second repeated feedback formats base stage",
    );
    expect(
      formatRuntimeToolRecoveryEscalationFields(secondFeedback).includes("escalation_policy_version=v1"),
      "second repeated feedback formats policy version",
    );

    const thirdRepeated = recordRuntimeToolSurfaceMetrics({
      workDir: repeatedWorkDir,
      events: repeatedRecoveryEvents,
    });
    const thirdFeedback = buildRuntimeToolRecoveryFeedback({
      metrics: thirdRepeated,
      nowMs: Date.parse(thirdRepeated.latestRecovery?.observedAt ?? ""),
    });
    expectEqual(thirdRepeated.latestRecovery?.stage, "ask_user", "third repeated recovery escalates to ask_user");
    expectEqual(thirdRepeated.latestRecovery?.recommendedNextAction, "ask_user_for_config_or_switch_provider", "third repeated recovery asks user");
    expectEqual(thirdRepeated.latestRecovery?.recoverable, false, "third repeated recovery blocks automatic retry");
    expectEqual(thirdRepeated.latestRecovery?.requiresUserIntervention, true, "third repeated recovery intervention");
    expectEqual(thirdRepeated.latestRecovery?.sameToolErrorCount, 3, "third repeated recovery count");
    expectEqual(thirdRepeated.latestRecovery?.escalationReason, "same_tool_error_exhausted", "third repeated recovery exhausted reason");
    expectEqual(thirdRepeated.recoveryCountsByKey["tool_error:read:path_not_found"], 3, "third repeated recovery key count");
    expectEqual(thirdRepeated.latestRecoveryRepeatCount, 3, "third latest repeat count");
    expectEqual(thirdFeedback.requiresUserIntervention, true, "third repeated feedback requires intervention");
    expect(thirdFeedback.promptBlock.includes("Automatic recovery is blocked"), "third repeated feedback blocks automatic retry");

    const successReset = recordRuntimeToolSurfaceMetrics({
      workDir: repeatedWorkDir,
      events: [
        event("tool_end", {
          tool_name: "read",
          status: "ok",
          duration_ms: 3,
        }),
      ],
    });
    expectEqual(successReset.latestRecoveryRepeatKey, null, "successful tool batch resets repeat key");
    expectEqual(successReset.latestRecoveryRepeatCount, 0, "successful tool batch resets repeat count");

    const afterReset = recordRuntimeToolSurfaceMetrics({
      workDir: repeatedWorkDir,
      events: repeatedRecoveryEvents,
    });
    expectEqual(afterReset.latestRecovery?.stage, "local_fix", "after reset recovery does not stay escalated");
    expectEqual(afterReset.latestRecovery?.sameToolErrorCount, 1, "after reset recovery count restarts");
    const mismatchedClear = clearRuntimeToolRecoveryRepeatPressure({
      workDir: repeatedWorkDir,
      toolName: "web_scan",
      errorClass: "path_not_found",
      nowIso: "2026-04-25T00:02:00.000Z",
    });
    expectEqual(mismatchedClear.cleared, false, "mismatched repeat pressure clear is ignored");
    expectEqual(mismatchedClear.snapshot.latestRecoveryRepeatCount, 1, "mismatched clear keeps repeat count");
    const matchingClear = clearRuntimeToolRecoveryRepeatPressure({
      workDir: repeatedWorkDir,
      toolName: "read",
      errorClass: "path_not_found",
      nowIso: "2026-04-25T00:02:01.000Z",
    });
    expectEqual(matchingClear.cleared, true, "matching repeat pressure clear succeeds");
    expectEqual(matchingClear.snapshot.latestRecoveryRepeatKey, null, "matching clear resets repeat key");
    expectEqual(matchingClear.snapshot.latestRecoveryRepeatCount, 0, "matching clear resets repeat count");
  } finally {
    rmSync(repeatedWorkDir, { recursive: true, force: true });
  }

  runRepeatedEnvironmentScenario({
    prefix: "grobot-runtime-tool-browser-repeated",
    toolName: "web_scan",
    errorClass: "browser_backend_result_error",
    errorMessage: "web_scan backend returned error_code=NO_EXTENSION: Browser extension is not connected.",
    errorData: {
      diagnostic_kind: "browser_backend_result_error",
      tool: "web_scan",
      backend: "browser-structured",
      mapped_tool: "browser_scan",
      operation: "backend_result",
      error_code: "NO_EXTENSION",
      retryable: true,
      transport_attempts_count: 1,
      browser_context_kind: "unknown",
      diagnostic_hint: "Browser extension is not connected. Run `grobot browser setup`.",
    },
    firstMessagePrefix: "browser first",
    secondMessagePrefix: "browser repeated",
    expectedSecondEscalationReason: "browser_environment_error_repeated",
    assertSecondFeedback: (feedback) => {
      expectEqual(feedback.requiresUserIntervention, true, "browser repeated feedback requires intervention");
      expectEqual(feedback.browserEnvironmentRecovery?.errorCode, "NO_EXTENSION", "browser repeated feedback exposes browser recovery error code");
      expectEqual(feedback.browserEnvironmentRecovery?.action, "setup_and_doctor", "browser repeated feedback exposes browser recovery action");
      expectPromptIncludes(
        feedback.promptBlock,
        [
          "request_environment_fix",
          "Execution rule: Ask the user to repair the browser environment",
          "until `grobot browser doctor` confirms the environment is ready",
          "Browser environment fix: Do not retry web_scan automatically.",
          "`grobot browser setup`",
          "`grobot browser doctor`",
          "browser_environment_error_repeated",
        ],
        "browser repeated feedback",
      );
      expect(
        !feedback.promptBlock.includes(
          "Execution rule: Ask the user to fix the environment or configuration before retrying.",
        ),
        "browser repeated feedback avoids generic environment instruction",
      );
    },
  });

  runRepeatedEnvironmentScenario({
    prefix: "grobot-runtime-tool-mcp-repeated",
    toolName: "mcp_call",
    errorClass: "mcp_spawn_failed",
    errorMessage: "failed to spawn MCP server `npx`: command not found",
    errorData: {
      diagnostic_kind: "mcp_spawn_failed",
      server: "grok-search",
      server_key: "grok-search",
      tool_name: "web_search",
      operation: "spawn_server",
      command: "npx",
      recovery_hint: "fix MCP server command/configuration before retrying",
    },
    firstMessagePrefix: "MCP first",
    secondMessagePrefix: "MCP repeated",
    expectedSecondEscalationReason: "mcp_environment_error_repeated",
    baseRecommendedNextAction: "retry_with_smaller_scope_or_wait",
    assertSecondFeedback: (feedback) => {
      expectEqual(feedback.mcpEnvironmentRecovery?.errorCode, "SPAWN_FAILED", "MCP repeated feedback exposes recovery error code");
      expectEqual(feedback.mcpEnvironmentRecovery?.action, "fix_server_command_and_check_status", "MCP repeated feedback exposes recovery action");
      expectPromptIncludes(
        feedback.promptBlock,
        [
          "Execution rule: Ask the user to repair MCP server configuration",
          "MCP environment fix: Do not retry mcp_call automatically.",
          "mcp_environment_error_repeated",
        ],
        "MCP repeated feedback",
      );
    },
  });

  const browserTimeoutWorkDir = tmpWorkDir("grobot-runtime-tool-browser-timeout");
  try {
    const browserTimeoutRecoveryEvents: RuntimeEvent[] = [
      event("tool_end", {
        tool_name: "web_execute_js",
        status: "failed",
        error_class: "browser_backend_result_error",
        duration_ms: 20,
      }),
      event("tool_recovery", {
        tool_name: "web_execute_js",
        error_class: "browser_backend_result_error",
        error_message: "web_execute_js backend returned error_code=TIMEOUT.",
        error_data: {
          diagnostic_kind: "browser_backend_result_error",
          tool: "web_execute_js",
          backend: "browser-structured",
          mapped_tool: "browser_execute_js",
          operation: "backend_result",
          error_code: "TIMEOUT",
          retryable: true,
        },
        recovery_stage: "strategy_switch",
        recovery_reason: "browser_backend_result_error",
        recommended_next_action: "inspect_error_and_switch_strategy",
        recoverable: true,
      }),
    ];

    const timeoutFirst = recordRuntimeToolSurfaceMetrics({
      workDir: browserTimeoutWorkDir,
      events: browserTimeoutRecoveryEvents,
    });
    expectEqual(timeoutFirst.latestRecovery?.stage, "strategy_switch", "browser timeout first stays strategy switch");
    expectEqual(timeoutFirst.latestRecovery?.sameToolErrorCount, 1, "browser timeout first count");
    expectEqual(timeoutFirst.latestRecovery?.escalated, false, "browser timeout first not escalated");

    const timeoutSecond = recordRuntimeToolSurfaceMetrics({
      workDir: browserTimeoutWorkDir,
      events: browserTimeoutRecoveryEvents,
    });
    expectEqual(timeoutSecond.latestRecovery?.stage, "strategy_switch", "browser timeout second stays strategy switch");
    expectEqual(
      timeoutSecond.latestRecovery?.recommendedNextAction,
      "inspect_error_and_switch_strategy",
      "browser timeout second keeps base action",
    );
    expectEqual(timeoutSecond.latestRecovery?.recoverable, true, "browser timeout second remains recoverable");
    expectEqual(timeoutSecond.latestRecovery?.sameToolErrorCount, 2, "browser timeout second count");
    expectEqual(timeoutSecond.latestRecovery?.escalated, false, "browser timeout second not escalated early");

    const timeoutThird = recordRuntimeToolSurfaceMetrics({
      workDir: browserTimeoutWorkDir,
      events: browserTimeoutRecoveryEvents,
    });
    expectEqual(timeoutThird.latestRecovery?.stage, "ask_user", "browser timeout third follows generic ask_user");
    expectEqual(timeoutThird.latestRecovery?.recommendedNextAction, "ask_user_for_config_or_switch_provider", "browser timeout third uses generic user action");
    expectEqual(timeoutThird.latestRecovery?.escalationReason, "same_tool_error_exhausted", "browser timeout third uses generic escalation reason");
  } finally {
    rmSync(browserTimeoutWorkDir, { recursive: true, force: true });
  }

  const runtimeError = new RuntimeRpcError({
    message: "runtime rpc error -32001: runtime turn execution failed",
    errorClass: "edit_stale_target",
    errorMessage: "stale edit target",
    traceId: "trace_runtime_tool_events_contract",
    runtimeEvents: input.events,
  });
  expectEqual(extractRuntimeErrorEvents(runtimeError).length, input.events.length, "runtime error events extracted");
  expectEqual(extractRuntimeErrorEvents(new Error("plain")).length, 0, "plain error has no runtime events");
  expect(input.summary.latestRecovery !== undefined, "latest recovery exists");

  return {
    ok: true,
    summary_calls_total: input.summary.callsTotal,
    summary_failed_total: input.summary.failedTotal,
    summary_deferred_total: input.summary.deferredTotal,
    latest_recovery_stage: input.summary.latestRecovery?.stage,
    runtime_error_events: extractRuntimeErrorEvents(runtimeError).length,
    feedback_active: true,
    feedback_prompt_action_first: input.structuredFeedback.promptBlock.includes("Action-first contract:"),
    feedback_prompt_action_in_catalog: isRuntimeToolRecoveryAction(input.structuredFeedback.recommendedNextAction ?? ""),
    legacy_action_prompt_fallback: input.legacyActionFeedback.recommendedNextAction,
    feedback_prompt_budget_max_chars: RUNTIME_TOOL_RECOVERY_PROMPT_MAX_CHARS,
    feedback_prompt_budget_within_limit: input.oversizedFeedback.promptBlock.length <= RUNTIME_TOOL_RECOVERY_PROMPT_MAX_CHARS,
    feedback_prompt_budget_truncated_details: input.oversizedFeedback.promptBlock.includes("Details truncated: omitted"),
    latest_recovery_recoverable: input.summary.latestRecovery?.recoverable,
    provider_failure_context_has_structured_fields:
      providerFailureContext.includes("diagnostic_kind=upstream_http_error")
      && providerFailureContext.includes("http_status=503"),
    provider_failure_context_drops_unsafe_fields:
      !providerFailureContext.includes("body_preview")
      && !providerFailureContext.includes("response_headers"),
    provider_failure_diagnostics_has_typed_fields:
      providerFailureDiagnostics?.diagnosticKind === "upstream_http_error"
      && providerFailureDiagnostics.httpStatus === 503,
    provider_failure_diagnostics_drops_unsafe_fields:
      !JSON.stringify(providerFailureDiagnostics).includes("body_preview")
      && !JSON.stringify(providerFailureDiagnostics).includes("response_headers"),
    nonrecoverable_requires_user_intervention: nonRecoverableFeedback.requiresUserIntervention,
    repeated_recovery_escalation: true,
    recovery_action_catalog_size: input.knownRecoveryActions.length,
    missing_action_default: input.missingActionSummary.latestRecovery?.recommendedNextAction,
  };
}

function runRepeatedEnvironmentScenario(input: {
  prefix: string;
  toolName: string;
  errorClass: string;
  errorMessage: string;
  errorData: Record<string, unknown>;
  firstMessagePrefix: string;
  secondMessagePrefix: string;
  expectedSecondEscalationReason: string;
  baseRecommendedNextAction?: string;
  assertSecondFeedback: (feedback: RuntimeToolRecoveryFeedback) => void;
}): void {
  const workDir = tmpWorkDir(input.prefix);
  try {
    const repeatedRecoveryEvents: RuntimeEvent[] = [
      event("tool_end", {
        tool_name: input.toolName,
        status: "failed",
        error_class: input.errorClass,
        duration_ms: 8,
      }),
      event("tool_recovery", {
        tool_name: input.toolName,
        error_class: input.errorClass,
        error_message: input.errorMessage,
        error_data: input.errorData,
        recovery_stage: "strategy_switch",
        recovery_reason: input.errorClass,
        recommended_next_action: input.baseRecommendedNextAction ?? "inspect_error_and_switch_strategy",
        recoverable: true,
      }),
    ];

    const first = recordRuntimeToolSurfaceMetrics({
      workDir,
      events: repeatedRecoveryEvents,
    });
    expectEqual(first.latestRecovery?.stage, "strategy_switch", `${input.firstMessagePrefix} recovery stays strategy switch`);
    expectEqual(first.latestRecovery?.sameToolErrorCount, 1, `${input.firstMessagePrefix} recovery count`);
    expectEqual(first.latestRecovery?.escalated, false, `${input.firstMessagePrefix} recovery not escalated`);

    const second = recordRuntimeToolSurfaceMetrics({
      workDir,
      events: repeatedRecoveryEvents,
    });
    const feedback = buildRuntimeToolRecoveryFeedback({
      metrics: second,
      nowMs: Date.parse(second.latestRecovery?.observedAt ?? ""),
    });
    expectEqual(second.latestRecovery?.stage, "ask_user", `${input.secondMessagePrefix} environment recovery asks user`);
    expectEqual(second.latestRecovery?.recommendedNextAction, "request_environment_fix", `${input.secondMessagePrefix} recovery asks environment fix`);
    expectEqual(second.latestRecovery?.recoverable, false, `${input.secondMessagePrefix} recovery blocks automatic retry`);
    expectEqual(second.latestRecovery?.requiresUserIntervention, true, `${input.secondMessagePrefix} recovery requires intervention`);
    expectEqual(second.latestRecovery?.sameToolErrorCount, 2, `${input.secondMessagePrefix} recovery count`);
    expectEqual(second.latestRecovery?.escalated, true, `${input.secondMessagePrefix} recovery escalated flag`);
    expectEqual(second.latestRecovery?.escalationReason, input.expectedSecondEscalationReason, `${input.secondMessagePrefix} recovery reason`);
    input.assertSecondFeedback(feedback);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
