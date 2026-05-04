import { spawnSync } from "node:child_process";
import {
  parseRuntimeToolMessageBudgetProfilesWithDiagnostics,
  RUNTIME_TOOL_OUTPUT_BUDGET_POLICY_VERSION,
  validateRuntimeToolMessageBudgetProfilesAgainstPolicy,
} from "../../tools/runtime/tool-output-budget";
import {
  buildRuntimeToolRecoveryCatalogFingerprint,
  buildRuntimeToolSurfaceSchemaProfilesFingerprint,
  buildToolsManifestFingerprint,
} from "./fingerprint";
import {
  dedupeStringArray,
  isRecord,
  normalizeStringArray,
  parseRuntimeJsonRpcResult,
} from "./json-utils";
import { parseRuntimeToolRecoveryCatalogWithDiagnostics } from "./recovery-catalog";
import {
  parseRuntimeToolSurfaceSchemaProfilesWithDiagnostics,
  validateRuntimeToolSurfaceSchemaProfilesAgainstManifest,
} from "./schema-profiles";
import {
  type RuntimeToolRecoveryCatalogRow,
  type RuntimeToolsDescribeResult,
  type RuntimeToolSurfaceSchemaProfile,
} from "./types";
import { TOOL_SURFACE_POLICY_VERSION } from "../../tools/runtime/default-enabled-tools";

interface RuntimeToolsDescribeValidationState extends RuntimeToolsDescribeResult {
  uniqueToolNames: string[];
  recoveryCatalogParseInvalidReason: string | null;
  recoveryCatalogFingerprintFromPayload: string | null;
  schemaProfilesParseInvalidReason: string | null;
  schemaProfilesFingerprintFromPayload: string | null;
  budgetProfilesParseInvalidReason: string | null;
}

function failedRuntimeToolsDescribe(
  detail: string,
  partial?: Partial<RuntimeToolsDescribeResult>,
): RuntimeToolsDescribeResult {
  return {
    ok: false,
    detail,
    toolNames: partial?.toolNames ?? [],
    defaultEnabledTools: partial?.defaultEnabledTools ?? [],
    manifestFingerprint:
      partial?.manifestFingerprint ?? buildToolsManifestFingerprint([], []),
    toolRecoveryPolicyVersion: partial?.toolRecoveryPolicyVersion ?? null,
    toolRecoveryCatalogFingerprint:
      partial?.toolRecoveryCatalogFingerprint ?? null,
    toolRecoveryActions: partial?.toolRecoveryActions ?? [],
    toolRecoveryCatalog: partial?.toolRecoveryCatalog ?? [],
    toolSurfaceSchemaProfilesFingerprint:
      partial?.toolSurfaceSchemaProfilesFingerprint ?? null,
    toolSurfaceSchemaProfiles: partial?.toolSurfaceSchemaProfiles ?? [],
    toolMessageBudgetPolicyVersion: partial?.toolMessageBudgetPolicyVersion,
    toolMessageBudgetProfiles: partial?.toolMessageBudgetProfiles,
  };
}

