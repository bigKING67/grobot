import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  repoRoot,
  runContract,
} from "../harness.mjs";

export function runRuntimeContextMcpInstructionFlowSmoke() {
  const mcpInstructionFlowResult = runContract("start-smoke-contract.mjs", "start-mcp-instruction-events-flow", [
    "--repo-root",
    repoRoot,
  ]);
  const mcpInstructionFlowPayload = parseJsonOutput(
    "start-smoke-contract start-mcp-instruction-events-flow",
    mcpInstructionFlowResult.stdout,
  );
  assert.equal(mcpInstructionFlowPayload.project_pack_loaded_project, true);
  assert.equal(mcpInstructionFlowPayload.project_prompt_injected, true);
  assert.equal(mcpInstructionFlowPayload.fallback_used, true);
  assert.equal(mcpInstructionFlowPayload.fallback_pack_loaded_global, true);
  assert.equal(mcpInstructionFlowPayload.fallback_prompt_injected, true);
  assert.equal(mcpInstructionFlowPayload.missing_pack_event, true);
  assert.equal(mcpInstructionFlowPayload.missing_prompt_injected, false);
  assert.equal(mcpInstructionFlowPayload.strict_failure_seen, false);
  assert.equal(mcpInstructionFlowPayload.strict_failure_exit_code, 1);
  assert.equal(mcpInstructionFlowPayload.strict_failure_human_surface, true);
  assert.equal(mcpInstructionFlowPayload.strict_failure_avoids_machine_surface, true);
  logStep("start-smoke-contract start-mcp-instruction-events-flow");
}

export function runRuntimeContextPreSendHeadTrimFlowSmoke() {
  const preSendHeadTrimResult = runContract("start-smoke-contract.mjs", "start-context-pre-send-head-trim-flow", [
    "--repo-root",
    repoRoot,
  ]);
  const preSendHeadTrimPayload = parseJsonOutput(
    "start-smoke-contract start-context-pre-send-head-trim-flow",
    preSendHeadTrimResult.stdout,
  );
  assert.equal(preSendHeadTrimPayload.pre_send_head_trim_seen, true);
  assert.equal(
    Number(preSendHeadTrimPayload.pre_send_head_trim_retries) >= 1,
    true,
  );
  assert.equal(
    Number(preSendHeadTrimPayload.prompt_prepared_pretrim_retries) >= 1,
    true,
  );
  assert.equal(
    Number(preSendHeadTrimPayload.prompt_prepared_recent_trim_rows) >= 0,
    true,
  );
  assert.equal(
    Number(preSendHeadTrimPayload.prompt_prepared_snapshot_trim_sections) >= 0,
    true,
  );
  assert.equal(
    Number(preSendHeadTrimPayload.prompt_prepared_snapshot_semantic_compress_sections) >= 0,
    true,
  );
  assert.equal(
    Number(preSendHeadTrimPayload.pre_send_estimated_tokens)
      > Number(preSendHeadTrimPayload.pre_send_effective_window),
    true,
  );
  assert.equal(
    ["normal", "proactive", "forced", "minimal"].includes(
      String(preSendHeadTrimPayload.pre_send_head_trim_stage),
    ),
    true,
  );
  logStep("start-smoke-contract start-context-pre-send-head-trim-flow");
}

export function runRuntimeContextQualityGuardFlowSmoke() {
  const qualityGuardFlowResult = runContract("start-smoke-contract.mjs", "start-context-quality-guard-flow", [
    "--repo-root",
    repoRoot,
  ]);
  const qualityGuardFlowPayload = parseJsonOutput(
    "start-smoke-contract start-context-quality-guard-flow",
    qualityGuardFlowResult.stdout,
  );
  assert.equal(
    [0, 1].includes(Number(qualityGuardFlowPayload.exit_code)),
    true,
  );
  assert.equal(qualityGuardFlowPayload.quality_guard_seen, true);
  assert.equal(String(qualityGuardFlowPayload.quality_guard_stage), "minimal");
  assert.equal(
    ["overall_below_threshold", "low_quality_rate_above_threshold"].includes(String(qualityGuardFlowPayload.quality_guard_reason)),
    true,
  );
  assert.equal(String(qualityGuardFlowPayload.prompt_prepared_quality_guard), "true");
  logStep("start-smoke-contract start-context-quality-guard-flow");
}

