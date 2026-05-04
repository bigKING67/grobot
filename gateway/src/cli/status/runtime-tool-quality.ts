import { existsSync } from "node:fs";
import { runRuntimeHealthcheck } from "../runtime-health";
import {
  type RuntimeToolEnabledToolsSource,
} from "../services/runtime-tool-describe-decision";
import type { RuntimeToolRecoveryHealthSummary } from "../../tools/runtime/tool-recovery-timeline";
import type { RuntimeToolRecoveryReadinessGateDecision } from "../../tools/runtime/tool-recovery-readiness-gate";
import {
  type RuntimeToolSurfaceProjectionSummary,
} from "../../tools/runtime/default-enabled-tools";
import {
  RUNTIME_TOOL_SURFACE_BUDGET_POLICY_VERSION,
  validateRuntimeToolSurfaceBudget,
} from "../../tools/runtime/tool-surface-budget";
import { resolveRuntimeToolQualitySignalFromRegistry } from "./runtime-tool-quality-registry";

type RuntimeToolQualityStatus = "ok" | "warn" | "fail";
type RuntimeToolQualityActionFamily =
  | "none"
  | "runtime_environment"
  | "runtime_describe"
  | "schema_projection"
  | "schema_budget"
  | "recovery_gate"
  | "recovery_health";
type RuntimeToolQualityFailureReason =
  | "runtime_binary_missing"
  | "runtime_health_failed"
  | "schema_projection_drift_active"
  | "schema_budget_violated"
  | "recovery_gate_blocking";
type RuntimeToolQualityWarningReason =
  | "runtime_tools_describe_fallback"
  | "schema_projection_drift_not_checked"
  | "recovery_gate_warn"
  | `recovery_health_${RuntimeToolRecoveryHealthSummary["level"]}`;
type RuntimeToolQualityReason = RuntimeToolQualityFailureReason | RuntimeToolQualityWarningReason;
type RuntimeToolQualityActionRequired = string;

const RUNTIME_TOOL_QUALITY_SCHEMA_VERSION = 1;
const RUNTIME_TOOL_QUALITY_FAILURE_REASONS: readonly RuntimeToolQualityFailureReason[] = [
  "runtime_binary_missing",
  "runtime_health_failed",
  "schema_projection_drift_active",
  "schema_budget_violated",
  "recovery_gate_blocking",
];
const RUNTIME_TOOL_QUALITY_WARNING_REASONS: readonly RuntimeToolQualityWarningReason[] = [
  "runtime_tools_describe_fallback",
  "schema_projection_drift_not_checked",
  "recovery_gate_warn",
  "recovery_health_good",
  "recovery_health_watch",
  "recovery_health_risk",
];

export interface RuntimeToolQualitySummary {
  quality_schema_version: typeof RUNTIME_TOOL_QUALITY_SCHEMA_VERSION;
  status: RuntimeToolQualityStatus;
  passed: boolean;
  source: "status.runtime_tools";
  failure_reasons: RuntimeToolQualityFailureReason[];
  warning_reasons: RuntimeToolQualityWarningReason[];
  runtime_impl: string;
  runtime_binary_exists: boolean | null;
  runtime_health_ok: boolean | null;
  runtime_health_detail: string | null;
  runtime_describe_source: RuntimeToolEnabledToolsSource;
  runtime_describe_detail: string | null;
  schema_projection_source: RuntimeToolSurfaceProjectionSummary["source"];
  schema_projection_drift_checked: boolean;
  schema_projection_drift_active: boolean;
  schema_projection_drift_reason: string;
  schema_budget_policy_version: string;
  schema_budget_status: "passed" | "failed";
  schema_budget_violations: number;
  schema_budget_violation_codes: string[];
  recovery_health_level: RuntimeToolRecoveryHealthSummary["level"];
  recovery_health_score: number;
  recovery_health_reason: string;
  recovery_gate_status: RuntimeToolRecoveryReadinessGateDecision["status"];
  recovery_gate_blocking: boolean;
  recovery_gate_reason: RuntimeToolRecoveryReadinessGateDecision["reason"];
  latest_recovery_stage: RuntimeToolRecoveryHealthSummary["latestStage"];
  latest_recovery_tool_name: string | null;
  latest_recovery_error_class: string | null;
  latest_blocker_kind: RuntimeToolRecoveryReadinessGateDecision["blockerKind"] | null;
  blocker_code: string | null;
  blocker_action: string | null;
  action_family: RuntimeToolQualityActionFamily;
  action_reason: RuntimeToolQualityReason | null;
  action_required: RuntimeToolQualityActionRequired | null;
  actionable_next_step: string | null;
}

