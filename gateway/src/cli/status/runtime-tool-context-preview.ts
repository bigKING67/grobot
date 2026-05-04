import type {
  RuntimeToolSurfaceDecision,
  ToolSurfaceProfile,
  ToolSurfaceSource,
} from "../../models/types";
import {
  adaptRuntimeToolContextForRecovery,
  buildRuntimeToolContextForMessage,
  buildRuntimeToolSurfaceProjectionSummary,
  buildToolSurfaceFingerprint,
  estimateToolSchemaTokens,
  type RuntimeToolSurfaceAdaptation,
  type RuntimeToolSurfaceProjectionSummary,
  TOOL_SURFACE_POLICY_VERSION,
} from "../../tools/runtime/default-enabled-tools";
import type { RuntimeToolRecoveryFeedback } from "../../tools/runtime/tool-events";
import type { RuntimeToolRecoveryReadinessGateDecision } from "../../tools/runtime/tool-recovery-readiness-gate";
import {
  applyRuntimeToolSurfaceAdaptationGuard,
  type RuntimeToolSurfaceAdaptationGuard,
  type RuntimeToolSurfaceAdaptationSnapshot,
} from "../../tools/runtime/tool-surface-adaptation-state";
import {
  resolveRuntimeToolDescribeDecision,
  type RuntimeToolEnabledToolsSource,
} from "../services/runtime-tool-describe-decision";
import { readToolsAllowlistFromProjectToml } from "./project-tools";
import {
  buildRuntimeDescribeSchemaProjectionSummary,
  buildRuntimeToolSurfaceProjectionDrift,
  findRuntimeToolSurfaceSchemaProfile,
  type RuntimeToolSurfaceProjectionDrift,
} from "./runtime-tool-schema-projection";

export interface RuntimeToolContextPreview {
  enabledTools: string[];
  modelVisibleTools: string[];
  toolSurfaceProfile: ToolSurfaceProfile;
  toolSurfaceSource: ToolSurfaceSource;
  toolSurfaceReason: string;
  toolSurfaceDecision: RuntimeToolSurfaceDecision | null;
  toolPolicyVersion: string;
  advancedToolSchema: boolean;
  schemaFingerprint: string;
  schemaEstimatedTokens: number;
  schemaProjectionSummary: RuntimeToolSurfaceProjectionSummary;
  schemaProjectionDrift: RuntimeToolSurfaceProjectionDrift;
  schemaProfilesFingerprint: string | null;
  toolSurfaceAdaptation: RuntimeToolSurfaceAdaptation;
  toolSurfaceAdaptationGuard: RuntimeToolSurfaceAdaptationGuard;
  enabledToolsSource: RuntimeToolEnabledToolsSource;
  enabledToolsSourceDetail?: string;
  manifestFingerprint: string;
  manifestToolCount: number;
  manifestDefaultEnabledCount: number;
  bashAllowlist: string[];
  maxToolRounds: number;
  noToolFallbackMode: "off" | "safe" | "strict";
  maxRecoveryRounds: number;
}