export function runRuntimeContextMemoryDecayAutotuneQualityFlowSmoke() {
  const memoryDecayAutotuneQualityFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-context-memory-decay-autotune-quality-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const memoryDecayAutotuneQualityFlowPayload = parseJsonOutput(
    "start-smoke-contract start-context-memory-decay-autotune-quality-flow",
    memoryDecayAutotuneQualityFlowResult.stdout,
  );
  assert.equal(
    [0, 1].includes(Number(memoryDecayAutotuneQualityFlowPayload.start_exit_code)),
    true,
  );
  assert.equal(
    [0, 1].includes(Number(memoryDecayAutotuneQualityFlowPayload.status_exit_code)),
    true,
  );
  assert.equal(memoryDecayAutotuneQualityFlowPayload.maintenance_quality_signal_logged, true);
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.maintenance_autotune_quality_reason_seen,
    true,
  );
  assert.equal(memoryDecayAutotuneQualityFlowPayload.status_json_parse_ok, true);
  assert.equal(memoryDecayAutotuneQualityFlowPayload.status_memory_orchestrator_present, true);
  assert.equal(memoryDecayAutotuneQualityFlowPayload.status_memory_autotune_present, true);
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_strategy_autotune_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_autotune_quality_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_strategy_autotune_quality_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_strategy_autotune_profile_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_strategy_autotune_pending_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_strategy_autotune_outcome_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_autotune_reason_has_quality_tighten,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_strategy_autotune_reason_has_quality_tighten,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_decay_max_rows_tightened,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_decay_confidence_tightened,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_strategy_budget_ratio_tightened,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_strategy_section_tightened,
    true,
  );
  assert.equal(memoryDecayAutotuneQualityFlowPayload.state_exists, true);
  assert.equal(memoryDecayAutotuneQualityFlowPayload.state_adaptive_updates_increased, true);
  assert.equal(memoryDecayAutotuneQualityFlowPayload.state_quality_ema_present, true);
  assert.equal(memoryDecayAutotuneQualityFlowPayload.state_last_reason_has_quality_tighten, true);
  assert.equal(memoryDecayAutotuneQualityFlowPayload.strategy_state_exists, true);
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.strategy_state_adaptive_updates_increased,
    true,
  );
  assert.equal(memoryDecayAutotuneQualityFlowPayload.strategy_state_quality_ema_present, true);
  assert.equal(memoryDecayAutotuneQualityFlowPayload.strategy_state_profile_fields_present, true);
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.strategy_state_pending_outcome_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.strategy_state_last_reason_has_quality_tighten,
    true,
  );
  logStep("start-smoke-contract start-context-memory-decay-autotune-quality-flow");
}

export function runRuntimeContextMemoryDecayAutotuneRelaxFlowSmoke() {
  const memoryDecayAutotuneQualityRelaxFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-context-memory-decay-autotune-quality-relax-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const memoryDecayAutotuneQualityRelaxFlowPayload = parseJsonOutput(
    "start-smoke-contract start-context-memory-decay-autotune-quality-relax-flow",
    memoryDecayAutotuneQualityRelaxFlowResult.stdout,
  );
  assert.equal(
    [0, 1].includes(Number(memoryDecayAutotuneQualityRelaxFlowPayload.start_exit_code)),
    true,
  );
  assert.equal(
    [0, 1].includes(Number(memoryDecayAutotuneQualityRelaxFlowPayload.status_exit_code)),
    true,
  );
  assert.equal(memoryDecayAutotuneQualityRelaxFlowPayload.maintenance_quality_signal_logged, true);
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.maintenance_autotune_quality_reason_seen,
    true,
  );
  assert.equal(memoryDecayAutotuneQualityRelaxFlowPayload.status_json_parse_ok, true);
  assert.equal(memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_orchestrator_present, true);
  assert.equal(memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_autotune_present, true);
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_strategy_autotune_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_autotune_quality_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_strategy_autotune_quality_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_strategy_autotune_profile_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_strategy_autotune_pending_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_strategy_autotune_outcome_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_autotune_reason_has_quality_relax,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_strategy_autotune_reason_has_quality_relax,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_decay_max_rows_relaxed,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_decay_confidence_relaxed,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_strategy_budget_ratio_relaxed,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_strategy_section_relaxed,
    true,
  );
  assert.equal(memoryDecayAutotuneQualityRelaxFlowPayload.state_exists, true);
  assert.equal(memoryDecayAutotuneQualityRelaxFlowPayload.state_adaptive_updates_increased, true);
  assert.equal(memoryDecayAutotuneQualityRelaxFlowPayload.state_quality_ema_present, true);
  assert.equal(memoryDecayAutotuneQualityRelaxFlowPayload.state_last_reason_has_quality_relax, true);
  assert.equal(memoryDecayAutotuneQualityRelaxFlowPayload.strategy_state_exists, true);
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.strategy_state_adaptive_updates_increased,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.strategy_state_quality_ema_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.strategy_state_profile_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.strategy_state_pending_outcome_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.strategy_state_last_reason_has_quality_relax,
    true,
  );
  logStep("start-smoke-contract start-context-memory-decay-autotune-quality-relax-flow");
}

