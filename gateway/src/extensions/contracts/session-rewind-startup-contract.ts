import {
  resolveStartupRewindTarget,
  type StartupRewindCheckpointSummary,
} from "../../orchestration/entrypoints/dev-cli/start/session-rewind-startup";
import {
  resolveRewindMode,
  resolveRewindRequested,
  resolveRewindSelector,
} from "../../orchestration/entrypoints/dev-cli/start/session-options";

const CHECKPOINT_FIXTURE: readonly StartupRewindCheckpointSummary[] = [
  {
    checkpointId: "latest",
    createdAt: "2026-04-24T10:00:00.000Z",
    userText: "latest question",
    assistantText: "latest answer",
    historyBeforeCount: 10,
    historyAfterCount: 12,
    changedFilesCount: 2,
  },
  {
    checkpointId: "legacy-a",
    createdAt: "2026-04-24T09:50:00.000Z",
    userText: "legacy alpha",
    assistantText: "assistant alpha",
    historyBeforeCount: 8,
    historyAfterCount: 10,
    changedFilesCount: 1,
  },
  {
    checkpointId: "legacy-b",
    createdAt: "2026-04-24T09:40:00.000Z",
    userText: "legacy beta",
    assistantText: "assistant beta",
    historyBeforeCount: 6,
    historyAfterCount: 8,
    changedFilesCount: 3,
  },
];

function check(label: string, condition: boolean): [string, boolean] {
  return [label, condition];
}

function assertAll(checks: ReadonlyArray<[string, boolean]>): void {
  const failed = checks.filter(([, passed]) => !passed);
  const payload = Object.fromEntries(checks);
  console.log(JSON.stringify(payload));
  if (failed.length > 0) {
    const labels = failed.map(([label]) => label).join(", ");
    throw new Error(`session-rewind-startup-contract failed: ${labels}`);
  }
}

function run(): void {
  const noIntent = resolveStartupRewindTarget({
    rewindRequested: false,
    checkpoints: CHECKPOINT_FIXTURE,
  });
  const rewindDefault = resolveStartupRewindTarget({
    rewindRequested: true,
    checkpoints: CHECKPOINT_FIXTURE,
  });
  const rewindExactId = resolveStartupRewindTarget({
    rewindRequested: true,
    rewindQuery: "legacy-b",
    checkpoints: CHECKPOINT_FIXTURE,
  });
  const rewindSingleMatch = resolveStartupRewindTarget({
    rewindRequested: true,
    rewindQuery: "latest question",
    checkpoints: CHECKPOINT_FIXTURE,
  });
  const rewindMultipleMatches = resolveStartupRewindTarget({
    rewindRequested: true,
    rewindQuery: "legacy",
    checkpoints: CHECKPOINT_FIXTURE,
  });
  const rewindNoMatchFallback = resolveStartupRewindTarget({
    rewindRequested: true,
    rewindQuery: "missing-query",
    checkpoints: CHECKPOINT_FIXTURE,
  });
  const rewindNoMatchNoFallback = resolveStartupRewindTarget({
    rewindRequested: true,
    rewindQuery: "missing-query",
    checkpoints: [],
  });
  const rewindStrictExact = resolveStartupRewindTarget({
    rewindRequested: true,
    rewindQuery: "legacy-a",
    rewindQueryStrict: true,
    checkpoints: CHECKPOINT_FIXTURE,
  });
  const rewindStrictNoMatch = resolveStartupRewindTarget({
    rewindRequested: true,
    rewindQuery: "missing-query",
    rewindQueryStrict: true,
    checkpoints: CHECKPOINT_FIXTURE,
  });
  const rewindRequestedWithFalseLiteral = resolveRewindRequested({
    rewind: "false",
  });
  const rewindSelectorWithFalseLiteral = resolveRewindSelector({
    rewind: "false",
  });
  const rewindModeDefault = resolveRewindMode({});
  const rewindModeFromFiles = resolveRewindMode({
    "rewind-files": "src/a.ts",
  });
  const rewindModeConversation = resolveRewindMode({
    "rewind-mode": "conversation",
  });
  const rewindModeSummarize = resolveRewindMode({
    "rewind-mode": "summary",
  });
  const rewindModeInvalidFallback = resolveRewindMode({
    "rewind-mode": "invalid-mode",
  });

  assertAll([
    check("no_intent_skips_rewind_target", typeof noIntent.targetCheckpointId === "undefined"),
    check("no_intent_skips_notice", typeof noIntent.notice === "undefined"),
    check("rewind_default_targets_latest", rewindDefault.targetCheckpointId === "latest"),
    check("rewind_exact_id_targeted", rewindExactId.targetCheckpointId === "legacy-b"),
    check("rewind_single_query_match_targeted", rewindSingleMatch.targetCheckpointId === "latest"),
    check("rewind_multiple_query_auto_selects_top", rewindMultipleMatches.targetCheckpointId === "legacy-a"),
    check("rewind_multiple_query_requires_disambiguation", rewindMultipleMatches.requiresDisambiguation === true),
    check(
      "rewind_multiple_query_candidates_exposed",
      (rewindMultipleMatches.disambiguationCandidates ?? []).length === 2,
    ),
    check(
      "rewind_multiple_query_notice_contains_tip",
      (rewindMultipleMatches.notice ?? "").includes("deterministic startup rewind"),
    ),
    check(
      "rewind_multiple_query_notice_no_autoselect_literal",
      !(rewindMultipleMatches.notice ?? "").includes("auto-selecting"),
    ),
    check("rewind_no_match_fallback_targets_latest", rewindNoMatchFallback.targetCheckpointId === "latest"),
    check(
      "rewind_no_match_fallback_has_notice",
      (rewindNoMatchFallback.notice ?? "").includes("fallback to latest checkpoint"),
    ),
    check(
      "rewind_no_match_without_fallback_has_notice",
      (rewindNoMatchNoFallback.notice ?? "").includes("no checkpoints found"),
    ),
    check("rewind_strict_exact_targeted", rewindStrictExact.targetCheckpointId === "legacy-a"),
    check("rewind_strict_no_match_skips_target", typeof rewindStrictNoMatch.targetCheckpointId === "undefined"),
    check(
      "rewind_strict_no_match_has_skip_notice",
      (rewindStrictNoMatch.notice ?? "").includes("skipping rewind"),
    ),
    check("rewind_requested_accepts_false_literal_as_query", rewindRequestedWithFalseLiteral === true),
    check("rewind_selector_keeps_false_literal", rewindSelectorWithFalseLiteral === "false"),
    check("rewind_mode_default_is_both", rewindModeDefault === "both"),
    check("rewind_mode_rewind_files_defaults_code", rewindModeFromFiles === "code"),
    check("rewind_mode_explicit_conversation", rewindModeConversation === "conversation"),
    check("rewind_mode_summary_alias_maps_summarize", rewindModeSummarize === "summarize"),
    check("rewind_mode_invalid_falls_back_both", rewindModeInvalidFallback === "both"),
  ]);
}

run();
