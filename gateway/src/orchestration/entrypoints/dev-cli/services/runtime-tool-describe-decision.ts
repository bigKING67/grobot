import type { RuntimeToolSurfaceSchemaProfile } from "../runtime-health";
import {
  buildToolsManifestFingerprint,
  resolveRuntimeBinaryPath,
  runRuntimeToolsDescribe,
} from "../runtime-health";
import { buildDefaultRuntimeEnabledTools } from "../../../../tools/runtime/default-enabled-tools";

export type RuntimeToolEnabledToolsSource = "runtime.tools.describe" | "start-default";

export interface RuntimeToolDescribeDecision {
  enabledToolsSource: RuntimeToolEnabledToolsSource;
  enabledToolsSourceDetail?: string;
  enabledTools: string[];
  manifestToolNames: string[];
  manifestFingerprint: string;
  manifestToolCount: number;
  manifestDefaultEnabledCount: number;
  schemaProfilesFingerprint: string | null;
  schemaProfiles: RuntimeToolSurfaceSchemaProfile[];
  runtimeDescribeOk: boolean;
  rawRuntimeDescribeDetail: string | null;
}

export interface ResolveRuntimeToolDescribeDecisionOptions {
  /**
   * Omit this field to resolve the default runtime binary path. Pass null when
   * the selected execution plane intentionally has no Rust runtime to query.
   */
  runtimeBinaryPath?: string | null;
}

export function normalizeRuntimeToolsDescribeDetail(detail?: string | null): string {
  const normalized = detail?.trim() ?? "";
  if (!normalized) {
    return "runtime_tools_describe_unavailable:unknown";
  }
  if (normalized.startsWith("runtime_tools_describe_")) {
    return normalized;
  }
  return `runtime_tools_describe_unavailable:${normalized}`;
}

export function resolveRuntimeToolDescribeDecision(
  options: ResolveRuntimeToolDescribeDecisionOptions = {},
): RuntimeToolDescribeDecision {
  const runtimeBinaryPath = Object.prototype.hasOwnProperty.call(options, "runtimeBinaryPath")
    ? options.runtimeBinaryPath
    : resolveRuntimeBinaryPath();
  const described = runtimeBinaryPath ? runRuntimeToolsDescribe(runtimeBinaryPath) : null;
  if (described?.ok && described.defaultEnabledTools.length > 0) {
    return {
      enabledToolsSource: "runtime.tools.describe",
      enabledTools: [...described.defaultEnabledTools],
      manifestToolNames: [...described.toolNames],
      manifestFingerprint: described.manifestFingerprint,
      manifestToolCount: described.toolNames.length,
      manifestDefaultEnabledCount: described.defaultEnabledTools.length,
      schemaProfilesFingerprint: described.toolSurfaceSchemaProfilesFingerprint,
      schemaProfiles: described.toolSurfaceSchemaProfiles.map((profile) => ({
        ...profile,
        toolNames: [...profile.toolNames],
        perToolPropertyCount: { ...profile.perToolPropertyCount },
        perToolVisibleArgs: Object.fromEntries(
          Object.entries(profile.perToolVisibleArgs).map(([toolName, args]) => [toolName, [...args]]),
        ),
        perToolSuppressedArgs: Object.fromEntries(
          Object.entries(profile.perToolSuppressedArgs).map(([toolName, args]) => [toolName, [...args]]),
        ),
      })),
      runtimeDescribeOk: true,
      rawRuntimeDescribeDetail: described.detail,
    };
  }

  const enabledTools = buildDefaultRuntimeEnabledTools();
  const detail = described
    ? normalizeRuntimeToolsDescribeDetail(described.detail)
    : "runtime_tools_describe_unavailable:not_run";
  return {
    enabledToolsSource: "start-default",
    enabledTools,
    enabledToolsSourceDetail: detail,
    manifestToolNames: [...enabledTools],
    manifestFingerprint: `fallback:${buildToolsManifestFingerprint(enabledTools, enabledTools)}`,
    manifestToolCount: enabledTools.length,
    manifestDefaultEnabledCount: enabledTools.length,
    schemaProfilesFingerprint: null,
    schemaProfiles: [],
    runtimeDescribeOk: false,
    rawRuntimeDescribeDetail: described?.detail ?? null,
  };
}
