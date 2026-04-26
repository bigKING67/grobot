export const RUNTIME_TOOL_OUTPUT_BUDGET_POLICY_VERSION = "v1";

export const RUNTIME_TOOL_MESSAGE_BUDGETS: Record<string, number> = {
  "*": 80_000,
  mcp_call: 48_000,
  web_scan: 48_000,
  web_execute_js: 48_000,
};

export interface RuntimeToolMessageBudgetProfile {
  toolName: string;
  maxChars: number;
  appliesTo: "model_tool_message_content";
}

export interface RuntimeToolMessageBudgetParseResult {
  profiles: RuntimeToolMessageBudgetProfile[];
  rawCount: number;
  invalidReason: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStrictPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

export function parseRuntimeToolMessageBudgetProfilesWithDiagnostics(
  value: unknown,
): RuntimeToolMessageBudgetParseResult {
  if (value == null) {
    return { profiles: [], rawCount: 0, invalidReason: null };
  }
  if (!Array.isArray(value)) {
    return { profiles: [], rawCount: 0, invalidReason: "tool_message_budget_profiles_not_array" };
  }
  const profiles: RuntimeToolMessageBudgetProfile[] = [];
  let invalidRowCount = 0;
  const seen = new Set<string>();
  for (const row of value) {
    if (!isRecord(row)) {
      invalidRowCount += 1;
      continue;
    }
    const toolName = typeof row.tool_name === "string" ? row.tool_name.trim() : "";
    const maxChars = parseStrictPositiveInteger(row.max_chars);
    const appliesTo = typeof row.applies_to === "string" ? row.applies_to.trim() : "";
    if (
      !toolName
      || seen.has(toolName)
      || maxChars == null
      || appliesTo !== "model_tool_message_content"
    ) {
      invalidRowCount += 1;
      continue;
    }
    seen.add(toolName);
    profiles.push({
      toolName,
      maxChars,
      appliesTo,
    });
  }
  return {
    profiles,
    rawCount: value.length,
    invalidReason: invalidRowCount > 0
      ? `tool_message_budget_profiles_invalid_rows:${invalidRowCount}`
      : null,
  };
}

export function validateRuntimeToolMessageBudgetProfilesAgainstPolicy(
  profiles: readonly RuntimeToolMessageBudgetProfile[],
): string | null {
  if (profiles.length === 0) {
    return "tool_message_budget_profiles_missing";
  }
  const observed = new Map<string, number>();
  for (const profile of profiles) {
    observed.set(profile.toolName, profile.maxChars);
  }
  for (const [toolName, expectedMaxChars] of Object.entries(RUNTIME_TOOL_MESSAGE_BUDGETS)) {
    const actualMaxChars = observed.get(toolName);
    if (actualMaxChars == null) {
      return `tool_message_budget_profiles_missing_tool:${toolName}`;
    }
    if (actualMaxChars !== expectedMaxChars) {
      return `tool_message_budget_profiles_max_chars_mismatch:${toolName}:${String(actualMaxChars)}>${String(expectedMaxChars)}`;
    }
  }
  const knownTools = new Set(Object.keys(RUNTIME_TOOL_MESSAGE_BUDGETS));
  const unknownTools = profiles
    .map((profile) => profile.toolName)
    .filter((toolName) => !knownTools.has(toolName));
  if (unknownTools.length > 0) {
    return `tool_message_budget_profiles_unknown_tools:${unknownTools.join(",")}`;
  }
  return null;
}