export function runRuntimeContextMemoryDecayAutotuneHysteresisFlowSmoke() {
  const memoryDecayAutotuneHysteresisFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-context-memory-decay-autotune-hysteresis-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const memoryDecayAutotuneHysteresisFlowPayload = parseJsonOutput(
    "start-smoke-contract start-context-memory-decay-autotune-hysteresis-flow",
    memoryDecayAutotuneHysteresisFlowResult.stdout,
  );
  assert.equal(
    [0, 1].includes(Number(memoryDecayAutotuneHysteresisFlowPayload.first_round_start_exit_code)),
    true,
  );
  assert.equal(
    [0, 1].includes(Number(memoryDecayAutotuneHysteresisFlowPayload.first_round_status_exit_code)),
    true,
  );
  assert.equal(memoryDecayAutotuneHysteresisFlowPayload.first_round_has_quality_tighten, true);
  assert.equal(
    Number(memoryDecayAutotuneHysteresisFlowPayload.low_rounds_executed) >= 1,
    true,
  );
  assert.equal(memoryDecayAutotuneHysteresisFlowPayload.no_early_relax, true);
  assert.equal(memoryDecayAutotuneHysteresisFlowPayload.updates_monotonic, true);
  const hysteresisRelaxSeen = Boolean(memoryDecayAutotuneHysteresisFlowPayload.relax_seen);
  if (hysteresisRelaxSeen) {
    assert.equal(
      Number(memoryDecayAutotuneHysteresisFlowPayload.relax_round_index) >= 2,
      true,
    );
    assert.equal(memoryDecayAutotuneHysteresisFlowPayload.relax_rows_expanded, true);
    assert.equal(memoryDecayAutotuneHysteresisFlowPayload.relax_confidence_relaxed, true);
  } else {
    assert.equal(
      memoryDecayAutotuneHysteresisFlowPayload.final_quality_relax_window_reached,
      true,
    );
  }
  logStep("start-smoke-contract start-context-memory-decay-autotune-hysteresis-flow");
}

export function runRuntimeContextGraphAutotuneFlowSmoke() {
  const graphAutotuneFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-context-graph-quality-autotune-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const graphAutotuneFlowPayload = parseJsonOutput(
    "start-smoke-contract start-context-graph-quality-autotune-flow",
    graphAutotuneFlowResult.stdout,
  );
  assert.equal(
    [0, 1].includes(Number(graphAutotuneFlowPayload.exit_code)),
    true,
  );
  assert.equal(graphAutotuneFlowPayload.graph_autotune_seen, true);
  assert.equal(
    ["upshift", "mixed"].includes(String(graphAutotuneFlowPayload.graph_autotune_action)),
    true,
  );
  assert.equal(
    String(graphAutotuneFlowPayload.graph_autotune_suppressed),
    "none",
  );
  assert.equal(
    Number(graphAutotuneFlowPayload.graph_autotune_dep_rows_to)
      >= Number(graphAutotuneFlowPayload.graph_autotune_dep_rows_from),
    true,
  );
  assert.equal(
    Number(graphAutotuneFlowPayload.graph_autotune_symbol_rows_to)
      >= Number(graphAutotuneFlowPayload.graph_autotune_symbol_rows_from),
    true,
  );
  assert.equal(
    Number(graphAutotuneFlowPayload.graph_autotune_entries) >= 2,
    true,
  );
  assert.equal(
    Number(graphAutotuneFlowPayload.graph_autotune_quality_entries) >= 2,
    true,
  );
  assert.equal(
    ["adaptive_ewma", "state_reuse"].includes(
      String(graphAutotuneFlowPayload.graph_autotune_adaptive_source),
    ),
    true,
  );
  assert.equal(
    ["true", "false"].includes(
      String(graphAutotuneFlowPayload.graph_autotune_adaptive_updated),
    ),
    true,
  );
  assert.equal(Number.isFinite(Number(graphAutotuneFlowPayload.graph_autotune_adaptive_alpha)), true);
  assert.equal(Number.isFinite(Number(graphAutotuneFlowPayload.graph_autotune_adaptive_updates)), true);
  assert.equal(
    Number(graphAutotuneFlowPayload.graph_autotune_adaptive_cache_threshold) > 0,
    true,
  );
  assert.equal(
    Number(graphAutotuneFlowPayload.graph_autotune_adaptive_parsed_max) > 0,
    true,
  );
  assert.equal(
    Number(graphAutotuneFlowPayload.graph_autotune_adaptive_reused_min) >= 0,
    true,
  );
  assert.equal(
    Number(graphAutotuneFlowPayload.graph_autotune_adaptive_removed_max) > 0,
    true,
  );
  assert.equal(
    ["adaptive_action_ewma", "adaptive_action_ewma_guarded", "state_reuse"].includes(
      String(graphAutotuneFlowPayload.graph_autotune_adaptive_action_source),
    ),
    true,
  );
  assert.equal(
    ["true", "false"].includes(
      String(graphAutotuneFlowPayload.graph_autotune_adaptive_action_updated),
    ),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneFlowPayload.graph_autotune_adaptive_action_scale)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneFlowPayload.graph_autotune_adaptive_action_updates)),
    true,
  );
  logStep("start-smoke-contract start-context-graph-quality-autotune-flow");
}

