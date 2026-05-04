import type { RuntimeToolSurfaceSchemaProfile } from "../runtime-health";
import { normalizeRuntimeToolsDescribeDetail } from "../services/runtime-tool-describe-decision";
import type { ToolSurfaceProfile } from "../../models/types";
import type { RuntimeToolSurfaceProjectionSummary } from "../../tools/runtime/default-enabled-tools";

function sameToolNameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((toolName) => rightSet.has(toolName));
}

export function findRuntimeToolSurfaceSchemaProfile(input: {
  profiles: readonly RuntimeToolSurfaceSchemaProfile[];
  profile: ToolSurfaceProfile;
  advancedToolSchema: boolean;
  modelVisibleTools: readonly string[];
}): RuntimeToolSurfaceSchemaProfile | null {
  return input.profiles.find((profile) => (
    profile.profile === input.profile
    && profile.advancedToolSchema === input.advancedToolSchema
    && sameToolNameSet(profile.toolNames, input.modelVisibleTools)
  )) ?? null;
}

export function buildRuntimeDescribeSchemaProjectionSummary(input: {
  runtimeProfile: RuntimeToolSurfaceSchemaProfile | null;
  context: {
    dispatchEnabledTools: readonly string[];
    schemaEstimatedTokens: number;
  };
}): RuntimeToolSurfaceProjectionSummary | null {
  if (!input.runtimeProfile) {
    return null;
  }
  return {
    source: "runtime.tools.describe",
    policyVersion: input.runtimeProfile.policyVersion,
    profile: input.runtimeProfile.profile,
    projectionMode: input.runtimeProfile.projectionMode,
    advancedToolSchema: input.runtimeProfile.advancedToolSchema,
    visibleToolCount: input.runtimeProfile.visibleToolCount,
    dispatchEnabledToolCount: input.context.dispatchEnabledTools.length,
    schemaPropertyCount: input.runtimeProfile.schemaPropertyCount,
    fullSchemaPropertyCount: input.runtimeProfile.fullSchemaPropertyCount,
    suppressedSchemaPropertyCount: input.runtimeProfile.suppressedSchemaPropertyCount,
    schemaEstimatedTokens: input.context.schemaEstimatedTokens,
    schemaFingerprint: input.runtimeProfile.schemaFingerprint,
    perToolPropertyCount: { ...input.runtimeProfile.perToolPropertyCount },
    perToolVisibleArgs: Object.fromEntries(
      Object.entries(input.runtimeProfile.perToolVisibleArgs).map(([toolName, args]) => [toolName, [...args]]),
    ),
    perToolSuppressedArgs: Object.fromEntries(
      Object.entries(input.runtimeProfile.perToolSuppressedArgs).map(([toolName, args]) => [toolName, [...args]]),
    ),
  };
}

export interface RuntimeToolSurfaceProjectionDrift {
  checked: boolean;
  active: boolean;
  reason: string;
  runtimeSchemaFingerprint: string | null;
  gatewaySchemaFingerprint: string;
  runtimeProjectionMode: string | null;
  gatewayProjectionMode: string;
  runtimeSchemaPropertyCount: number | null;
  gatewaySchemaPropertyCount: number;
  runtimeFullSchemaPropertyCount: number | null;
  gatewayFullSchemaPropertyCount: number;
  runtimeSuppressedSchemaPropertyCount: number | null;
  gatewaySuppressedSchemaPropertyCount: number;
  runtimePerToolPropertyCount: Record<string, number> | null;
  gatewayPerToolPropertyCount: Record<string, number>;
  runtimePerToolVisibleArgs: Record<string, string[]> | null;
  gatewayPerToolVisibleArgs: Record<string, string[]>;
  runtimePerToolSuppressedArgs: Record<string, string[]> | null;
  gatewayPerToolSuppressedArgs: Record<string, string[]>;
  argMismatchDetails: string[];
}

function sameNumberRecord(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

function cloneStringArrayRecord(record: Record<string, string[]> | undefined): Record<string, string[]> | null {
  if (!record) {
    return null;
  }
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, [...value]]));
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}

function sameStringArrayRecord(
  left: Record<string, string[]> | undefined,
  right: Record<string, string[]> | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (!sameStringArray(leftKeys, rightKeys)) {
    return false;
  }
  return leftKeys.every((key) => sameStringArray(left[key] ?? [], right[key] ?? []));
}

function describeStringArrayRecordDiff(
  label: string,
  runtimeRecord: Record<string, string[]> | undefined,
  gatewayRecord: Record<string, string[]> | undefined,
): string[] {
  if (!runtimeRecord || !gatewayRecord) {
    return [`${label}:metadata_unavailable`];
  }
  const toolNames = [...new Set([...Object.keys(runtimeRecord), ...Object.keys(gatewayRecord)])].sort();
  const details: string[] = [];
  for (const toolName of toolNames) {
    const runtimeArgs = runtimeRecord[toolName] ?? [];
    const gatewayArgs = gatewayRecord[toolName] ?? [];
    if (sameStringArray(runtimeArgs, gatewayArgs)) {
      continue;
    }
    details.push(
      `${label}:${toolName}:runtime=${runtimeArgs.join("|") || "-"}:gateway=${gatewayArgs.join("|") || "-"}`,
    );
  }
  return details;
}