export function resolveRuntimeToolContextPreview(
  projectTomlPath: string | undefined,
  runtimeBinaryPath: string | undefined,
  recoveryFeedback: RuntimeToolRecoveryFeedback,
  recoveryGate: RuntimeToolRecoveryReadinessGateDecision,
  adaptationSnapshot: RuntimeToolSurfaceAdaptationSnapshot,
): RuntimeToolContextPreview {
  const maxToolRoundsRaw = process.env.GROBOT_MAX_TOOL_ROUNDS;
  const parsedMaxToolRounds =
    typeof maxToolRoundsRaw === "string" && /^\d+$/.test(maxToolRoundsRaw.trim())
      ? Number.parseInt(maxToolRoundsRaw.trim(), 10)
      : undefined;
  const maxToolRounds =
    typeof parsedMaxToolRounds === "number" && Number.isFinite(parsedMaxToolRounds)
      ? Math.min(Math.max(parsedMaxToolRounds, 1), 32)
      : 8;
  const noToolFallbackModeRaw = process.env.GROBOT_NO_TOOL_FALLBACK_MODE?.trim().toLowerCase();
  const noToolFallbackMode = noToolFallbackModeRaw === "off"
    || noToolFallbackModeRaw === "safe"
    || noToolFallbackModeRaw === "strict"
    ? noToolFallbackModeRaw
    : "safe";
  const maxRecoveryRoundsRaw = process.env.GROBOT_MAX_RECOVERY_ROUNDS;
  const parsedMaxRecoveryRounds =
    typeof maxRecoveryRoundsRaw === "string" && /^\d+$/.test(maxRecoveryRoundsRaw.trim())
      ? Number.parseInt(maxRecoveryRoundsRaw.trim(), 10)
      : undefined;
  const maxRecoveryRounds =
    typeof parsedMaxRecoveryRounds === "number" && Number.isFinite(parsedMaxRecoveryRounds)
      ? Math.min(Math.max(parsedMaxRecoveryRounds, 0), 8)
      : 2;
  const runtimeToolDescribeDecision = resolveRuntimeToolDescribeDecision({
    runtimeBinaryPath: runtimeBinaryPath ?? null,
  });
  const enabledTools = runtimeToolDescribeDecision.enabledTools;
  const manifestToolNames = runtimeToolDescribeDecision.manifestToolNames;
  const manifestFingerprint = runtimeToolDescribeDecision.manifestFingerprint;
  const enabledToolsSource = runtimeToolDescribeDecision.enabledToolsSource;
  const bashAllowlist = readToolsAllowlistFromProjectToml(projectTomlPath);
  const surfaced = buildRuntimeToolContextForMessage({
    workDir: "",
    enabledTools,
    bashAllowlist,
    maxToolRounds,
    noToolFallbackMode,
    maxRecoveryRounds,
  }, undefined, manifestToolNames);
  const adapted = adaptRuntimeToolContextForRecovery({
    context: surfaced,
    recoveryFeedback,
    recoveryGate,
    availableTools: manifestToolNames,
  });
  const guarded = applyRuntimeToolSurfaceAdaptationGuard({
    baseContext: surfaced,
    result: adapted,
    snapshot: adaptationSnapshot,
  });
  const effectiveContext = guarded.context ?? surfaced;
  const toolSurfaceProfile = effectiveContext?.toolSurfaceProfile ?? "coding";
  const modelVisibleTools = effectiveContext?.modelVisibleTools ?? enabledTools;
  const dispatchEnabledTools = effectiveContext?.enabledTools ?? enabledTools;
  const advancedToolSchema = effectiveContext?.advancedToolSchema ?? false;
  const schemaFingerprint = effectiveContext?.schemaFingerprint
    ?? buildToolSurfaceFingerprint(toolSurfaceProfile, modelVisibleTools, { advancedToolSchema });
  const schemaEstimatedTokens = effectiveContext?.schemaEstimatedTokens
    ?? estimateToolSchemaTokens(modelVisibleTools, toolSurfaceProfile);
  const toolSurfaceSource = effectiveContext?.toolSurfaceSource ?? "fallback";
  const toolSurfaceReason = effectiveContext?.toolSurfaceReason ?? "status fallback";
  const toolPolicyVersion = effectiveContext?.toolPolicyVersion ?? TOOL_SURFACE_POLICY_VERSION;
  const runtimeSchemaProfile = runtimeToolDescribeDecision.runtimeDescribeOk
    ? findRuntimeToolSurfaceSchemaProfile({
        profiles: runtimeToolDescribeDecision.schemaProfiles,
        profile: toolSurfaceProfile,
        advancedToolSchema,
        modelVisibleTools,
      })
    : null;
  const fallbackSchemaProjectionSummary = buildRuntimeToolSurfaceProjectionSummary({
    enabledTools: dispatchEnabledTools,
    modelVisibleTools,
    toolSurfaceProfile,
    toolSurfaceSource,
    toolSurfaceReason,
    toolPolicyVersion,
    advancedToolSchema,
    schemaFingerprint,
    schemaEstimatedTokens,
  });
  const runtimeSchemaProjectionSummary = buildRuntimeDescribeSchemaProjectionSummary({
    runtimeProfile: runtimeSchemaProfile,
    context: {
      dispatchEnabledTools,
      schemaEstimatedTokens,
    },
  });
  const schemaProjectionSummary = runtimeSchemaProjectionSummary ?? fallbackSchemaProjectionSummary;
  const schemaProjectionDrift = buildRuntimeToolSurfaceProjectionDrift({
    runtimeSummary: runtimeSchemaProjectionSummary,
    gatewayFallbackSummary: fallbackSchemaProjectionSummary,
    runtimeDescribeOk: runtimeToolDescribeDecision.runtimeDescribeOk,
    runtimeDescribeDetail: runtimeToolDescribeDecision.enabledToolsSourceDetail
      ?? runtimeToolDescribeDecision.rawRuntimeDescribeDetail
      ?? undefined,
  });
  return {
    enabledTools: dispatchEnabledTools,
    modelVisibleTools,
    toolSurfaceProfile,
    toolSurfaceSource,
    toolSurfaceReason,
    toolSurfaceDecision: effectiveContext?.toolSurfaceDecision ?? null,
    toolPolicyVersion,
    advancedToolSchema,
    schemaFingerprint,
    schemaEstimatedTokens,
    schemaProjectionSummary,
    schemaProjectionDrift,
    schemaProfilesFingerprint: runtimeToolDescribeDecision.schemaProfilesFingerprint,
    toolSurfaceAdaptation: guarded.adaptation,
    toolSurfaceAdaptationGuard: guarded.guard,
    enabledToolsSource,
    enabledToolsSourceDetail: runtimeToolDescribeDecision.enabledToolsSourceDetail,
    manifestFingerprint,
    manifestToolCount: manifestToolNames.length,
    manifestDefaultEnabledCount: enabledTools.length,
    bashAllowlist,
    maxToolRounds,
    noToolFallbackMode,
    maxRecoveryRounds,
  };
}
