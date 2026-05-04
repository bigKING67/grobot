import { TOOL_SURFACE_POLICY_VERSION } from "../../tools/runtime/default-enabled-tools";
import { runBudgetAndSchemaContract } from "./runtime-tool-surface-contract/budget-and-schema";
import { runRecoveryAdaptationContract } from "./runtime-tool-surface-contract/recovery-adaptation";
import { runRoutingProfilesContract } from "./runtime-tool-surface-contract/routing-profiles";
import { runRuntimeDescribeContract } from "./runtime-tool-surface-contract/runtime-describe";

runBudgetAndSchemaContract();
runRuntimeDescribeContract();
const routing = runRoutingProfilesContract();
const recovery = runRecoveryAdaptationContract();

process.stdout.write(JSON.stringify({
  ok: true,
  policy_version: TOOL_SURFACE_POLICY_VERSION,
  routing_eval_count: routing.routingEvalCount,
  coding_visible_count: routing.codingVisibleCount,
  browser_visible_count: routing.browserVisibleCount,
  full_debug_visible_count: routing.fullDebugVisibleCount,
  full_debug_dispatch_count: routing.fullDebugDispatchCount,
  full_debug_dispatch_matches_visible: routing.fullDebugDispatchMatchesVisible,
  page_component_code_profile: routing.pageComponentCodeProfile,
  context_engine_code_profile: routing.contextEngineCodeProfile,
  web_scan_schema_code_profile: routing.webScanSchemaCodeProfile,
  web_scan_schema_suppressed_count: routing.webScanSchemaSuppressedCount,
  browser_schema_code_profile: routing.browserSchemaCodeProfile,
  browser_schema_suppressed_count: routing.browserSchemaSuppressedCount,
  mcp_tool_code_profile: routing.mcpToolCodeProfile,
  mcp_tool_code_suppressed_count: routing.mcpToolCodeSuppressedCount,
  semantic_tool_code_profile: routing.semanticToolCodeProfile,
  semantic_tool_code_suppressed_count: routing.semanticToolCodeSuppressedCount,
  direct_browser_tool_profile: routing.directBrowserToolProfile,
  direct_browser_tool_suppressed_count: routing.directBrowserToolSuppressedCount,
  direct_mcp_tool_profile: routing.directMcpToolProfile,
  direct_context_tool_profile: routing.directContextToolProfile,
  adapted_browser_profile: recovery.adaptedBrowserProfile,
  adapted_context_profile: recovery.adaptedContextProfile,
  adapted_mcp_profile: recovery.adaptedMcpProfile,
  code_symbol_recovery_adapted: recovery.codeSymbolRecoveryAdapted,
  direct_browser_recovery_profile: recovery.directBrowserRecoveryProfile,
  stale_recovery_adapted: recovery.staleRecoveryAdapted,
  nonrecoverable_blocks_auto_adaptation: recovery.nonrecoverableBlocksAutoAdaptation,
  gate_blocks_surface_adaptation: recovery.gateBlocksSurfaceAdaptation,
  gate_blocked_surface_adaptation_reason: recovery.gateBlockedSurfaceAdaptationReason,
  nonrecoverable_intervention_consumed: true,
  newer_nonrecoverable_intervention_remains_active: true,
  adaptation_guard_recovered_signal_consumed: true,
  successful_tool_call_consumed: true,
  recovery_feedback_consumed_at_source: true,
  newer_recovery_bypasses_consumed_guard: true,
  adaptation_guard_prompt_suppresses_recovery_hint: true,
  adaptation_guard_repeated_failure: true,
  adaptation_guard_profile_oscillation: true,
  adaptation_guard_ignores_recovered_oscillation: true,
}) + "\n");
