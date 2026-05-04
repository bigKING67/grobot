import type { ToolSurfaceProfile } from "../../models/types";
import {
  TOOL_SURFACE_POLICY_VERSION,
  type RuntimeToolSurfaceProjectionMode,
} from "../../tools/runtime/default-enabled-tools";
import {
  asStrictNonNegativeInteger,
  dedupeStringArray,
  isRecord,
  normalizeStringArray,
  parseStrictStringArray,
  recordKeysMatch,
  stringArraysDisjoint,
} from "./json-utils";
import {
  type RuntimeToolSurfaceSchemaProfile,
  type RuntimeToolSurfaceSchemaProfilesParseResult,
} from "./types";

const RUNTIME_TOOL_SURFACE_PROFILES: readonly ToolSurfaceProfile[] = [
  "minimal",
  "coding",
  "browser",
  "browser_advanced",
  "context",
  "mcp",
  "full_debug",
];

const RUNTIME_TOOL_SURFACE_PROJECTION_MODES: readonly RuntimeToolSurfaceProjectionMode[] =
  ["slim", "advanced", "full"];

function parseToolSurfaceProfile(value: unknown): ToolSurfaceProfile | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  return RUNTIME_TOOL_SURFACE_PROFILES.includes(
    normalized as ToolSurfaceProfile,
  )
    ? (normalized as ToolSurfaceProfile)
    : null;
}

function parseProjectionMode(
  value: unknown,
): RuntimeToolSurfaceProjectionMode | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return RUNTIME_TOOL_SURFACE_PROJECTION_MODES.includes(
    normalized as RuntimeToolSurfaceProjectionMode,
  )
    ? (normalized as RuntimeToolSurfaceProjectionMode)
    : null;
}

function parsePropertyCountMap(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) {
    return null;
  }
  const result: Record<string, number> = {};
  for (const [key, rawCount] of Object.entries(value)) {
    const toolName = key.trim();
    const count = asStrictNonNegativeInteger(rawCount);
    if (!toolName || count == null) {
      return null;
    }
    result[toolName] = count;
  }
  return result;
}

function parseStringArrayMap(value: unknown): Record<string, string[]> | null {
  if (!isRecord(value)) {
    return null;
  }
  const result: Record<string, string[]> = {};
  for (const [key, rawItems] of Object.entries(value)) {
    const toolName = key.trim();
    const items = parseStrictStringArray(rawItems);
    if (!toolName || items == null) {
      return null;
    }
    result[toolName] = items;
  }
  return result;
}

function expectedSchemaProjectionForProfile(profile: ToolSurfaceProfile): {
  projectionMode: RuntimeToolSurfaceProjectionMode;
  advancedToolSchema: boolean;
} {
  if (profile === "full_debug") {
    return { projectionMode: "full", advancedToolSchema: true };
  }
  if (profile === "browser_advanced") {
    return { projectionMode: "advanced", advancedToolSchema: true };
  }
  return { projectionMode: "slim", advancedToolSchema: false };
}