function buildDescribeState(input: {
  parsedResult: Record<string, unknown>;
}): RuntimeToolsDescribeValidationState {
  const parsed = input.parsedResult;
  const defaultEnabledTools = dedupeStringArray(
    normalizeStringArray(parsed.default_enabled_tools),
  );
  const toolRecoveryPolicyVersion =
    typeof parsed.tool_recovery_policy_version === "string" &&
    parsed.tool_recovery_policy_version.trim().length > 0
      ? parsed.tool_recovery_policy_version.trim()
      : null;
  const toolRecoveryCatalogFingerprint =
    typeof parsed.tool_recovery_catalog_fingerprint === "string" &&
    parsed.tool_recovery_catalog_fingerprint.trim().length > 0
      ? parsed.tool_recovery_catalog_fingerprint.trim()
      : null;
  const toolRecoveryActions = dedupeStringArray(
    normalizeStringArray(parsed.tool_recovery_actions),
  );
  const recoveryCatalogParse = parseRuntimeToolRecoveryCatalogWithDiagnostics(
    parsed.tool_recovery_catalog,
  );
  const recoveryCatalogFingerprintFromPayload =
    buildRuntimeToolRecoveryCatalogFingerprint(
      parsed.tool_recovery_catalog,
      toolRecoveryPolicyVersion ?? TOOL_SURFACE_POLICY_VERSION,
    );
  const toolRecoveryCatalog = recoveryCatalogParse.rows;
  const toolSurfaceSchemaProfilesFingerprint =
    typeof parsed.tool_surface_schema_profiles_fingerprint === "string" &&
    parsed.tool_surface_schema_profiles_fingerprint.trim().length > 0
      ? parsed.tool_surface_schema_profiles_fingerprint.trim()
      : null;
  const schemaProfilesParse =
    parseRuntimeToolSurfaceSchemaProfilesWithDiagnostics(
      parsed.tool_surface_schema_profiles,
    );
  const schemaProfilesFingerprintFromPayload =
    buildRuntimeToolSurfaceSchemaProfilesFingerprint(
      parsed.tool_surface_schema_profiles,
    );
  const toolSurfaceSchemaProfiles = schemaProfilesParse.profiles;
  const toolMessageBudgetPolicyVersion =
    typeof parsed.tool_message_budget_policy_version === "string" &&
    parsed.tool_message_budget_policy_version.trim().length > 0
      ? parsed.tool_message_budget_policy_version.trim()
      : null;
  const budgetProfilesParse =
    parseRuntimeToolMessageBudgetProfilesWithDiagnostics(
      parsed.tool_message_budget_profiles,
    );
  const toolMessageBudgetProfiles = budgetProfilesParse.profiles;
  const rawTools = parsed.tools;
  const toolNames: string[] = [];
  if (Array.isArray(rawTools)) {
    for (const row of rawTools) {
      if (!isRecord(row) || !isRecord(row.function)) {
        continue;
      }
      const name = row.function.name;
      if (typeof name !== "string") {
        continue;
      }
      const normalized = name.trim();
      if (!normalized) {
        continue;
      }
      toolNames.push(normalized);
    }
  }
  const uniqueToolNames = dedupeStringArray(toolNames);
  const manifestFingerprint = buildToolsManifestFingerprint(
    uniqueToolNames,
    defaultEnabledTools,
  );
  return {
    ok: true,
    detail: "runtime.tools.describe=ok",
    uniqueToolNames,
    toolNames: uniqueToolNames,
    defaultEnabledTools,
    manifestFingerprint,
    toolRecoveryPolicyVersion,
    toolRecoveryCatalogFingerprint,
    toolRecoveryActions,
    toolRecoveryCatalog,
    toolSurfaceSchemaProfilesFingerprint,
    toolSurfaceSchemaProfiles,
    toolMessageBudgetPolicyVersion,
    toolMessageBudgetProfiles,
    recoveryCatalogParseInvalidReason: recoveryCatalogParse.invalidReason,
    recoveryCatalogFingerprintFromPayload,
    schemaProfilesParseInvalidReason: schemaProfilesParse.invalidReason,
    schemaProfilesFingerprintFromPayload,
    budgetProfilesParseInvalidReason: budgetProfilesParse.invalidReason,
  };
}

