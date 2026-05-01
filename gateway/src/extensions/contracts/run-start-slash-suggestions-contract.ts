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

  try {
    const topLevel = listRunStartSlashSuggestions({
      homeDir,
      userInput: "/",
      maxItems: 80,
    });
    const topLevelDefaultLimit = listRunStartSlashSuggestions({
      homeDir,
      userInput: "/",
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
    const planOpenOnly = listRunStartSlashSuggestions({
      homeDir,
      userInput: "/plan o",
      maxItems: 80,
    });
    const planAppliedPending = listRunStartSlashSuggestions({
      homeDir,
      userInput: "/plan ",
      planSuggestionState: {
        latestPlanStatus: "applied",
        latestVerificationStatus: "pending",
      },
      maxItems: 80,
    });
    const planReadyExecute = listRunStartSlashSuggestions({
      homeDir,
      userInput: "/plan ",
      planMode: true,
      planSuggestionState: {
        activePlanStatus: "ready",
        activePlanPhase: "awaiting_decision",
        activePlanStatusSource: "live_snapshot",
        activePlanDecisionReady: true,
        activePlanRecommendationCommand: "Implement the plan.",
        activePlanRecommendationReason: "当前计划已进入待决策态；直接回复“开始实现计划”或选择确认项即可开始执行",
      },
      maxItems: 80,
    });
    const planCriticalGuard = listRunStartSlashSuggestions({
      homeDir,
      userInput: "/plan ",
      planMode: true,
      planSuggestionState: {
        activePlanStatus: "blocked",
        activePlanPhase: "drafting",
        activePlanQualityGuardLevel: "critical",
        activePlanQualityGuardReason: "质量分仅 42，低于安全阈值 55",
      },
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
      root_model_visible_in_first_page:
        topLevel.findIndex((item) => item.command === "/model") >= 0
        && topLevel.findIndex((item) => item.command === "/model") < 8,
      root_default_limit_keeps_model:
        topLevelDefaultLimit.some((item) => item.command === "/model"),
      root_default_limit_size_ok:
        topLevelDefaultLimit.length === 8,
      root_has_builtin_commands: topLevel.some((item) => item.command === "/commands" && item.source === "builtin"),
      root_has_builtin_resume: topLevel.some((item) => item.command === "/resume" && item.source === "builtin"),
      root_has_builtin_rewind: topLevel.some((item) => item.command === "/rewind" && item.source === "builtin"),
      root_has_builtin_skill_creator: topLevel.some(
        (item) => item.command === "/skill-creator" && item.source === "builtin",
      ),
      root_has_builtin_init: topLevel.some((item) => item.command === "/init" && item.source === "builtin"),
      root_has_builtin_context: topLevel.some((item) => item.command === "/context" && item.source === "builtin"),
      root_has_builtin_memory: topLevel.some((item) => item.command === "/memory" && item.source === "builtin"),
      root_has_user_shipit: topLevel.some((item) => item.command === "/shipit" && item.source === "user"),
      root_disabled_marked: topLevel.some(
        (item) => item.command === "/pause_release" && item.description.includes("已停用"),
      ),
      root_hides_status_subcommands: !topLevel.some((item) => item.command.startsWith("/status ")),
      root_hides_plan_subcommands: !topLevel.some((item) => item.command.startsWith("/plan ")),
      root_hides_removed_ask_surface: !topLevel.some((item) => item.command.startsWith("/ask")),
      pending_root_hides_removed_ask_surface: !pendingAskTopLevel.some((item) => item.command.startsWith("/ask")),
      pending_root_keeps_builtin_shape: pendingAskTopLevel.some((item) => item.command === "/help"),
      model_filter_only_model_related: modelOnly.every((item) => item.command.startsWith("/model")),
      ask_filter_empty: askOnly.length === 0,
      plan_filter_only_plan_related: planOnly.every((item) => item.command.startsWith("/plan")),
      plan_filter_has_plan_root: planOnly.some((item) => item.command === "/plan"),
      plan_filter_has_plan_goal: planOnly.some((item) => item.command === "/plan <goal>"),
      plan_filter_has_plan_open: planOnly.some((item) => item.command === "/plan open"),
      plan_filter_surface_is_current_only: planOnly.every((item) =>
        item.command === "/plan" || item.command === "/plan <goal>" || item.command === "/plan open"),
      plan_filter_surface_size_ok: planOnly.length >= 2 && planOnly.length <= 3,
      plan_filter_has_recommendation_text: planOnly.some((item) => item.description.includes("建议: ")),
      plan_filter_hides_machine_recommendation_label:
        planOnly.every((item) => !item.description.includes("Recommended now: ")),
      plan_mode_filter_hides_plan_root: !planOnlyPlanMode.some((item) => item.command === "/plan"),
      plan_mode_filter_hides_goal: !planOnlyPlanMode.some((item) => item.command === "/plan <goal>"),
      plan_mode_filter_keeps_open: planOnlyPlanMode.some((item) => item.command === "/plan open"),
      plan_mode_filter_surface_is_current_only: planOnlyPlanMode.every((item) =>
        item.command === "/plan open"),
      plan_open_filter_only_open: planOpenOnly.every((item) => item.command === "/plan open"),
      plan_open_filter_has_open_first: planOpenOnly[0]?.command === "/plan open",
      plan_applied_pending_has_state_tag: planAppliedPending.some((item) =>
        item.description.includes("最近计划: 已执行 · 验证待记录")),
      plan_applied_pending_hides_machine_state_tag: planAppliedPending.every((item) =>
        !item.description.includes("latest=")
        && !item.description.includes("status=")
        && !item.description.includes("verification=")),
      plan_ready_execute_attaches_direct_reply_hint: planReadyExecute.some((item) =>
        item.description.includes("开始实现计划")),
      plan_ready_execute_hides_machine_recommendation_label: planReadyExecute.every((item) =>
        !item.description.includes("Recommended now: ")),
      plan_ready_execute_keeps_minimal_surface: planReadyExecute.every((item) =>
        item.command === "/plan open"),
      plan_critical_guard_reason_is_human: planCriticalGuard.some((item) =>
        item.description.includes("计划质量门禁已阻止执行")),
      plan_critical_guard_hides_machine_reason: planCriticalGuard.every((item) =>
        !item.description.includes("quality guard=critical")),
      ship_filter_has_user_command: shipOnly.some((item) => item.command === "/shipit" && item.source === "user"),
      plain_input_returns_empty: plainInput.length === 0,
    };

    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

void main();