export function runRuntimeContextGraphAutotuneHysteresisFlowSmoke() {
  const graphAutotuneHysteresisFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-context-graph-quality-autotune-hysteresis-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const graphAutotuneHysteresisFlowPayload = parseJsonOutput(
    "start-smoke-contract start-context-graph-quality-autotune-hysteresis-flow",
    graphAutotuneHysteresisFlowResult.stdout,
  );
  assert.equal(
    [0, 1].includes(Number(graphAutotuneHysteresisFlowPayload.exit_code)),
    true,
  );
  assert.equal(graphAutotuneHysteresisFlowPayload.graph_autotune_seen, true);
  assert.equal(
    String(graphAutotuneHysteresisFlowPayload.graph_autotune_action),
    "none",
  );
  assert.equal(
    ["flip_hold", "downshift_warmup"].includes(
      String(graphAutotuneHysteresisFlowPayload.graph_autotune_suppressed),
    ),
    true,
  );
  assert.equal(
    Number(graphAutotuneHysteresisFlowPayload.graph_autotune_dep_rows_to),
    Number(graphAutotuneHysteresisFlowPayload.graph_autotune_dep_rows_from),
  );
  assert.equal(
    Number(graphAutotuneHysteresisFlowPayload.graph_autotune_symbol_rows_to),
    Number(graphAutotuneHysteresisFlowPayload.graph_autotune_symbol_rows_from),
  );
  assert.equal(
    ["adaptive_ewma", "state_reuse"].includes(
      String(graphAutotuneHysteresisFlowPayload.graph_autotune_adaptive_source),
    ),
    true,
  );
  assert.equal(
    ["true", "false"].includes(
      String(graphAutotuneHysteresisFlowPayload.graph_autotune_adaptive_updated),
    ),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneHysteresisFlowPayload.graph_autotune_adaptive_alpha)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneHysteresisFlowPayload.graph_autotune_adaptive_updates)),
    true,
  );
  assert.equal(
    ["adaptive_action_ewma", "adaptive_action_ewma_guarded", "state_reuse"].includes(
      String(graphAutotuneHysteresisFlowPayload.graph_autotune_adaptive_action_source),
    ),
    true,
  );
  assert.equal(
    ["true", "false"].includes(
      String(graphAutotuneHysteresisFlowPayload.graph_autotune_adaptive_action_updated),
    ),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneHysteresisFlowPayload.graph_autotune_adaptive_action_scale)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneHysteresisFlowPayload.graph_autotune_adaptive_action_updates)),
    true,
  );
  logStep("start-smoke-contract start-context-graph-quality-autotune-hysteresis-flow");
}

