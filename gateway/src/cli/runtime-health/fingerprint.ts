import {
  dedupeStringArray,
  fnv1a32HexFromUtf8,
  stableJsonStringify,
} from "./json-utils";
import { TOOL_SURFACE_POLICY_VERSION } from "../../tools/runtime/default-enabled-tools";

export function buildRuntimeToolSurfaceSchemaProfilesFingerprint(
  value: unknown,
): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const payload = stableJsonStringify({
    policy_version: TOOL_SURFACE_POLICY_VERSION,
    profiles: value,
  });
  return `schema_profiles:${fnv1a32HexFromUtf8(payload)}`;
}

export function buildRuntimeToolRecoveryCatalogFingerprint(
  value: unknown,
  policyVersion = TOOL_SURFACE_POLICY_VERSION,
): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const payload = stableJsonStringify({
    policy_version: policyVersion,
    catalog: value,
  });
  return `recovery_catalog:${fnv1a32HexFromUtf8(payload)}`;
}

export function buildToolsManifestFingerprint(
  toolNames: string[],
  defaultEnabledTools: string[],
): string {
  const normalizedToolNames = [...dedupeStringArray(toolNames)].sort();
  const normalizedDefaultEnabledTools = [
    ...dedupeStringArray(defaultEnabledTools),
  ].sort();
  const payload = JSON.stringify({
    tool_names: normalizedToolNames,
    default_enabled_tools: normalizedDefaultEnabledTools,
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}
