import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildAllRuntimeLocalTools,
  buildDefaultRuntimeEnabledTools,
  toolNamesForSurfaceProfile,
  TOOL_SURFACE_PROFILES,
} from "../../tools/runtime/default-enabled-tools";
import type { ToolSurfaceProfile } from "../../models/types";

const repoRoot = process.cwd();
const rustCoreSource = readRepoFile("runtime/src/tools/core/mod.rs");
const rustDispatcherSource = readRepoFile("runtime/src/tools/dispatcher/mod.rs");

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function expectDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: actual=${actualJson} expected=${expectedJson}`);
  }
}

function sorted(rows: readonly string[]): string[] {
  return [...rows].sort((left, right) => left.localeCompare(right));
}

function parseRustStringConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>();
  const pattern = /\bconst\s+(TOOL(?:_SURFACE)?_[A-Z_]+):\s*&str\s*=\s*"([^"]+)";/g;
  for (const match of source.matchAll(pattern)) {
    constants.set(match[1], match[2]);
  }
  return constants;
}

const rustConstants = parseRustStringConstants(rustCoreSource);

function resolveRustToken(token: string): string {
  const value = rustConstants.get(token);
  expect(value !== undefined, `unknown Rust tool constant: ${token}`);
  return value;
}

function rustToolTokens(block: string): string[] {
  const tokens = block.match(/\bTOOL_[A-Z_]+\b/g) ?? [];
  return tokens.filter((token) => !token.startsWith("TOOL_SURFACE_"));
}

function extractRustCatalogEntries(): Array<{ constName: string; name: string; defaultEnabled: boolean }> {
  const entries: Array<{ constName: string; name: string; defaultEnabled: boolean }> = [];
  const pattern = /LocalToolCatalogEntry\s*\{[\s\S]*?\bname:\s*(TOOL_[A-Z_]+)[\s\S]*?\bdefault_enabled:\s*(true|false)/g;
  for (const match of rustCoreSource.matchAll(pattern)) {
    const constName = match[1];
    entries.push({
      constName,
      name: resolveRustToken(constName),
      defaultEnabled: match[2] === "true",
    });
  }
  return entries;
}

function extractRustDispatchSupportedToolNames(): string[] {
  const markerStart = "pub(crate) fn is_local_tool_dispatch_supported";
  const markerEnd = "impl ToolExecutor for LocalToolExecutor";
  const start = rustDispatcherSource.indexOf(markerStart);
  const end = rustDispatcherSource.indexOf(markerEnd);
  expect(start >= 0 && end > start, "runtime dispatch support function block not found");
  return rustToolTokens(rustDispatcherSource.slice(start, end)).map(resolveRustToken);
}

function extractRustDispatchMatchToolNames(): string[] {
  const markerStart = "let result = match tool_name.as_str()";
  const markerEnd = "if result.is_ok()";
  const start = rustDispatcherSource.indexOf(markerStart);
  const end = rustDispatcherSource.indexOf(markerEnd, start);
  expect(start >= 0 && end > start, "runtime dispatch match block not found");
  return rustToolTokens(rustDispatcherSource.slice(start, end)).map(resolveRustToken);
}

function rustProfileConstName(profile: ToolSurfaceProfile): string {
  return `TOOL_SURFACE_${profile.toUpperCase()}`;
}

function extractRustSurfaceProfiles(): string[] {
  return [...rustConstants.entries()]
    .filter(([key]) => key.startsWith("TOOL_SURFACE_") && key !== "TOOL_SURFACE_POLICY_VERSION")
    .map(([, value]) => value);
}

function extractRustSurfaceToolNames(profile: ToolSurfaceProfile): string[] {
  if (profile === "coding") {
    return extractRustCatalogEntries()
      .filter((entry) => entry.defaultEnabled)
      .map((entry) => entry.name);
  }
  if (profile === "full_debug") {
    return extractRustCatalogEntries().map((entry) => entry.name);
  }

  const markerStart = "fn tool_surface_profile_names";
  const markerEnd = "fn schema_projection_mode";
  const start = rustCoreSource.indexOf(markerStart);
  const end = rustCoreSource.indexOf(markerEnd);
  expect(start >= 0 && end > start, "runtime surface profile function block not found");
  const block = rustCoreSource.slice(start, end);
  const profileConst = rustProfileConstName(profile);
  const profilePattern = new RegExp(`${profileConst}\\s*=>\\s*vec!\\[([\\s\\S]*?)\\]`);
  const match = block.match(profilePattern);
  expect(match !== null, `runtime surface profile arm missing: ${profile}`);
  return rustToolTokens(match[1]).map(resolveRustToken);
}

const rustCatalogEntries = extractRustCatalogEntries();
const rustCatalogNames = rustCatalogEntries.map((entry) => entry.name);
const rustDefaultEnabledNames = rustCatalogEntries
  .filter((entry) => entry.defaultEnabled)
  .map((entry) => entry.name);
const rustDispatchSupportedNames = extractRustDispatchSupportedToolNames();
const rustDispatchMatchNames = extractRustDispatchMatchToolNames();
const rustSurfaceProfiles = extractRustSurfaceProfiles();
const gatewayAllLocalTools = buildAllRuntimeLocalTools();
const gatewayDefaultEnabledTools = buildDefaultRuntimeEnabledTools();

expect(rustCatalogEntries.length > 0, "runtime local tool catalog must not be empty");
expectDeepEqual(
  sorted(gatewayAllLocalTools),
  sorted(rustCatalogNames),
  "gateway ALL_RUNTIME_LOCAL_TOOLS must match Rust local_tool_catalog",
);
expectDeepEqual(
  sorted(gatewayDefaultEnabledTools),
  sorted(rustDefaultEnabledNames),
  "gateway DEFAULT_RUNTIME_ENABLED_TOOLS must match Rust default_enabled_local_tool_names",
);
expectDeepEqual(
  sorted(rustDispatchSupportedNames.filter((name) => name !== "ask_user_question")),
  sorted(rustCatalogNames),
  "Rust dispatch table must support every catalog tool and only catalog tools",
);
expectDeepEqual(
  rustDispatchSupportedNames.filter((name) => !rustCatalogNames.includes(name)),
  ["ask_user_question"],
  "Rust dispatch table may only expose ask_user_question as a legacy alias outside catalog",
);
expectDeepEqual(
  sorted(rustDispatchMatchNames),
  sorted(rustDispatchSupportedNames),
  "Rust dispatch support function must match actual tool_name match arms",
);
expectDeepEqual(
  sorted([...TOOL_SURFACE_PROFILES]),
  sorted(rustSurfaceProfiles),
  "gateway TOOL_SURFACE_PROFILES must match Rust surface constants",
);

for (const profile of TOOL_SURFACE_PROFILES) {
  expectDeepEqual(
    toolNamesForSurfaceProfile(profile),
    extractRustSurfaceToolNames(profile),
    `gateway surface profile tools must match Rust tool_surface_profile_names for ${profile}`,
  );
}

process.stdout.write(JSON.stringify({
  ok: true,
  catalog_tool_count: rustCatalogNames.length,
  default_enabled_count: rustDefaultEnabledNames.length,
  dispatch_supported_count: rustDispatchSupportedNames.length,
  dispatch_match_count: rustDispatchMatchNames.length,
  legacy_dispatch_aliases: rustDispatchSupportedNames.filter((name) => !rustCatalogNames.includes(name)),
  surface_profiles: [...TOOL_SURFACE_PROFILES],
}) + "\n");