function resolveRuntimeToolQualityAction(input: {
  failureReasons: readonly RuntimeToolQualityFailureReason[];
  warningReasons: readonly RuntimeToolQualityWarningReason[];
}): {
  actionFamily: RuntimeToolQualityActionFamily;
  actionReason: RuntimeToolQualityReason | null;
  actionRequired: RuntimeToolQualityActionRequired | null;
  defaultNextStep: string | null;
} {
  const signal = resolveRuntimeToolQualitySignalFromRegistry({
    actionReasons: [...input.failureReasons, ...input.warningReasons],
    surface: "status",
  });
  if (signal) {
    return {
      actionFamily: signal.actionFamily as RuntimeToolQualityActionFamily,
      actionReason: signal.actionReason as RuntimeToolQualityReason,
      actionRequired: signal.actionRequired,
      defaultNextStep: signal.defaultNextStep,
    };
  }
  return {
    actionFamily: "none",
    actionReason: null,
    actionRequired: null,
    defaultNextStep: null,
  };
}

function resolveRuntimeToolQualityActionableNextStep(input: {
  actionReason: RuntimeToolQualityReason | null;
  defaultNextStep: string | null;
  runtimeHealthDetail: string | null;
  runtimeDescribeDetail: string | null;
  recoveryGateBlockerKind: RuntimeToolRecoveryReadinessGateDecision["blockerKind"];
  recoveryGateBlockerAction: string | null;
  recoveryHealthRecommendedNextAction: string | null;
}): string | null {
  switch (input.actionReason) {
    case "runtime_health_failed":
      return input.runtimeHealthDetail
        ? `Inspect runtime health failure (${input.runtimeHealthDetail}), then rerun \`grobot status --json\`.`
        : input.defaultNextStep;
    case "recovery_gate_blocking":
      return input.recoveryGateBlockerAction
        ? `Resolve runtime recovery gate blocker (${input.recoveryGateBlockerKind}:${input.recoveryGateBlockerAction}), then rerun \`grobot status --json\`.`
        : input.defaultNextStep;
    case "runtime_tools_describe_fallback":
      return input.runtimeDescribeDetail
        ? `Restore runtime.tools.describe availability (${input.runtimeDescribeDetail}), then rerun \`grobot status --json\`.`
        : input.defaultNextStep;
    case "recovery_gate_warn":
      return input.recoveryGateBlockerAction
        ? `Review runtime recovery gate warning (${input.recoveryGateBlockerAction}), then rerun \`grobot status --json\`.`
        : input.defaultNextStep;
    case "recovery_health_watch":
    case "recovery_health_risk":
      return input.recoveryHealthRecommendedNextAction
        ? `Review recent runtime tool recovery health (${input.recoveryHealthRecommendedNextAction}), then clear repeated failures.`
        : input.defaultNextStep;
    case "recovery_health_good":
      return null;
    default:
      return input.defaultNextStep;
  }
}

function runtimeToolRecoveryHealthWarningReason(
  level: RuntimeToolRecoveryHealthSummary["level"],
): RuntimeToolQualityWarningReason {
  return `recovery_health_${level}` as RuntimeToolQualityWarningReason;
}

