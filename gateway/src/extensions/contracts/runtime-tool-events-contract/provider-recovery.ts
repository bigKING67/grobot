import {
  buildRuntimeToolRecoveryFeedback,
  summarizeRuntimeToolEvents,
} from "../../../tools/runtime/tool-events";
import { event, expect, expectEqual } from "./helpers";

export function runRuntimeToolProviderRecoveryContracts(input: {
  contractPath: (name: string) => string;
  structuredRecoveryObservedAt: string;
}): void {
  const { contractPath, structuredRecoveryObservedAt } = input;

  const configInvalidTurnFailedSummary = summarizeRuntimeToolEvents([
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
  ]);
  expectEqual(
    configInvalidTurnFailedSummary.latestRecovery?.recommendedNextAction,
    "ask_user_for_config_or_switch_provider",
    "turn_failed config_invalid uses config recovery action",
  );
  const configInvalidFeedback = buildRuntimeToolRecoveryFeedback({
    metrics: {
      version: 1,
      updatedAt: structuredRecoveryObservedAt,
      callsTotal: 0,
      failedTotal: 0,
      deferredTotal: 0,
      callsByTool: {},
      failuresByErrorClass: { config_invalid: 1 },
      recoveryStages: { ask_user: 1 },
      recoveryCountsByKey: {},
      latestRecoveryRepeatKey: null,
      latestRecoveryRepeatCount: 0,
      avgDurationMsByTool: {},
      recentRecoveries: [],
      latestRecovery: configInvalidTurnFailedSummary.latestRecovery ?? null,
      path: contractPath("runtime-config-invalid"),
    },
    nowMs: Date.parse(structuredRecoveryObservedAt),
  });
  expectEqual(
    configInvalidFeedback.runtimeEnvironmentRecovery?.errorCode,
    "CONFIG_INVALID",
    "runtime config_invalid feedback exposes recovery code",
  );
  expect(
    configInvalidFeedback.promptBlock.includes("fix invalid config or switch provider/tool path"),
    "runtime config_invalid feedback asks to fix invalid config",
  );
  expect(
    configInvalidFeedback.promptBlock.includes("Structured error data: provider=kimi source=model.catalog stage=auto_model_select model_count=0 recovery_hint=\"set an explicit model"),
    "runtime config_invalid feedback summarizes model catalog diagnostics",
  );

  const providerHttpTurnFailedSummary = summarizeRuntimeToolEvents([
    event("turn_failed", {
      error_class: "upstream_http_error",
      error_message: "upstream status=503 thinking=disabled body=provider overloaded",
      error_data: {
        diagnostic_kind: "upstream_http_error",
        source: "model.transport",
        stage: "chat_http_status",
        provider: "kimi",
        http_status: 503,
        attempt: 3,
        max_attempts: 3,
        retryable: false,
        body_preview: "provider overloaded",
        response_headers: "retry-after=30",
        recovery_hint: "inspect provider status/body, adjust request or retry after provider-side recovery",
      },
    }),
  ]);
  expectEqual(
    providerHttpTurnFailedSummary.latestRecovery?.toolName,
    "model_provider",
    "turn_failed provider recovery uses synthetic provider tool identity",
  );
  expectEqual(
    providerHttpTurnFailedSummary.latestRecovery?.recommendedNextAction,
    "ask_user_for_config_or_switch_provider",
    "turn_failed provider exhausted HTTP recovery asks user/switch provider",
  );
  const providerHttpFeedback = buildRuntimeToolRecoveryFeedback({
    metrics: {
      version: 1,
      updatedAt: structuredRecoveryObservedAt,
      callsTotal: 0,
      failedTotal: 0,
      deferredTotal: 0,
      callsByTool: {},
      failuresByErrorClass: { upstream_http_error: 1 },
      recoveryStages: { ask_user: 1 },
      recoveryCountsByKey: {},
      latestRecoveryRepeatKey: null,
      latestRecoveryRepeatCount: 0,
      avgDurationMsByTool: {},
      recentRecoveries: [],
      latestRecovery: providerHttpTurnFailedSummary.latestRecovery ?? null,
      path: contractPath("provider-http-turn-failed"),
    },
    nowMs: Date.parse(structuredRecoveryObservedAt),
  });
  expectEqual(
    providerHttpFeedback.actionFamily,
    "user_intervention",
    "turn_failed provider HTTP feedback classifies exhausted retry as user intervention",
  );
  expect(
    providerHttpFeedback.promptBlock.includes("Recent tool issue: stage=ask_user tool=model_provider error_class=upstream_http_error"),
    "turn_failed provider HTTP feedback surfaces provider issue identity",
  );
  expect(
    providerHttpFeedback.promptBlock.includes("Execution rule: Ask the user to inspect provider status/body"),
    "turn_failed provider HTTP feedback uses provider-specific execution rule",
  );
  expect(
    providerHttpFeedback.promptBlock.includes("Structured error data: provider=kimi source=model.transport stage=chat_http_status http_status=503 attempt=3 max_attempts=3 retryable=false"),
    "turn_failed provider HTTP feedback summarizes provider status and retry diagnostics",
  );
  expect(
    providerHttpFeedback.promptBlock.includes("body_preview=\"provider overloaded\"")
    && providerHttpFeedback.promptBlock.includes("response_headers=\"retry-after=30\""),
    "turn_failed provider HTTP feedback preserves provider response previews",
  );

  const providerRetryableTurnFailedSummary = summarizeRuntimeToolEvents([
    event("turn_failed", {
      error_class: "upstream_timeout",
      error_message: "model request timed out",
      error_data: {
        diagnostic_kind: "upstream_timeout",
        source: "model.transport",
        stage: "chat_request",
        provider: "kimi",
        attempt: 1,
        max_attempts: 3,
        retryable: true,
        upstream_error_kind: "timeout",
        recovery_hint: "retry later or verify provider network connectivity",
      },
    }),
  ]);
  expectEqual(
    providerRetryableTurnFailedSummary.latestRecovery?.recommendedNextAction,
    "retry_with_smaller_scope_or_wait",
    "turn_failed retryable provider recovery stays automatic wait/retry",
  );
  const providerRetryableFeedback = buildRuntimeToolRecoveryFeedback({
    metrics: {
      version: 1,
      updatedAt: structuredRecoveryObservedAt,
      callsTotal: 0,
      failedTotal: 0,
      deferredTotal: 0,
      callsByTool: {},
      failuresByErrorClass: { upstream_timeout: 1 },
      recoveryStages: { strategy_switch: 1 },
      recoveryCountsByKey: {},
      latestRecoveryRepeatKey: null,
      latestRecoveryRepeatCount: 0,
      avgDurationMsByTool: {},
      recentRecoveries: [],
      latestRecovery: providerRetryableTurnFailedSummary.latestRecovery ?? null,
      path: contractPath("provider-retryable-turn-failed"),
    },
    nowMs: Date.parse(structuredRecoveryObservedAt),
  });
  expectEqual(
    providerRetryableFeedback.actionFamily,
    "wait_or_retry",
    "turn_failed retryable provider feedback classifies as wait/retry",
  );
  expect(
    providerRetryableFeedback.promptBlock.includes("Execution rule: Retry provider request only after changing one variable"),
    "turn_failed retryable provider feedback uses provider retry discipline",
  );
  expect(
    providerRetryableFeedback.promptBlock.includes("Structured error data: provider=kimi source=model.transport stage=chat_request upstream_error_kind=timeout attempt=1 max_attempts=3 retryable=true"),
    "turn_failed retryable provider feedback summarizes retry attempt diagnostics",
  );

  const providerExhaustedImplicitSummary = summarizeRuntimeToolEvents([
    event("turn_failed", {
      error_class: "upstream_connect_failed",
      error_message: "model request failed after final connect attempt",
      error_data: {
        diagnostic_kind: "upstream_connect_failed",
        source: "model.transport",
        stage: "chat_request",
        provider: "kimi",
        attempt: 3,
        max_attempts: 3,
        upstream_error_kind: "connect",
      },
    }),
  ]);
  expectEqual(
    providerExhaustedImplicitSummary.latestRecovery?.recommendedNextAction,
    "ask_user_for_config_or_switch_provider",
    "turn_failed provider recovery treats exhausted attempts as non-automatic even without retryable field",
  );
}
