import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { listRunStartSlashSuggestions } from "../../orchestration/entrypoints/dev-cli/start/run-start-slash-suggestions";

interface UserCommandFixture {
  name: string;
  description: string;
  enabled: boolean;
}

function writeUserCommand(homeDir: string, fixture: UserCommandFixture): void {
  const commandsDir = `${homeDir}/commands`;
  mkdirSync(commandsDir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    `${commandsDir}/${fixture.name}.json`,
    `${JSON.stringify({
      schema_version: 1,
      name: fixture.name,
      description: fixture.description,
      prompt: `执行命令：${fixture.name} {{args}}`,
      enabled: fixture.enabled,
      created_at: now,
      updated_at: now,
    }, undefined, 2)}\n`,
    "utf8",
  );
}

async function main(): Promise<void> {
  const tempRoot = `${process.cwd()}/.tmp-run-start-slash-suggestions-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const homeDir = `${tempRoot}/.grobot`;
  mkdirSync(homeDir, { recursive: true });
  writeUserCommand(homeDir, {
    name: "shipit",
    description: "Publish current branch",
    enabled: true,
  });
  writeUserCommand(homeDir, {
    name: "pause_release",
    description: "Pause deployment pipeline",
    enabled: false,
  });

  const topLevel = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/",
    maxItems: 80,
  });
  const pendingAskTopLevel = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/",
    pendingAskCount: 2,
    maxItems: 80,
  });
  const modelOnly = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/model ",
    maxItems: 80,
  });
  const askOnly = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/ask ",
    maxItems: 80,
  });
  const planOnly = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/plan ",
    maxItems: 80,
  });
  const planOnlyPlanMode = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/plan ",
    planMode: true,
    maxItems: 80,
  });
  const planOnlyPlanModeDraftState = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/plan",
    planMode: true,
    planSuggestionState: {
      activePlanStatus: "draft",
      latestPlanStatus: "draft",
    },
    maxItems: 80,
  });
  const planOnlyPlanModeApprovedState = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/plan",
    planMode: true,
    planSuggestionState: {
      activePlanStatus: "approved",
      latestPlanStatus: "approved",
    },
    maxItems: 80,
  });
  const planOnlyAppliedPendingState = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/plan",
    planSuggestionState: {
      latestPlanStatus: "applied",
      latestVerificationStatus: "pending",
    },
    maxItems: 80,
  });
  const planOnlyNoActiveState = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/plan",
    planSuggestionState: {
      latestVerificationStatus: "passed",
    },
    maxItems: 80,
  });
  const planBenchmarkOnly = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/plan b",
    maxItems: 80,
  });
  const planOpenOnly = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/plan o",
    maxItems: 80,
  });
  const planCheckOnly = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/plan c",
    maxItems: 80,
  });
  const planActionOnly = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/plan a",
    maxItems: 80,
  });
  const planActionDraftState = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/plan a",
    planSuggestionState: {
      activePlanStatus: "draft",
      latestPlanStatus: "draft",
    },
    maxItems: 80,
  });
  const planActionApprovedState = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/plan a",
    planSuggestionState: {
      activePlanStatus: "approved",
      latestPlanStatus: "approved",
    },
    maxItems: 80,
  });
  const planCancelOnly = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/plan ca",
    maxItems: 80,
  });
  const planVerifyOnly = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/plan v",
    maxItems: 80,
  });
  const planStatusOnly = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/plan s",
    maxItems: 80,
  });
  const planDraftCheckSuggestion = planOnlyPlanModeDraftState
    .find((item) => item.command === "/plan check");
  const planApprovedApplySuggestion = planOnlyPlanModeApprovedState
    .find((item) => item.command === "/plan apply [extra]");
  const planAppliedPendingVerifySuggestion = planOnlyAppliedPendingState
    .find((item) => item.command === "/plan verify <pass|fail> [note]");
  const checkpointOnly = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/checkpoint ",
    maxItems: 80,
  });
  const skillCreatorOnly = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/skill-creator ",
    maxItems: 80,
  });
  const shipOnly = listRunStartSlashSuggestions({
    homeDir,
    userInput: "/ship",
    maxItems: 80,
  });
  const plainInput = listRunStartSlashSuggestions({
    homeDir,
    userInput: "hello world",
    maxItems: 80,
  });

  const payload = {
    root_has_builtin_model: topLevel.some((item) => item.command === "/model" && item.source === "builtin"),
    root_has_builtin_commands: topLevel.some((item) => item.command === "/commands" && item.source === "builtin"),
    root_has_builtin_resume: topLevel.some((item) => item.command === "/resume" && item.source === "builtin"),
    root_has_builtin_rewind: topLevel.some((item) => item.command === "/rewind" && item.source === "builtin"),
    root_has_builtin_skill_creator: topLevel.some(
      (item) => item.command === "/skill-creator" && item.source === "builtin",
    ),
    root_has_builtin_ask: topLevel.some((item) => item.command.startsWith("/ask") && item.source === "builtin"),
    root_hides_status_subcommands: !topLevel.some((item) => item.command.startsWith("/status ")),
    root_hides_switch_continue_shortcuts: !topLevel.some((item) =>
      item.command === "/switch" || item.command === "/continue"),
    root_hides_utility_commands: !topLevel.some((item) =>
      item.command === "/health"
      || item.command === "/skills"
      || item.command === "/mcp"
      || item.command === "/handoff"
      || item.command === "/interrupt"),
    root_hides_plan_subcommands: !topLevel.some((item) => item.command.startsWith("/plan ")),
    root_has_user_shipit: topLevel.some((item) => item.command === "/shipit" && item.source === "user"),
    root_disabled_marked: topLevel.some(
      (item) => item.command === "/pause_release" && item.description.includes("disabled"),
    ),
    pending_root_ask_first: pendingAskTopLevel[0]?.command === "/ask",
    pending_root_ask_only: pendingAskTopLevel.every((item) => !item.command.startsWith("/ask")),
    model_filter_only_model_related: modelOnly.every((item) => item.command.startsWith("/model")),
    ask_filter_only_ask_related: askOnly.length === 0,
    ask_filter_single_command: askOnly.length === 0,
    plan_filter_only_plan_related: planOnly.every((item) => item.command.startsWith("/plan")),
    plan_filter_has_plan_root: planOnly.some((item) => item.command === "/plan"),
    plan_filter_has_plan_goal_hint: planOnly.some((item) => item.command === "/plan <goal>"),
    plan_filter_has_plan_check_hint:
      planOnly.some((item) => item.command === "/plan check"),
    plan_filter_has_plan_benchmark_hint:
      planOnly.some((item) => item.command === "/plan benchmark <label=path>"),
    plan_filter_has_plan_benchmark_preset_hint:
      planOnly.some((item) => item.command === "/plan benchmark --preset core"),
    plan_filter_omits_benchmark_hint:
      !planOnly.some((item) => item.command === "/plan benchmark <label=path>"),
    plan_filter_omits_benchmark_preset_hint:
      !planOnly.some((item) => item.command === "/plan benchmark --preset core"),
    plan_filter_surface_size_ok: planOnly.length >= 2 && planOnly.length <= 3,
    plan_mode_filter_has_status_hint:
      planOnlyPlanMode.some((item) => item.command === "/plan status"),
    plan_mode_filter_has_check_hint:
      planOnlyPlanMode.some((item) => item.command === "/plan check"),
    plan_mode_filter_has_approve_hint:
      planOnlyPlanMode.some((item) => item.command === "/plan approve [note]"),
    plan_mode_filter_has_verify_hint:
      planOnlyPlanMode.some((item) => item.command === "/plan verify <pass|fail> [note]"),
    plan_mode_filter_has_apply_hint:
      planOnlyPlanMode.some((item) => item.command === "/plan apply [extra]"),
    plan_mode_filter_has_cancel_hint:
      planOnlyPlanMode.some((item) => item.command === "/plan cancel"),
    plan_mode_filter_omits_plan_root:
      !planOnlyPlanMode.some((item) => item.command === "/plan"),
    plan_mode_filter_omits_goal_hint:
      !planOnlyPlanMode.some((item) => item.command === "/plan <goal>"),
    plan_mode_filter_only_plan_related:
      planOnlyPlanMode.every((item) => item.command.startsWith("/plan")),
    plan_state_draft_prioritizes_check_first:
      planOnlyPlanModeDraftState[0]?.command === "/plan check",
    plan_state_draft_has_approve_hint:
      planOnlyPlanModeDraftState.some((item) => item.command === "/plan approve [note]"),
    plan_state_draft_has_reject_hint:
      planOnlyPlanModeDraftState.some((item) => item.command === "/plan reject [reason]"),
    plan_state_approved_prioritizes_apply_first:
      planOnlyPlanModeApprovedState[0]?.command === "/plan apply [extra]",
    plan_state_approved_has_status_hint:
      planOnlyPlanModeApprovedState.some((item) => item.command === "/plan status"),
    plan_state_applied_pending_prioritizes_verify_first:
      planOnlyAppliedPendingState[0]?.command === "/plan verify <pass|fail> [note]",
    plan_state_applied_pending_has_status_hint:
      planOnlyAppliedPendingState.some((item) => item.command === "/plan status"),
    plan_state_no_active_prioritizes_goal_first:
      planOnlyNoActiveState[0]?.command === "/plan <goal>",
    plan_state_draft_check_description_has_status_tag:
      planDraftCheckSuggestion?.description.includes("status=draft") ?? false,
    plan_state_draft_check_description_has_recommended_reason:
      planDraftCheckSuggestion?.description.includes("Recommended now:") ?? false,
    plan_state_approved_apply_description_has_status_tag:
      planApprovedApplySuggestion?.description.includes("status=approved") ?? false,
    plan_state_approved_apply_description_has_recommended_reason:
      planApprovedApplySuggestion?.description.includes("Recommended now:") ?? false,
    plan_state_applied_pending_verify_description_has_pending_tag:
      planAppliedPendingVerifySuggestion?.description.includes("verification=pending") ?? false,
    plan_state_applied_pending_verify_description_has_recommended_reason:
      planAppliedPendingVerifySuggestion?.description.includes("Recommended now:") ?? false,
    plan_benchmark_filter_only_plan_related:
      planBenchmarkOnly.every((item) => item.command.startsWith("/plan")),
    plan_benchmark_filter_has_plan_benchmark_hint:
      planBenchmarkOnly.some((item) => item.command === "/plan benchmark <label=path>"),
    plan_benchmark_filter_has_plan_benchmark_preset_hint:
      planBenchmarkOnly.some((item) => item.command === "/plan benchmark --preset core"),
    plan_benchmark_filter_surface_size_ok:
      planBenchmarkOnly.length >= 2 && planBenchmarkOnly.length <= 5,
    plan_open_filter_has_plan_open_alias: planOpenOnly.some((item) => item.command === "/plan open"),
    plan_open_filter_only_plan_related: planOpenOnly.every((item) => item.command.startsWith("/plan")),
    plan_check_filter_has_plan_check_hint: planCheckOnly.some((item) => item.command === "/plan check"),
    plan_check_filter_has_plan_check_core_hint:
      planCheckOnly.some((item) => item.command === "/plan check core"),
    plan_check_filter_has_plan_check_generic_hint:
      planCheckOnly.some((item) => item.command === "/plan check generic"),
    plan_check_filter_first_is_plan_check: planCheckOnly[0]?.command === "/plan check",
    plan_check_filter_core_after_check:
      planCheckOnly.findIndex((item) => item.command === "/plan check core")
      > planCheckOnly.findIndex((item) => item.command === "/plan check"),
    plan_check_filter_generic_after_core:
      planCheckOnly.findIndex((item) => item.command === "/plan check generic")
      > planCheckOnly.findIndex((item) => item.command === "/plan check core"),
    plan_check_filter_narrowed_surface: planCheckOnly.length >= 3 && planCheckOnly.length <= 4,
    plan_check_filter_only_plan_related: planCheckOnly.every((item) => item.command.startsWith("/plan")),
    plan_action_filter_has_approve_hint:
      planActionOnly.some((item) => item.command === "/plan approve [note]"),
    plan_action_filter_has_apply_hint:
      planActionOnly.some((item) => item.command === "/plan apply [extra]"),
    plan_action_filter_only_plan_related:
      planActionOnly.every((item) => item.command.startsWith("/plan")),
    plan_action_filter_draft_prioritizes_approve_first:
      planActionDraftState[0]?.command === "/plan approve [note]",
    plan_action_filter_approved_prioritizes_apply_first:
      planActionApprovedState[0]?.command === "/plan apply [extra]",
    plan_cancel_filter_has_cancel_hint:
      planCancelOnly.some((item) => item.command === "/plan cancel"),
    plan_cancel_filter_only_cancel_or_plan:
      planCancelOnly.every((item) => item.command === "/plan cancel" || item.command === "/plan"),
    plan_verify_filter_has_verify_hint:
      planVerifyOnly.some((item) => item.command === "/plan verify <pass|fail> [note]"),
    plan_verify_filter_only_plan_related:
      planVerifyOnly.every((item) => item.command.startsWith("/plan")),
    plan_status_filter_has_status_hint:
      planStatusOnly.some((item) => item.command === "/plan status"),
    plan_status_filter_only_plan_related:
      planStatusOnly.every((item) => item.command.startsWith("/plan")),
    checkpoint_filter_hits_checkpoint_alias: checkpointOnly.some((item) =>
      item.command === "/checkpoint" && item.source === "builtin"),
    checkpoint_filter_only_checkpoint_related: checkpointOnly.every((item) =>
      item.command.startsWith("/checkpoint")),
    skill_creator_filter_only_skill_creator: skillCreatorOnly.every((item) =>
      item.command.startsWith("/skill-creator")),
    ship_filter_only_shipit: shipOnly.length === 1 && shipOnly[0]?.command === "/shipit",
    plain_input_empty: plainInput.length === 0,
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
  rmSync(tempRoot, { recursive: true, force: true });
}

void main();