export function buildRuntimeToolSurfaceProjectionDrift(input: {
  runtimeSummary: RuntimeToolSurfaceProjectionSummary | null;
  gatewayFallbackSummary: RuntimeToolSurfaceProjectionSummary;
  runtimeDescribeOk: boolean;
  runtimeDescribeDetail?: string;
}): RuntimeToolSurfaceProjectionDrift {
  const runtimeSummary = input.runtimeSummary;
  const gatewayFallbackSummary = input.gatewayFallbackSummary;
  const runtimeDescribeUnavailableReason = normalizeRuntimeToolsDescribeDetail(
    input.runtimeDescribeDetail ?? "not_run",
  );
  if (!runtimeSummary) {
    return {
      checked: false,
      active: false,
      reason: input.runtimeDescribeOk
        ? "runtime_schema_profile_unavailable"
        : runtimeDescribeUnavailableReason,
      runtimeSchemaFingerprint: null,
      gatewaySchemaFingerprint: gatewayFallbackSummary.schemaFingerprint,
      runtimeProjectionMode: null,
      gatewayProjectionMode: gatewayFallbackSummary.projectionMode,
      runtimeSchemaPropertyCount: null,
      gatewaySchemaPropertyCount: gatewayFallbackSummary.schemaPropertyCount,
      runtimeFullSchemaPropertyCount: null,
      gatewayFullSchemaPropertyCount: gatewayFallbackSummary.fullSchemaPropertyCount,
      runtimeSuppressedSchemaPropertyCount: null,
      gatewaySuppressedSchemaPropertyCount: gatewayFallbackSummary.suppressedSchemaPropertyCount,
      runtimePerToolPropertyCount: null,
      gatewayPerToolPropertyCount: { ...gatewayFallbackSummary.perToolPropertyCount },
      runtimePerToolVisibleArgs: null,
      gatewayPerToolVisibleArgs: cloneStringArrayRecord(gatewayFallbackSummary.perToolVisibleArgs) ?? {},
      runtimePerToolSuppressedArgs: null,
      gatewayPerToolSuppressedArgs: cloneStringArrayRecord(gatewayFallbackSummary.perToolSuppressedArgs) ?? {},
      argMismatchDetails: [],
    };
  }

  const mismatches: string[] = [];
  const argMismatchDetails: string[] = [];
  if (runtimeSummary.projectionMode !== gatewayFallbackSummary.projectionMode) {
    mismatches.push("projection_mode");
  }
  if (runtimeSummary.visibleToolCount !== gatewayFallbackSummary.visibleToolCount) {
    mismatches.push("visible_tool_count");
  }
  if (runtimeSummary.schemaPropertyCount !== gatewayFallbackSummary.schemaPropertyCount) {
    mismatches.push("schema_property_count");
  }
  if (runtimeSummary.fullSchemaPropertyCount !== gatewayFallbackSummary.fullSchemaPropertyCount) {
    mismatches.push("full_schema_property_count");
  }
  if (runtimeSummary.suppressedSchemaPropertyCount !== gatewayFallbackSummary.suppressedSchemaPropertyCount) {
    mismatches.push("suppressed_schema_property_count");
  }
  if (!sameNumberRecord(runtimeSummary.perToolPropertyCount, gatewayFallbackSummary.perToolPropertyCount)) {
    mismatches.push("per_tool_property_count");
  }
  if (!sameStringArrayRecord(runtimeSummary.perToolVisibleArgs, gatewayFallbackSummary.perToolVisibleArgs)) {
    mismatches.push("per_tool_visible_args");
    argMismatchDetails.push(
      ...describeStringArrayRecordDiff(
        "visible",
        runtimeSummary.perToolVisibleArgs,
        gatewayFallbackSummary.perToolVisibleArgs,
      ),
    );
  }
  if (!sameStringArrayRecord(runtimeSummary.perToolSuppressedArgs, gatewayFallbackSummary.perToolSuppressedArgs)) {
    mismatches.push("per_tool_suppressed_args");
    argMismatchDetails.push(
      ...describeStringArrayRecordDiff(
        "suppressed",
        runtimeSummary.perToolSuppressedArgs,
        gatewayFallbackSummary.perToolSuppressedArgs,
      ),
    );
  }

  return {
    checked: true,
    active: mismatches.length > 0,
    reason: mismatches.length > 0 ? `mismatch:${mismatches.join(",")}` : "matched",
    runtimeSchemaFingerprint: runtimeSummary.schemaFingerprint,
    gatewaySchemaFingerprint: gatewayFallbackSummary.schemaFingerprint,
    runtimeProjectionMode: runtimeSummary.projectionMode,
    gatewayProjectionMode: gatewayFallbackSummary.projectionMode,
    runtimeSchemaPropertyCount: runtimeSummary.schemaPropertyCount,
    gatewaySchemaPropertyCount: gatewayFallbackSummary.schemaPropertyCount,
    runtimeFullSchemaPropertyCount: runtimeSummary.fullSchemaPropertyCount,
    gatewayFullSchemaPropertyCount: gatewayFallbackSummary.fullSchemaPropertyCount,
    runtimeSuppressedSchemaPropertyCount: runtimeSummary.suppressedSchemaPropertyCount,
    gatewaySuppressedSchemaPropertyCount: gatewayFallbackSummary.suppressedSchemaPropertyCount,
    runtimePerToolPropertyCount: { ...runtimeSummary.perToolPropertyCount },
    gatewayPerToolPropertyCount: { ...gatewayFallbackSummary.perToolPropertyCount },
    runtimePerToolVisibleArgs: cloneStringArrayRecord(runtimeSummary.perToolVisibleArgs),
    gatewayPerToolVisibleArgs: cloneStringArrayRecord(gatewayFallbackSummary.perToolVisibleArgs) ?? {},
    runtimePerToolSuppressedArgs: cloneStringArrayRecord(runtimeSummary.perToolSuppressedArgs),
    gatewayPerToolSuppressedArgs: cloneStringArrayRecord(gatewayFallbackSummary.perToolSuppressedArgs) ?? {},
    argMismatchDetails,
  };
}

