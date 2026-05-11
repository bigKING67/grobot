import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  assertSuccess,
  contractsRoot,
  isRecord,
  logStep,
  makeTempDir,
  parseJsonOutput,
  repoRoot,
  runCommand,
  runCommandAsync,
  runContract,
  runTsContract,
  writeFixtureFile,
} from "../harness.mjs";
export function runCoreFastContracts() {
  const credentialResult = runContract("management-policy-contract.mjs", "build-credential", [
    "--payload",
    JSON.stringify({ token: "ops-read-token", policy_template: "ops_read_only" }),
  ]);
  const credentialPayload = parseJsonOutput("management-policy-contract build-credential", credentialResult.stdout);
  assert.equal(typeof credentialPayload?.credential?.token, "string");
  logStep("management-policy-contract build-credential");

  const actionAllowedResult = runContract("management-policy-contract.mjs", "action-allowed", [
    "--payload",
    JSON.stringify({ token: "ops-read-token", actions: ["config_read"] }),
    "--required-action",
    "config_read",
  ]);
  const actionAllowedPayload = parseJsonOutput("management-policy-contract action-allowed", actionAllowedResult.stdout);
  assert.equal(actionAllowedPayload.allowed, true);
  logStep("management-policy-contract action-allowed");

  const localToolsResult = runContract("local-tools-contract.mjs", "file-mention-enrichment");
  const localToolsPayload = parseJsonOutput("local-tools-contract file-mention-enrichment", localToolsResult.stdout);
  assert.equal(Array.isArray(localToolsPayload.lines), true);
  assert.equal(localToolsPayload.lines.length >= 3, true);
  logStep("local-tools-contract file-mention-enrichment");

  const semanticSearchToolResult = runContract("local-tools-contract.mjs", "semantic-search-tool");
  const semanticSearchToolPayload = parseJsonOutput(
    "local-tools-contract semantic-search-tool",
    semanticSearchToolResult.stdout,
  );
  assert.equal(semanticSearchToolPayload.tool, "semantic_search");
  assert.equal(Number(semanticSearchToolPayload.count) >= 1, true);
  assert.equal(Array.isArray(semanticSearchToolPayload.source_stats), true);
  assert.equal(Array.isArray(semanticSearchToolPayload.matches), true);
  logStep("local-tools-contract semantic-search-tool");

  const promptEnhancerToolResult = runContract("local-tools-contract.mjs", "prompt-enhancer-tool");
  const promptEnhancerToolPayload = parseJsonOutput(
    "local-tools-contract prompt-enhancer-tool",
    promptEnhancerToolResult.stdout,
  );
  assert.equal(promptEnhancerToolPayload.tool, "prompt_enhancer");
  assert.equal(Array.isArray(promptEnhancerToolPayload.technical_terms), true);
  assert.equal(Array.isArray(promptEnhancerToolPayload.evidence), true);
  assert.equal(typeof promptEnhancerToolPayload.context_block, "string");
  logStep("local-tools-contract prompt-enhancer-tool");

  const semanticSearchQualityRegressionResult = runContract(
    "semantic-search-regression-contract.mjs",
    "quality-regression",
  );
  const semanticSearchQualityRegressionPayload = parseJsonOutput(
    "semantic-search-regression-contract quality-regression",
    semanticSearchQualityRegressionResult.stdout,
  );
  assert.equal(semanticSearchQualityRegressionPayload.passed, true);
  assert.equal(
    String(semanticSearchQualityRegressionPayload.semantic_top_path),
    "src/session-policy.ts",
  );
  assert.equal(
    String(semanticSearchQualityRegressionPayload.index_required_error).includes("semantic_index_required"),
    true,
  );
  assert.equal(
    String(semanticSearchQualityRegressionPayload.zh_index_required_error).includes("semantic_index_required"),
    true,
  );
  assert.equal(
    String(semanticSearchQualityRegressionPayload.legacy_section_error).includes("legacy [context_retrieval]"),
    true,
  );
  logStep("semantic-search-regression-contract quality-regression");
}

function runSemanticBenchmarkContract(command, expectedProfile, minimumRowCount, minimumComparisonCount) {
  const semanticSearchBenchmarkResult = runContract(
    "semantic-search-regression-contract.mjs",
    command,
  );
  const semanticSearchBenchmarkPayload = parseJsonOutput(
    `semantic-search-regression-contract ${command}`,
    semanticSearchBenchmarkResult.stdout,
  );
  assert.equal(semanticSearchBenchmarkPayload.passed, true);
  assert.equal(semanticSearchBenchmarkPayload.config?.profile, expectedProfile);
  assert.equal(Array.isArray(semanticSearchBenchmarkPayload.rows), true);
  assert.equal(Array.isArray(semanticSearchBenchmarkPayload.comparisons), true);
  assert.equal(semanticSearchBenchmarkPayload.rows.length >= minimumRowCount, true);
  assert.equal(semanticSearchBenchmarkPayload.comparisons.length >= minimumComparisonCount, true);
  logStep(`semantic-search-regression-contract ${command}`, {
    rows: semanticSearchBenchmarkPayload.rows.length,
    comparisons: semanticSearchBenchmarkPayload.comparisons.length,
  });
}