export function runRuntimeContextGraphAutotuneAdaptiveSequenceFlowSmoke() {
  const graphAutotuneAdaptiveSequenceFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-context-graph-quality-autotune-adaptive-sequence-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const graphAutotuneAdaptiveSequenceFlowPayload = parseJsonOutput(
    "start-smoke-contract start-context-graph-quality-autotune-adaptive-sequence-flow",
    graphAutotuneAdaptiveSequenceFlowResult.stdout,
  );
  assert.equal(
    [0, 1].includes(Number(graphAutotuneAdaptiveSequenceFlowPayload.first_exit_code)),
    true,
  );
  assert.equal(
    [0, 1].includes(Number(graphAutotuneAdaptiveSequenceFlowPayload.second_exit_code)),
    true,
  );
  assert.equal(
    [0, 1].includes(Number(graphAutotuneAdaptiveSequenceFlowPayload.third_exit_code)),
    true,
  );
  assert.equal(
    graphAutotuneAdaptiveSequenceFlowPayload.first_state_present,
    true,
  );
  assert.equal(
    graphAutotuneAdaptiveSequenceFlowPayload.second_state_present,
    true,
  );
  assert.equal(
    graphAutotuneAdaptiveSequenceFlowPayload.third_state_present,
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_updates)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_updates)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.third_state_adaptive_updates)),
    true,
  );
  assert.equal(
    Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_updates)
      > Number(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_updates),
    true,
  );
  assert.equal(
    Number(graphAutotuneAdaptiveSequenceFlowPayload.third_state_adaptive_updates)
      >= Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_updates),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_cache_threshold)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_cache_threshold)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.third_state_adaptive_cache_threshold)),
    true,
  );
  assert.equal(
    Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_cache_threshold)
      < Number(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_cache_threshold),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_alpha)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_alpha)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.third_state_adaptive_alpha)),
    true,
  );
  assert.equal(
    ["adaptive_ewma", "state_reuse"].includes(
      String(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_source),
    ),
    true,
  );
  assert.equal(
    ["adaptive_ewma", "state_reuse"].includes(
      String(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_source),
    ),
    true,
  );
  assert.equal(
    ["adaptive_ewma", "state_reuse"].includes(
      String(graphAutotuneAdaptiveSequenceFlowPayload.third_state_adaptive_source),
    ),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_action_scale)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_action_scale)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.third_state_adaptive_action_scale)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_action_updates)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_action_updates)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.third_state_adaptive_action_updates)),
    true,
  );
  assert.equal(
    Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_action_updates)
      >= Number(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_action_updates),
    true,
  );
  assert.equal(
    Number(graphAutotuneAdaptiveSequenceFlowPayload.third_state_adaptive_action_updates)
      >= Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_action_updates),
    true,
  );
  assert.equal(
    ["adaptive_action_ewma", "adaptive_action_ewma_guarded", "state_reuse", "bootstrap"].includes(
      String(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_action_source),
    ),
    true,
  );
  assert.equal(
    ["adaptive_action_ewma", "adaptive_action_ewma_guarded", "state_reuse", "bootstrap"].includes(
      String(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_action_source),
    ),
    true,
  );
  assert.equal(
    ["adaptive_action_ewma", "adaptive_action_ewma_guarded", "state_reuse", "bootstrap"].includes(
      String(graphAutotuneAdaptiveSequenceFlowPayload.third_state_adaptive_action_source),
    ),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.second_minus_first_action_scale)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.third_minus_second_action_scale)),
    true,
  );
  assert.equal(
    Math.abs(Number(graphAutotuneAdaptiveSequenceFlowPayload.second_minus_first_action_scale)) <= 0.29,
    true,
  );
  assert.equal(
    Math.abs(Number(graphAutotuneAdaptiveSequenceFlowPayload.third_minus_second_action_scale)) <= 0.29,
    true,
  );
  logStep("start-smoke-contract start-context-graph-quality-autotune-adaptive-sequence-flow");
}

export async function runRuntimeContextQualityFlowSmoke() {
  runRuntimeContextMcpInstructionFlowSmoke();
  runRuntimeContextPreSendHeadTrimFlowSmoke();
  runRuntimeContextQualityGuardFlowSmoke();
  runRuntimeContextMemoryDecayAutotuneQualityFlowSmoke();
  runRuntimeContextMemoryDecayAutotuneRelaxFlowSmoke();
  runRuntimeContextMemoryDecayAutotuneHysteresisFlowSmoke();
  runRuntimeContextGraphAutotuneFlowSmoke();
  runRuntimeContextGraphAutotuneHysteresisFlowSmoke();
  runRuntimeContextGraphAutotuneAdaptiveSequenceFlowSmoke();
}