export function serializeRuntimeToolSurfaceProjectionSummary(
  summary: RuntimeToolSurfaceProjectionSummary,
): Record<string, unknown> {
  return {
    source: summary.source,
    policy_version: summary.policyVersion,
    profile: summary.profile,
    projection_mode: summary.projectionMode,
    advanced_tool_schema: summary.advancedToolSchema,
    visible_tool_count: summary.visibleToolCount,
    dispatch_enabled_tool_count: summary.dispatchEnabledToolCount,
    schema_property_count: summary.schemaPropertyCount,
    full_schema_property_count: summary.fullSchemaPropertyCount,
    suppressed_schema_property_count: summary.suppressedSchemaPropertyCount,
    schema_estimated_tokens: summary.schemaEstimatedTokens,
    schema_fingerprint: summary.schemaFingerprint,
    per_tool_property_count: summary.perToolPropertyCount,
    per_tool_visible_args: summary.perToolVisibleArgs ?? null,
    per_tool_suppressed_args: summary.perToolSuppressedArgs ?? null,
  };
}

export function formatRuntimeToolSuppressedArgs(summary: RuntimeToolSurfaceProjectionSummary): string {
  if (!summary.perToolSuppressedArgs) {
    return `<unavailable source=${summary.source}>`;
  }
  const rows = Object.entries(summary.perToolSuppressedArgs)
    .filter(([, args]) => args.length > 0)
    .map(([toolName, args]) => `${toolName}:${args.join("|")}`);
  if (rows.length === 0) {
    return "<none>";
  }
  return rows.join(";");
}

export function formatRuntimeToolArgDriftDetails(drift: RuntimeToolSurfaceProjectionDrift): string {
  if (drift.argMismatchDetails.length === 0) {
    return "<none>";
  }
  return drift.argMismatchDetails.join(";");
}

export function serializeRuntimeToolSurfaceProjectionDrift(
  drift: RuntimeToolSurfaceProjectionDrift,
): Record<string, unknown> {
  return {
    checked: drift.checked,
    active: drift.active,
    reason: drift.reason,
    runtime_schema_fingerprint: drift.runtimeSchemaFingerprint,
    gateway_schema_fingerprint: drift.gatewaySchemaFingerprint,
    runtime_projection_mode: drift.runtimeProjectionMode,
    gateway_projection_mode: drift.gatewayProjectionMode,
    runtime_schema_property_count: drift.runtimeSchemaPropertyCount,
    gateway_schema_property_count: drift.gatewaySchemaPropertyCount,
    runtime_full_schema_property_count: drift.runtimeFullSchemaPropertyCount,
    gateway_full_schema_property_count: drift.gatewayFullSchemaPropertyCount,
    runtime_suppressed_schema_property_count: drift.runtimeSuppressedSchemaPropertyCount,
    gateway_suppressed_schema_property_count: drift.gatewaySuppressedSchemaPropertyCount,
    runtime_per_tool_property_count: drift.runtimePerToolPropertyCount,
    gateway_per_tool_property_count: drift.gatewayPerToolPropertyCount,
    runtime_per_tool_visible_args: drift.runtimePerToolVisibleArgs,
    gateway_per_tool_visible_args: drift.gatewayPerToolVisibleArgs,
    runtime_per_tool_suppressed_args: drift.runtimePerToolSuppressedArgs,
    gateway_per_tool_suppressed_args: drift.gatewayPerToolSuppressedArgs,
    arg_mismatch_details: drift.argMismatchDetails,
  };
}