export function runSemanticBenchmarkSmokeContracts() {
  runSemanticBenchmarkContract("benchmark-smoke", "smoke", 4, 2);
}

export function runSemanticBenchmarkFullContracts() {
  runSemanticBenchmarkContract("benchmark", "full", 8, 4);
}

export function runSemanticBenchmarkContracts() {
  runSemanticBenchmarkFullContracts();
}

export async function runCoreContracts() {
  runCoreFastContracts();

  const mcpPolicyResult = runContract("local-tools-contract.mjs", "resolve-mcp-call-policy");
  const mcpPolicyPayload = parseJsonOutput("local-tools-contract resolve-mcp-call-policy", mcpPolicyResult.stdout);
  assert.equal(Number(mcpPolicyPayload.max_concurrency_per_server) >= 1, true);
  assert.equal(Number(mcpPolicyPayload.max_queue_per_server) >= 0, true);
  assert.equal(Number(mcpPolicyPayload.failure_threshold) >= 1, true);
  assert.equal(Number(mcpPolicyPayload.cooldown_secs) >= 1, true);
  assert.equal(Number(mcpPolicyPayload.latency_sample_limit) >= 16, true);
  assert.equal(Array.isArray(mcpPolicyPayload.allow_tools), true);
  logStep("local-tools-contract resolve-mcp-call-policy");

  const mcpQueueGateResult = runContract("local-tools-contract.mjs", "mcp-server-slot-queue-full");
  const mcpQueueGatePayload = parseJsonOutput("local-tools-contract mcp-server-slot-queue-full", mcpQueueGateResult.stdout);
  assert.equal(mcpQueueGatePayload.raised, true);
  assert.equal(Number(mcpQueueGatePayload?.snapshot?.gate_rejected_calls), 1);
  logStep("local-tools-contract mcp-server-slot-queue-full");

  const mcpCircuitOpenResult = runContract("local-tools-contract.mjs", "mcp-server-circuit-open");
  const mcpCircuitOpenPayload = parseJsonOutput("local-tools-contract mcp-server-circuit-open", mcpCircuitOpenResult.stdout);
  assert.equal(mcpCircuitOpenPayload.raised, true);
  assert.equal(mcpCircuitOpenPayload.opened_second, true);
  assert.equal(Number(mcpCircuitOpenPayload?.snapshot?.gate_rejected_calls), 1);
  logStep("local-tools-contract mcp-server-circuit-open");

  const mcpServersSummaryResult = runContract("local-tools-contract.mjs", "mcp-servers-summary");
  const mcpServersSummaryPayload = parseJsonOutput("local-tools-contract mcp-servers-summary", mcpServersSummaryResult.stdout);
  assert.equal(Number(mcpServersSummaryPayload?.full?.total), 3);
  assert.equal(Number(mcpServersSummaryPayload?.full?.ready_count), 1);
  assert.equal(Number(mcpServersSummaryPayload?.full?.runtime_summary?.servers_considered), 3);
  assert.equal(Number(mcpServersSummaryPayload?.ready_only?.runtime_summary?.servers_considered), 1);
  logStep("local-tools-contract mcp-servers-summary");

  const mcpCallStdioResult = runContract("local-tools-contract.mjs", "mcp-call-stdio");
  const mcpCallStdioPayload = parseJsonOutput("local-tools-contract mcp-call-stdio", mcpCallStdioResult.stdout);
  assert.equal(mcpCallStdioPayload?.first?.session_reused, false);
  assert.equal(mcpCallStdioPayload?.second?.session_reused, true);
  assert.equal(Number(mcpCallStdioPayload?.second?.runtime_state?.total_calls), 2);
  logStep("local-tools-contract mcp-call-stdio");

  const mcpCallRecoverResult = runContract("local-tools-contract.mjs", "mcp-call-auto-recover");
  const mcpCallRecoverPayload = parseJsonOutput("local-tools-contract mcp-call-auto-recover", mcpCallRecoverResult.stdout);
  assert.equal(mcpCallRecoverPayload?.second?.session_recovered, true);
  assert.equal(Number(mcpCallRecoverPayload?.second?.runtime_state?.recovered_calls), 1);
  logStep("local-tools-contract mcp-call-auto-recover");

  const mcpCallToolFailureResult = runContract("local-tools-contract.mjs", "mcp-call-tool-failure");
  const mcpCallToolFailurePayload = parseJsonOutput("local-tools-contract mcp-call-tool-failure", mcpCallToolFailureResult.stdout);
  assert.equal(mcpCallToolFailurePayload.raised, true);
  assert.equal(Number(mcpCallToolFailurePayload?.snapshot?.tool_failures), 1);
  logStep("local-tools-contract mcp-call-tool-failure");

  const mcpCallAllowToolsResult = runContract("local-tools-contract.mjs", "mcp-call-allow-tools");
  const mcpCallAllowToolsPayload = parseJsonOutput("local-tools-contract mcp-call-allow-tools", mcpCallAllowToolsResult.stdout);
  assert.equal(mcpCallAllowToolsPayload.raised, true);
  assert.equal(Number(mcpCallAllowToolsPayload?.snapshot?.policy_denied_calls), 1);
  logStep("local-tools-contract mcp-call-allow-tools");

  const turnGateResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/turn-gate-contract.ts",
  ]);
  assertSuccess("turn-gate-contract", turnGateResult);
  const turnGatePayload = parseJsonOutput("turn-gate-contract", turnGateResult.stdout);
  assert.equal(turnGatePayload.first_same_session_active, true);
  assert.equal(turnGatePayload.reentrant_rejected, true);
  assert.equal(turnGatePayload.reentrant_error_class, "turn_gate_reentrant");
  assert.equal(turnGatePayload.different_session_completed, true);
  assert.equal(Number(turnGatePayload.runtime_call_count_after_reject), 1);
  assert.equal(Number(turnGatePayload.final_active_sessions), 0);
  assert.equal(Number(turnGatePayload.rejected_reentrant_total), 1);
  assert.equal(turnGatePayload.stale_end_returned, false);
  assert.equal(Number(turnGatePayload.stale_cleanup_total), 1);
  assert.equal(turnGatePayload.stale_start_typed, true);
  assert.equal(turnGatePayload.serialized_has_snake_case, true);
  assert.equal(Number(turnGatePayload.persisted_reports), 2);
  logStep("turn-gate-contract");

  const providerRoutingResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/provider-routing-contract.ts",
  ]);
  assertSuccess("provider-routing-contract", providerRoutingResult);
  const providerRoutingPayload = parseJsonOutput("provider-routing-contract", providerRoutingResult.stdout);
  assert.equal(providerRoutingPayload.structured_retryable_503_retries, true);
  assert.equal(providerRoutingPayload.structured_retryable_false_429_does_not_retry, true);
  assert.equal(providerRoutingPayload.exhausted_attempts_do_not_retry_without_retryable, true);
  assert.equal(providerRoutingPayload.retry_503_reason_matches, true);
  logStep("provider-routing-contract");

  const routeStatusResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/route-status-contract.ts",
  ]);
  assertSuccess("route-status-contract", routeStatusResult);
  const routeStatusPayload = parseJsonOutput("route-status-contract", routeStatusResult.stdout);
  assert.equal(routeStatusPayload.serialized_has_last_error_data, true);
  assert.equal(routeStatusPayload.legacy_text_has_provider_error_data, true);
  assert.equal(routeStatusPayload.default_summary_has_provider_error_data, true);
  assert.equal(routeStatusPayload.normalized_drops_body_preview, true);
  logStep("route-status-contract");

  const homeDir = makeTempDir("grobot-home");
  const workDir = makeTempDir("grobot-work");
  const runtimePathsResult = runContract("runtime-paths-contract.mjs", "resolve-runtime-paths", [
    "--home",
    homeDir,
    "--work-dir",
    workDir,
    "--repo-root",
    repoRoot,
  ]);
  const runtimePathsPayload = parseJsonOutput("runtime-paths-contract resolve-runtime-paths", runtimePathsResult.stdout);
  assert.equal(typeof runtimePathsPayload.project_root, "string");
  logStep("runtime-paths-contract resolve-runtime-paths");

  const runtimePathResolutionResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/runtime-path-resolution-contract.ts",
  ]);
  assertSuccess("runtime-path-resolution-contract", runtimePathResolutionResult);
  const runtimePathResolutionPayload = parseJsonOutput(
    "runtime-path-resolution-contract",
    runtimePathResolutionResult.stdout,
  );
  assert.equal(runtimePathResolutionPayload.explicit_project_root_isolates_dev_repo_config, true);
  assert.equal(runtimePathResolutionPayload.explicit_project_root_prefers_project_toml, true);
  assert.equal(runtimePathResolutionPayload.explicit_project_root_reads_distinct_workdir_toml, true);
  assert.equal(runtimePathResolutionPayload.explicit_project_root_prefers_project_over_workdir_toml, true);
  assert.equal(runtimePathResolutionPayload.implicit_project_root_allows_dev_repo_fallback, true);
  assert.equal(runtimePathResolutionPayload.empty_project_root_rejected, true);
  assert.equal(runtimePathResolutionPayload.missing_work_dir_value_rejected, true);
  assert.equal(runtimePathResolutionPayload.empty_project_toml_rejected, true);
  assert.equal(runtimePathResolutionPayload.empty_config_path_rejected, true);
  assert.equal(runtimePathResolutionPayload.empty_home_dir_rejected, true);
  logStep("runtime-path-resolution-contract");

  runContract("session-lifecycle-contract.mjs", "parse-args", [
    "--argv",
    JSON.stringify(["start", "--session-scope", "dm", "--session-subject", "smoke-user"]),
  ]);
  logStep("session-lifecycle-contract parse-args");
}