export function buildRuntimeToolQualitySummary(input: {
  runtimeImpl: string;
  runtimeBinaryPath?: string;
  runtimeHealth?: ReturnType<typeof runRuntimeHealthcheck>;
  contextPreview: {
    enabledToolsSource: RuntimeToolEnabledToolsSource;
    enabledToolsSourceDetail?: string;
    schemaProjectionSummary: RuntimeToolSurfaceProjectionSummary;
    schemaProjectionDrift: {
      checked: boolean;
      active: boolean;
      reason: string;
    };
  };
  recoveryHealth: RuntimeToolRecoveryHealthSummary;
  recoveryGate: RuntimeToolRecoveryReadinessGateDecision;
}): RuntimeToolQualitySummary {
  const runtimeBinaryExists = input.runtimeBinaryPath ? existsSync(input.runtimeBinaryPath) : null;
  const budgetValidation = validateRuntimeToolSurfaceBudget(input.contextPreview.schemaProjectionSummary);
  const failReasons: RuntimeToolQualityFailureReason[] = [];
  const warnReasons: RuntimeToolQualityWarningReason[] = [];

  if (input.runtimeImpl === "rust") {
    if (runtimeBinaryExists !== true) {
      failReasons.push("runtime_binary_missing");
    }
    if (input.runtimeHealth?.ok !== true) {
      failReasons.push("runtime_health_failed");
    }
  }
  if (input.contextPreview.schemaProjectionDrift.active) {
    failReasons.push("schema_projection_drift_active");
  }
  if (!budgetValidation.ok) {
    failReasons.push("schema_budget_violated");
  }
  if (input.recoveryGate.status === "fail") {
    failReasons.push("recovery_gate_blocking");
  }
  if (input.contextPreview.enabledToolsSource !== "runtime.tools.describe") {
    warnReasons.push("runtime_tools_describe_fallback");
  }
  if (!input.contextPreview.schemaProjectionDrift.checked) {
    warnReasons.push("schema_projection_drift_not_checked");
  }
  if (input.recoveryGate.status === "warn") {
    warnReasons.push("recovery_gate_warn");
  }
  if (input.recoveryHealth.level !== "good") {
    warnReasons.push(runtimeToolRecoveryHealthWarningReason(input.recoveryHealth.level));
  }

  const status: RuntimeToolQualityStatus = failReasons.length > 0
    ? "fail"
    : warnReasons.length > 0
      ? "warn"
      : "ok";
  const action = resolveRuntimeToolQualityAction({
    failureReasons: failReasons,
    warningReasons: warnReasons,
  });
  const actionableNextStep = resolveRuntimeToolQualityActionableNextStep({
    actionReason: action.actionReason,
    defaultNextStep: action.defaultNextStep,
    runtimeHealthDetail: input.runtimeHealth?.detail ?? null,
    runtimeDescribeDetail: input.contextPreview.enabledToolsSourceDetail ?? null,
    recoveryGateBlockerKind: input.recoveryGate.blockerKind,
    recoveryGateBlockerAction: input.recoveryGate.blockerAction,
    recoveryHealthRecommendedNextAction: input.recoveryHealth.recommendedNextAction,
  });

  return {
    quality_schema_version: RUNTIME_TOOL_QUALITY_SCHEMA_VERSION,
    status,
    passed: status === "ok",
    source: "status.runtime_tools",
    failure_reasons: failReasons,
    warning_reasons: warnReasons,
    runtime_impl: input.runtimeImpl,
    runtime_binary_exists: runtimeBinaryExists,
    runtime_health_ok: input.runtimeHealth?.ok ?? null,
    runtime_health_detail: input.runtimeHealth?.detail ?? null,
    runtime_describe_source: input.contextPreview.enabledToolsSource,
    runtime_describe_detail: input.contextPreview.enabledToolsSourceDetail ?? null,
    schema_projection_source: input.contextPreview.schemaProjectionSummary.source,
    schema_projection_drift_checked: input.contextPreview.schemaProjectionDrift.checked,
    schema_projection_drift_active: input.contextPreview.schemaProjectionDrift.active,
    schema_projection_drift_reason: input.contextPreview.schemaProjectionDrift.reason,
    schema_budget_policy_version: RUNTIME_TOOL_SURFACE_BUDGET_POLICY_VERSION,
    schema_budget_status: budgetValidation.ok ? "passed" : "failed",
    schema_budget_violations: budgetValidation.violations.length,
    schema_budget_violation_codes: budgetValidation.violations,
    recovery_health_level: input.recoveryHealth.level,
    recovery_health_score: input.recoveryHealth.score,
    recovery_health_reason: input.recoveryHealth.reason,
    recovery_gate_status: input.recoveryGate.status,
    recovery_gate_blocking: input.recoveryGate.blocking,
    recovery_gate_reason: input.recoveryGate.reason,
    latest_recovery_stage: input.recoveryHealth.latestStage,
    latest_recovery_tool_name: input.recoveryHealth.latestToolName,
    latest_recovery_error_class: input.recoveryHealth.latestErrorClass,
    latest_blocker_kind: input.recoveryGate.blockerKind === "none" ? null : input.recoveryGate.blockerKind,
    blocker_code: input.recoveryGate.blockerCode,
    blocker_action: input.recoveryGate.blockerAction,
    action_family: action.actionFamily,
    action_reason: action.actionReason,
    action_required: action.actionRequired,
    actionable_next_step: actionableNextStep,
  };
}