export function parseRuntimeToolSurfaceSchemaProfilesWithDiagnostics(
  value: unknown,
): RuntimeToolSurfaceSchemaProfilesParseResult {
  if (value == null) {
    return { profiles: [], rawCount: 0, invalidReason: null };
  }
  if (!Array.isArray(value)) {
    return {
      profiles: [],
      rawCount: 0,
      invalidReason: "schema_profiles_not_array",
    };
  }
  const profiles: RuntimeToolSurfaceSchemaProfile[] = [];
  let invalidRowCount = 0;
  for (const row of value) {
    if (!isRecord(row)) {
      invalidRowCount += 1;
      continue;
    }
    const policyVersion =
      typeof row.policy_version === "string"
        ? row.policy_version.trim()
        : "";
    const profile = parseToolSurfaceProfile(row.profile);
    const projectionMode = parseProjectionMode(row.projection_mode);
    const advancedToolSchema =
      typeof row.advanced_tool_schema === "boolean"
        ? row.advanced_tool_schema
        : null;
    const schemaFingerprint =
      typeof row.schema_fingerprint === "string"
        ? row.schema_fingerprint.trim()
        : "";
    const toolNames = dedupeStringArray(
      normalizeStringArray(row.tool_names),
    );
    const visibleToolCount = asStrictNonNegativeInteger(
      row.visible_tool_count,
    );
    const schemaPropertyCount = asStrictNonNegativeInteger(
      row.schema_property_count,
    );
    const fullSchemaPropertyCount = asStrictNonNegativeInteger(
      row.full_schema_property_count,
    );
    const suppressedSchemaPropertyCount = asStrictNonNegativeInteger(
      row.suppressed_schema_property_count,
    );
    const perToolPropertyCount = parsePropertyCountMap(
      row.per_tool_property_count,
    );
    const perToolVisibleArgs = parseStringArrayMap(row.per_tool_visible_args);
    const perToolSuppressedArgs = parseStringArrayMap(
      row.per_tool_suppressed_args,
    );
    const perToolSum =
      perToolPropertyCount == null
        ? null
        : toolNames.reduce(
            (total, toolName) =>
              total + (perToolPropertyCount[toolName] ?? Number.NaN),
            0,
          );
    const visibleArgSum =
      perToolVisibleArgs == null
        ? null
        : toolNames.reduce(
            (total, toolName) =>
              total + (perToolVisibleArgs[toolName]?.length ?? Number.NaN),
            0,
          );
    const suppressedArgSum =
      perToolSuppressedArgs == null
        ? null
        : toolNames.reduce(
            (total, toolName) =>
              total +
              (perToolSuppressedArgs[toolName]?.length ?? Number.NaN),
            0,
          );
    const perToolArgsMatchCounts =
      perToolPropertyCount != null && perToolVisibleArgs != null
        ? toolNames.every(
            (toolName) =>
              perToolPropertyCount[toolName] ===
              perToolVisibleArgs[toolName]?.length,
          )
        : false;
    const perToolArgPartitionsDisjoint =
      perToolVisibleArgs != null && perToolSuppressedArgs != null
        ? toolNames.every((toolName) =>
            stringArraysDisjoint(
              perToolVisibleArgs[toolName] ?? [],
              perToolSuppressedArgs[toolName] ?? [],
            ),
          )
        : false;
    const perToolMapsHaveExactKeys =
      perToolPropertyCount != null &&
      perToolVisibleArgs != null &&
      perToolSuppressedArgs != null &&
      recordKeysMatch(perToolPropertyCount, toolNames) &&
      recordKeysMatch(perToolVisibleArgs, toolNames) &&
      recordKeysMatch(perToolSuppressedArgs, toolNames);
    if (
      !policyVersion ||
      profile == null ||
      projectionMode == null ||
      advancedToolSchema == null ||
      !schemaFingerprint ||
      visibleToolCount == null ||
      schemaPropertyCount == null ||
      fullSchemaPropertyCount == null ||
      suppressedSchemaPropertyCount == null ||
      perToolPropertyCount == null ||
      perToolVisibleArgs == null ||
      perToolSuppressedArgs == null ||
      perToolSum == null ||
      visibleArgSum == null ||
      suppressedArgSum == null ||
      !Number.isFinite(perToolSum) ||
      !Number.isFinite(visibleArgSum) ||
      !Number.isFinite(suppressedArgSum) ||
      perToolSum !== schemaPropertyCount ||
      visibleArgSum !== schemaPropertyCount ||
      suppressedArgSum !== suppressedSchemaPropertyCount ||
      fullSchemaPropertyCount !==
        schemaPropertyCount + suppressedSchemaPropertyCount ||
      !perToolArgsMatchCounts ||
      !perToolArgPartitionsDisjoint ||
      !perToolMapsHaveExactKeys ||
      toolNames.length !== visibleToolCount
    ) {
      invalidRowCount += 1;
      continue;
    }
    profiles.push({
      policyVersion,
      profile,
      projectionMode,
      advancedToolSchema,
      schemaFingerprint,
      toolNames,
      visibleToolCount,
      schemaPropertyCount,
      fullSchemaPropertyCount,
      suppressedSchemaPropertyCount,
      perToolPropertyCount,
      perToolVisibleArgs,
      perToolSuppressedArgs,
    });
  }
  return {
    profiles,
    rawCount: value.length,
    invalidReason:
      invalidRowCount > 0
        ? `schema_profiles_invalid_rows:${invalidRowCount}`
        : null,
  };
}

export function parseRuntimeToolSurfaceSchemaProfiles(
  value: unknown,
): RuntimeToolSurfaceSchemaProfile[] {
  return parseRuntimeToolSurfaceSchemaProfilesWithDiagnostics(value).profiles;
}

export function validateRuntimeToolSurfaceSchemaProfilesAgainstManifest(input: {
  profiles: readonly RuntimeToolSurfaceSchemaProfile[];
  toolNames: readonly string[];
}): string | null {
  if (input.profiles.length === 0) {
    return null;
  }
  const seenProfiles = new Set<ToolSurfaceProfile>();
  const duplicateProfiles: string[] = [];
  for (const profile of input.profiles) {
    if (seenProfiles.has(profile.profile)) {
      duplicateProfiles.push(profile.profile);
    }
    seenProfiles.add(profile.profile);
  }
  if (duplicateProfiles.length > 0) {
    return `schema_profiles_duplicate_profiles:${dedupeStringArray(duplicateProfiles).join(",")}`;
  }
  const missingProfiles = RUNTIME_TOOL_SURFACE_PROFILES.filter(
    (profile) => !seenProfiles.has(profile),
  );
  if (missingProfiles.length > 0) {
    return `schema_profiles_missing_profiles:${missingProfiles.join(",")}`;
  }
  const unknownProfiles = [...seenProfiles].filter(
    (profile) => !RUNTIME_TOOL_SURFACE_PROFILES.includes(profile),
  );
  if (unknownProfiles.length > 0) {
    return `schema_profiles_unknown_profiles:${unknownProfiles.join(",")}`;
  }

  const manifestToolNames = new Set(input.toolNames);
  for (const profile of input.profiles) {
    if (profile.policyVersion !== TOOL_SURFACE_POLICY_VERSION) {
      return `schema_profiles_policy_version_mismatch:${profile.profile}:${profile.policyVersion}`;
    }
    const expectedProjection = expectedSchemaProjectionForProfile(
      profile.profile,
    );
    if (
      profile.projectionMode !== expectedProjection.projectionMode ||
      profile.advancedToolSchema !== expectedProjection.advancedToolSchema
    ) {
      return `schema_profiles_projection_mismatch:${profile.profile}`;
    }
    const unknownToolNames = profile.toolNames.filter(
      (toolName) => !manifestToolNames.has(toolName),
    );
    if (unknownToolNames.length > 0) {
      return `schema_profiles_unknown_tools:${profile.profile}:${unknownToolNames.join(",")}`;
    }
  }
  return null;
}