function validateDescribeState(
  state: RuntimeToolsDescribeValidationState,
): RuntimeToolsDescribeResult {
  const failureBase = {
    toolNames: state.uniqueToolNames,
    defaultEnabledTools: state.defaultEnabledTools,
    manifestFingerprint: state.manifestFingerprint,
    toolRecoveryPolicyVersion: state.toolRecoveryPolicyVersion,
    toolRecoveryCatalogFingerprint: state.toolRecoveryCatalogFingerprint,
    toolRecoveryActions: state.toolRecoveryActions,
    toolRecoveryCatalog: state.toolRecoveryCatalog,
    toolSurfaceSchemaProfilesFingerprint:
      state.toolSurfaceSchemaProfilesFingerprint,
    toolSurfaceSchemaProfiles: state.toolSurfaceSchemaProfiles,
    toolMessageBudgetPolicyVersion: state.toolMessageBudgetPolicyVersion,
    toolMessageBudgetProfiles: state.toolMessageBudgetProfiles,
  };
  if (state.uniqueToolNames.length === 0) {
    return failedRuntimeToolsDescribe(
      "runtime_tools_describe_missing_tools",
      failureBase,
    );
  }
  if (state.defaultEnabledTools.length === 0) {
    return failedRuntimeToolsDescribe(
      "runtime_tools_describe_missing_default_enabled_tools",
      failureBase,
    );
  }
  const toolNameSet = new Set(state.uniqueToolNames);
  const unknownDefaultEnabled = state.defaultEnabledTools.filter(
    (toolName) => !toolNameSet.has(toolName),
  );
  if (unknownDefaultEnabled.length > 0) {
    return failedRuntimeToolsDescribe(
      `runtime_tools_describe_invalid_default_enabled_tools:${unknownDefaultEnabled.join(",")}`,
      failureBase,
    );
  }
  if (state.recoveryCatalogParseInvalidReason != null) {
    return failedRuntimeToolsDescribe(
      `runtime_tools_describe_invalid_recovery_catalog:${state.recoveryCatalogParseInvalidReason}`,
      failureBase,
    );
  }
  if (
    !state.toolRecoveryPolicyVersion &&
    (state.toolRecoveryCatalog.length > 0 ||
      state.toolRecoveryActions.length > 0)
  ) {
    return failedRuntimeToolsDescribe(
      "runtime_tools_describe_missing_recovery_policy_version",
      failureBase,
    );
  }
  if (
    state.toolRecoveryCatalogFingerprint &&
    state.toolRecoveryCatalog.length === 0
  ) {
    return failedRuntimeToolsDescribe(
      "runtime_tools_describe_missing_recovery_catalog",
      failureBase,
    );
  }
  if (
    !state.toolRecoveryCatalogFingerprint &&
    state.toolRecoveryCatalog.length > 0
  ) {
    return failedRuntimeToolsDescribe(
      "runtime_tools_describe_missing_recovery_catalog_fingerprint",
      failureBase,
    );
  }
  if (
    state.toolRecoveryCatalogFingerprint &&
    state.recoveryCatalogFingerprintFromPayload &&
    state.toolRecoveryCatalogFingerprint !==
      state.recoveryCatalogFingerprintFromPayload
  ) {
    return failedRuntimeToolsDescribe(
      `runtime_tools_describe_recovery_catalog_fingerprint_mismatch:reported=${state.toolRecoveryCatalogFingerprint}` +
        `:computed=${state.recoveryCatalogFingerprintFromPayload}`,
      failureBase,
    );
  }
  if (state.toolRecoveryActions.length === 0) {
    return failedRuntimeToolsDescribe(
      "runtime_tools_describe_missing_recovery_actions",
      failureBase,
    );
  }
  const catalogActionSet = new Set(
    state.toolRecoveryCatalog.map((row) => row.recommendedNextAction),
  );
  const unknownRecoveryActions = state.toolRecoveryActions.filter(
    (action) => !catalogActionSet.has(action),
  );
  const missingRecoveryActions = [...catalogActionSet].filter(
    (action) => !state.toolRecoveryActions.includes(action),
  );
  if (missingRecoveryActions.length > 0) {
    return failedRuntimeToolsDescribe(
      `runtime_tools_describe_missing_recovery_actions:${missingRecoveryActions.join(",")}`,
      failureBase,
    );
  }
  if (unknownRecoveryActions.length > 0) {
    return failedRuntimeToolsDescribe(
      `runtime_tools_describe_invalid_recovery_actions:${unknownRecoveryActions.join(",")}`,
      failureBase,
    );
  }
  if (state.schemaProfilesParseInvalidReason != null) {
    return failedRuntimeToolsDescribe(
      `runtime_tools_describe_invalid_schema_profiles:${state.schemaProfilesParseInvalidReason}`,
      failureBase,
    );
  }
  if (
    state.toolSurfaceSchemaProfilesFingerprint &&
    state.toolSurfaceSchemaProfiles.length === 0
  ) {
    return failedRuntimeToolsDescribe(
      "runtime_tools_describe_missing_schema_profiles",
      failureBase,
    );
  }
  if (
    !state.toolSurfaceSchemaProfilesFingerprint &&
    state.toolSurfaceSchemaProfiles.length > 0
  ) {
    return failedRuntimeToolsDescribe(
      "runtime_tools_describe_missing_schema_profiles_fingerprint",
      failureBase,
    );
  }
  if (
    state.toolSurfaceSchemaProfilesFingerprint &&
    state.schemaProfilesFingerprintFromPayload &&
    state.toolSurfaceSchemaProfilesFingerprint !==
      state.schemaProfilesFingerprintFromPayload
  ) {
    return failedRuntimeToolsDescribe(
      `runtime_tools_describe_schema_profiles_fingerprint_mismatch:reported=${state.toolSurfaceSchemaProfilesFingerprint}` +
        `:computed=${state.schemaProfilesFingerprintFromPayload}`,
      failureBase,
    );
  }
  const schemaProfileManifestInvalidReason =
    validateRuntimeToolSurfaceSchemaProfilesAgainstManifest({
      profiles: state.toolSurfaceSchemaProfiles,
      toolNames: state.uniqueToolNames,
    });
  if (schemaProfileManifestInvalidReason != null) {
    return failedRuntimeToolsDescribe(
      `runtime_tools_describe_invalid_schema_profiles:${schemaProfileManifestInvalidReason}`,
      failureBase,
    );
  }
  if (!state.toolMessageBudgetPolicyVersion) {
    return failedRuntimeToolsDescribe(
      "runtime_tools_describe_missing_tool_message_budget_policy_version",
      failureBase,
    );
  }
  if (
    state.toolMessageBudgetPolicyVersion !==
    RUNTIME_TOOL_OUTPUT_BUDGET_POLICY_VERSION
  ) {
    return failedRuntimeToolsDescribe(
      `runtime_tools_describe_tool_message_budget_policy_version_mismatch:${state.toolMessageBudgetPolicyVersion}`,
      failureBase,
    );
  }
  if (state.budgetProfilesParseInvalidReason != null) {
    return failedRuntimeToolsDescribe(
      `runtime_tools_describe_invalid_tool_message_budget_profiles:${state.budgetProfilesParseInvalidReason}`,
      failureBase,
    );
  }
  const budgetProfileInvalidReason =
    validateRuntimeToolMessageBudgetProfilesAgainstPolicy(
      state.toolMessageBudgetProfiles ?? [],
    );
  if (budgetProfileInvalidReason != null) {
    return failedRuntimeToolsDescribe(
      `runtime_tools_describe_invalid_tool_message_budget_profiles:${budgetProfileInvalidReason}`,
      failureBase,
    );
  }
  return {
    ok: true,
    detail: "runtime.tools.describe=ok",
    toolNames: state.uniqueToolNames,
    defaultEnabledTools: state.defaultEnabledTools,
    manifestFingerprint: state.manifestFingerprint,
    toolRecoveryPolicyVersion: state.toolRecoveryPolicyVersion,
    toolRecoveryCatalogFingerprint: state.toolRecoveryCatalogFingerprint,
    toolRecoveryActions: state.toolRecoveryActions,
    toolRecoveryCatalog: state.toolRecoveryCatalog,
    toolSurfaceSchemaProfilesFingerprint:
      state.toolSurfaceSchemaProfilesFingerprint,
    toolSurfaceSchemaProfiles: state.toolSurfaceSchemaProfiles,
    toolMessageBudgetPolicyVersion: state.toolMessageBudgetPolicyVersion,
    toolMessageBudgetProfiles: state.toolMessageBudgetProfiles,
  };
}

export function runRuntimeToolsDescribe(
  runtimeBinaryPath: string,
): RuntimeToolsDescribeResult {
  const input = JSON.stringify({
    jsonrpc: "2.0",
    id: "tools-describe-1",
    method: "runtime.tools.describe",
    params: {},
  });
  const run = spawnSync(runtimeBinaryPath, [], {
    input: `${input}\n`,
    encoding: "utf8",
    timeout: 4_000,
    maxBuffer: 1_048_576,
  });
  if (run.error) {
    return failedRuntimeToolsDescribe(`spawn_failed: ${String(run.error)}`);
  }
  if (run.status !== 0) {
    return failedRuntimeToolsDescribe(
      `exit_status_${String(run.status)} stderr=${String(run.stderr || "").trim()}`,
    );
  }
  const parsed = parseRuntimeJsonRpcResult(String(run.stdout || ""));
  if (!parsed.ok || !parsed.result) {
    return failedRuntimeToolsDescribe(parsed.detail);
  }
  return validateDescribeState(buildDescribeState({ parsedResult: parsed.result }));
}
