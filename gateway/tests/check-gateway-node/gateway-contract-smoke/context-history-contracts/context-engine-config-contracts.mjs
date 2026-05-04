import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  logStep,
  makeTempDir,
  parseJsonOutput,
  runTsContract,
} from "../../harness.mjs";

export function runContextEngineConfigContracts() {
  const contextEngineTomlDir = makeTempDir("context-engine-contract");
  const contextEngineTomlPath = resolve(contextEngineTomlDir, "project.toml");
  writeFileSync(contextEngineTomlPath, [
    "[context_engine]",
    "enabled = true",
    "profile = \"aggressive\"",
    "context_window_tokens = 64000",
    "reserved_output_tokens = 9000",
    "safety_margin_tokens = 1800",
    "auto_compact_token_limit = 50000",
    "proactive_ratio = 0.82",
    "forced_ratio = 0.89",
    "hard_ratio = 0.95",
    "reactive_max_retries = 2",
    "ptl_max_retries = 4",
    "circuit_breaker_failures = 5",
    "reactive_on_prompt_too_long = true",
    "lineage_enabled = false",
    "lineage_max_rows = 2",
    "workspace_signals_enabled = false",
    "workspace_signals_max_rows = 2",
    "dependency_graph_enabled = false",
    "dependency_graph_max_rows = 2",
    "symbol_graph_enabled = false",
    "symbol_graph_max_rows = 2",
    "semantic_prefetch_enabled = true",
    "semantic_prefetch_timeout_ms = 4200",
    "semantic_prefetch_max_evidence = 9",
    "prompt_quality_low_quality_threshold = 0.58",
    "prompt_quality_degrade_overall_threshold = 0.61",
    "prompt_quality_degrade_low_quality_rate_threshold = 0.35",
    "prompt_quality_degrade_min_entries = 6",
    "prompt_quality_guard_enabled = true",
    "prompt_quality_guard_adaptive_enabled = false",
    "prompt_quality_guard_adaptive_mode_allowlist = [\"harden\"]",
    "prompt_quality_guard_promote_streak = 2",
    "prompt_quality_guard_severe_promote_streak = 3",
    "prompt_quality_guard_release_streak = 4",
    "prompt_quality_guard_hold_turns = 3",
    "prompt_quality_guard_max_floor_stage = \"forced\"",
    "prompt_quality_guard_severe_overall_threshold = 0.42",
    "prompt_quality_guard_severe_low_quality_rate_threshold = 0.77",
  ].join("\n"), "utf8");
  const contextEngineResolveConfigResult = runTsContract("context-engine-contract.ts", "resolve-config", [
    "--payload",
    JSON.stringify({
      project_toml_path: contextEngineTomlPath,
      runtime_model_config: {
        providerKind: "openai_compatible",
      },
    }),
  ]);
  const contextEngineResolveConfigPayload = parseJsonOutput(
    "context-engine-contract resolve-config",
    contextEngineResolveConfigResult.stdout,
  );
  assert.equal(contextEngineResolveConfigPayload.enabled, true);
  assert.equal(contextEngineResolveConfigPayload.profile, "aggressive");
  assert.equal(contextEngineResolveConfigPayload.context_window_tokens, 64000);
  assert.equal(contextEngineResolveConfigPayload.reserved_output_tokens, 9000);
  assert.equal(contextEngineResolveConfigPayload.safety_margin_tokens, 1800);
  assert.equal(contextEngineResolveConfigPayload.auto_compact_token_limit, 50000);
  assert.equal(contextEngineResolveConfigPayload.target_token_limit, 50000);
  assert.equal(contextEngineResolveConfigPayload.effective_window_tokens, 53200);
  assert.equal(contextEngineResolveConfigPayload.proactive_ratio, 0.82);
  assert.equal(contextEngineResolveConfigPayload.forced_ratio, 0.89);
  assert.equal(contextEngineResolveConfigPayload.hard_ratio, 0.95);
  assert.equal(contextEngineResolveConfigPayload.reactive_max_retries, 2);
  assert.equal(contextEngineResolveConfigPayload.ptl_max_retries, 4);
  assert.equal(contextEngineResolveConfigPayload.circuit_breaker_failures, 5);
  assert.equal(contextEngineResolveConfigPayload.reactive_on_prompt_too_long, true);
  assert.equal(contextEngineResolveConfigPayload.lineage?.enabled, false);
  assert.equal(contextEngineResolveConfigPayload.workspace_signals?.enabled, false);
  assert.equal(contextEngineResolveConfigPayload.dependency_graph?.enabled, false);
  assert.equal(contextEngineResolveConfigPayload.symbol_graph?.enabled, false);
  assert.equal(contextEngineResolveConfigPayload.semantic_prefetch?.enabled, true);
  assert.equal(contextEngineResolveConfigPayload.semantic_prefetch?.timeoutMs, 4200);
  assert.equal(contextEngineResolveConfigPayload.semantic_prefetch?.maxEvidence, 9);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.lowQualityThreshold, 0.58);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.degradeOverallThreshold, 0.61);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.degradeLowQualityRateThreshold, 0.35);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.degradeMinEntries, 6);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.guardEnabled, true);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.guardAdaptiveEnabled, false);
  assert.deepEqual(contextEngineResolveConfigPayload.prompt_quality?.guardAdaptiveModeAllowlist, ["harden"]);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.guardPromoteStreak, 2);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.guardSeverePromoteStreak, 3);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.guardReleaseStreak, 4);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.guardHoldTurns, 3);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.guardMaxFloorStage, "forced");
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.guardSevereOverallThreshold, 0.42);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.guardSevereLowQualityRateThreshold, 0.77);
  logStep("context-engine-contract resolve-config");
}
