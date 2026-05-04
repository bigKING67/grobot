import type {
  RuntimeToolContext,
  ToolSurfaceProfile,
  ToolSurfaceSource,
} from "../../../models/types";
import type { RuntimeToolRecoveryFeedback } from "../tool-events";

export const TOOL_SURFACE_POLICY_VERSION = "v1";

export interface RuntimeToolSurfaceAdaptation {
  enabled: boolean;
  active: boolean;
  reason: string;
  fromProfile: ToolSurfaceProfile;
  appliedProfile: ToolSurfaceProfile;
  recommendedProfile: ToolSurfaceProfile | null;
  source: ToolSurfaceSource | null;
  autoAdaptationBlocked: boolean;
  recoveryStage: RuntimeToolRecoveryFeedback["stage"];
  recoveryToolName: string | null;
  recoveryErrorClass: string | null;
  recoveryRecoverable: boolean | null;
  recoveryObservedAt: string | null;
}

export interface RuntimeToolSurfaceAdaptationResult {
  context: RuntimeToolContext | undefined;
  adaptation: RuntimeToolSurfaceAdaptation;
}

export type RuntimeToolSurfaceProjectionMode = "slim" | "advanced" | "full";
export type RuntimeToolSurfaceProjectionSource = "runtime.tools.describe" | "gateway.fallback";

export interface RuntimeToolSurfaceProjectionSummary {
  source: RuntimeToolSurfaceProjectionSource;
  policyVersion: string;
  profile: ToolSurfaceProfile;
  projectionMode: RuntimeToolSurfaceProjectionMode;
  advancedToolSchema: boolean;
  visibleToolCount: number;
  dispatchEnabledToolCount: number;
  schemaPropertyCount: number;
  fullSchemaPropertyCount: number;
  suppressedSchemaPropertyCount: number;
  schemaEstimatedTokens: number;
  schemaFingerprint: string;
  perToolPropertyCount: Record<string, number>;
  perToolVisibleArgs?: Record<string, string[]>;
  perToolSuppressedArgs?: Record<string, string[]>;
}

export interface ToolSurfaceFingerprintInput {
  advancedToolSchema?: boolean;
}
