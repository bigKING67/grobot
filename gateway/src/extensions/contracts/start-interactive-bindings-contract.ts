import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import {
  createRunStartInteractiveModeInput,
} from "../../cli/start/interactive-bindings";
import { createRunStartInteractiveHandler } from "../../cli/start/interactive-handler";
import { shouldSuppressRunStartSubmitTranscript } from "../../cli/start/interactive-mode";
import { type ChatHistoryMessage } from "../../cli/start/session/history";
import { createGaMechanismRuntime } from "../../cli/services/ga-mechanism-runtime";
import { normalizeAskUserEnvelopeFromPayload } from "../../tools/ask-user";
import { type SessionProviderRuntimeState } from "../../cli/start/session-registry";
import { type SessionStoreRuntime } from "../../cli/services/session-store";
import { type RunStartModelOps } from "../../cli/start/model-ops";
import { type RunStartPlanMode } from "../../cli/start/plan-mode";
import { type RunStartSessionMenuOps } from "../../cli/start/session/menu-ops";
import { createPlanArtifact } from "../../cli/start/plan-artifact";
import { listRunStartSlashSuggestions } from "../../cli/start/slash-suggestions";
import { resolveContextEngineConfig } from "../../tools/context";
import { createMemoryOrchestrator } from "../../tools/memory";
import {
  buildAskUserQueueContinuationHint,
  type RuntimeFailoverConfig,
  type RuntimeProviderCandidate,
} from "../../cli/start/turn";
import { type RunStartWire } from "../../cli/start/wire";
import {
  type TerminalSelectMenuInput,
  type TerminalSelectMenuResult,
} from "../../cli/tui/components/select-menu/contract";
import {
  createRuntimeStateMock,
  withStdinTty,
} from "./start-interactive-bindings-contract/test-harness";

async function main(): Promise<void> {
  const tempWorkDir = `${process.cwd()}/.tmp-start-interactive-bindings-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  mkdirSync(tempWorkDir, { recursive: true });
  const tempHomeDir = `${tempWorkDir}/home`;
  const tempProjectRoot = `${tempWorkDir}/project`;
  mkdirSync(`${tempHomeDir}/skills/global-demo`, { recursive: true });
  mkdirSync(`${tempProjectRoot}/.grobot/skills/project-demo`, { recursive: true });
  writeFileSync(`${tempHomeDir}/skills/global-demo/SKILL.md`, "# Global demo\n", "utf8");
  writeFileSync(`${tempProjectRoot}/.grobot/skills/project-demo/SKILL.md`, "# Project demo\n", "utf8");
  const stdoutChunks: string[] = [];
  const capturedSelectMenuHints: string[] = [];
  const historyMessages: ChatHistoryMessage[] = [
    { role: "user", content: "first" },
    { role: "assistant", content: "second" },
  ];
  const providerStates: SessionProviderRuntimeState[] = [
    {
      provider_name: "alpha",
      consecutive_failures: 0,
      circuit_open_until_ms: 0,
      ewma_latency_ms: 123.4,
      ewma_error_rate: 0.02,
    },
  ];
  const runtimeState = createRuntimeStateMock({
    sessionKey: "feishu:grobot:dm:interactive-binding-contract",
    activeSessionId: "main",
    historyMessages,
    stickyProvider: "alpha",
    providerRuntimeStates: providerStates,
  });
  const runtimeProviderChain: RuntimeProviderCandidate[] = [
    {
      name: "alpha",
      source: "contract",
      modelConfig: { model: "alpha-model" },
      maxInFlight: 3,
      requestsPerMinute: 60,
      burst: 60,
    },
  ];
  const runtimeFailoverConfig: RuntimeFailoverConfig = {
    circuitFailures: 2,
    circuitCooldownSecs: 30,
    stickyMode: "session_key",
  };
  const sessionStoreRuntime: SessionStoreRuntime = {
    backend: "file",
    requestedBackend: "file",
    source: "contract",
  };

  let applyModelOverrideCount = 0;
  const modelOps: RunStartModelOps = {
    getCurrentModelSnapshot: () => ({
      providerName: "alpha",
      model: "alpha-model",
      source: "contract:model",
    }),
    getCachedModelContextWindowTokens: () => undefined,
    refreshModelCatalogCache: async () => undefined,
    showModelCurrent: async () => undefined,
    listModels: async () => undefined,
    useModel: async () => undefined,
    resetModel: async () => undefined,
    openModelMenu: async () => undefined,
    applyModelOverrideForSession: () => undefined,
    applyModelOverrideForActiveSession: () => {
      applyModelOverrideCount += 1;
    },
  };
  const sessionMenuOps: RunStartSessionMenuOps = {
    openSessionMenu: async () => undefined,
  };
  let planModeActive = false;
  let activePlanPathForEditor: string | undefined;
  const planMode: RunStartPlanMode = {
    isPlanMode: () => planModeActive,
    getActivePlanPath: () => activePlanPathForEditor,
    enterPlan: async () => 0,
    showPlanStatus: async () => 0,
    runPlanTurn: async () => 0,
    applyPlan: async () => 0,
    cancelPlan: async () => 0,
    requestPlanInterrupt: async () => ({
      code: "PLAN_INTERRUPT_NOT_RUNNING",
      accepted: false,
      phase: "idle",
    }),
    handleMessageInput: async () => ({ handled: false, code: 0 }),
  };

  let switchResult = true;
  const switchEvents: string[] = [];
  const turnInputs: string[] = [];
  const gaMechanismRuntime = createGaMechanismRuntime();
  const memoryOrchestrator = createMemoryOrchestrator({
    ga: {
      listMemory: () => [],
      listSkillCards: () => [],
      registerTurnSuccess: () => undefined,
      registerTurnFailure: () => undefined,
      writeMemory: () => ({ ok: true, code: "contract" }),
    },
    experience: {
      getTeamDefault: () => "default",
      buildRecallPrompt: () => ({ prompt: "", matched: 0, candidates: 0 }),
      searchRecords: () => [],
      registerTurnSuccess: () => ({
        skipped: true,
        reason: "contract",
        verificationPassed: true,
        evidenceRefPassed: true,
        redactionPassed: true,
      }),
      registerTurnFailure: () => ({ matched: false }),
    },
    workDir: tempWorkDir,
  });
  let handoffReason = "";
  let handoffToStderr = true;
  let autoExitToStderr = true;
  const wire: RunStartWire = {
    handoff: {
      writeHandoff: (reason, toStderr) => {
        handoffReason = reason;
        handoffToStderr = toStderr;
      },
      writeAutoExitHandoffIfNeeded: (toStderr) => {
        autoExitToStderr = toStderr;
      },
    },
    sessionOps: {
      listSessions: () => [],
      printSessionOverview: () => undefined,
      createNewSession: async () => "new-session-id",
      switchActiveSession: async (targetSessionId, reason) => {
        switchEvents.push(`${targetSessionId}:${reason}`);
        return switchResult;
      },
      continueFromSession: async () => undefined,
      resumeFromSession: async () => false,
      forkFromSession: async () => false,
      listRewindCheckpoints: () => [],
      rewindSession: async () => false,
    },
    executeTurn: async (userInput) => {
      turnInputs.push(userInput);
      return 0;
    },
  };

  const interactiveModeInput = createRunStartInteractiveModeInput({
    homeDir: tempHomeDir,
    projectRoot: tempProjectRoot,
    projectName: "grobot",
    workDir: tempWorkDir,
    sessionNamespaceKey: "feishu:grobot:dm:interactive-binding-contract",
    sessionStoreRuntime,
    sessionRegistryFilePathValue: "/tmp/home/sessions/contract.sessions.json",
    handoffAutoOnExit: true,
    handoffRecentTurns: 6,
    handoffPath: `${tempWorkDir}/HANDOFF.md`,
    contextEngineConfig: resolveContextEngineConfig({}),
    memoryOrchestrator,
    mcpInstructionPromptPrefix: "MCP instructions",
    mcpInstructionServerNames: ["grok-search"],
    buildHelpText: () => "contract-help",
    runtimeProviderChain,
    runtimeFailoverConfig,
    runtimeState,
    gaMechanismRuntime,
    output: {
      writeStdout: (message) => {
        stdoutChunks.push(message);
      },
    },
    runSelectMenu: async (menu: TerminalSelectMenuInput): Promise<TerminalSelectMenuResult> => {
      capturedSelectMenuHints.push(menu.hint ?? "");
      return { kind: "cancelled" };
    },
    modelOps,
    sessionMenuOps,
    wire,
    planMode,
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    executeTurn: wire.executeTurn,
  });

  const autoAskEvents: string[] = [];
  let autoAskQueueSize = 0;
  const autoAskHandler = createRunStartInteractiveHandler({
    writeStdout: (message) => {
      autoAskEvents.push(`stdout:${message}`);
    },
    writeStderr: (message) => {
      autoAskEvents.push(`stderr:${message}`);
    },
    hasPendingAsk: () => autoAskQueueSize > 0,
    getPendingAskQueueSize: () => autoAskQueueSize,
    getPendingAskPromptSummary: () => "Choose profile",
    showPendingAskQueue: (limit) => {
      autoAskEvents.push(`showPendingAskQueue:${String(limit ?? "default")}`);
    },
    selectPendingAskAnswer: async (withInputPaused) =>
      withInputPaused(async () => {
        autoAskEvents.push("selectPendingAskAnswer");
        autoAskQueueSize = 0;
        return "auto-answer";
      }),
    showHelp: () => {
      autoAskEvents.push("showHelp");
    },
    showHealthStatus: () => undefined,
    showContextStatus: () => undefined,
    showMemoryStatus: () => undefined,
    showSkillsStatus: () => undefined,
    showMcpStatus: () => undefined,
    runInitProjectInstructions: async () => undefined,
    openModelMenu: async () => undefined,
    showStatusCurrent: () => undefined,
    setStatusTheme: () => undefined,
    setStatusLayoutMode: () => undefined,
    setStatusSegmentEnabled: () => undefined,
    openStatusMenu: async () => undefined,
    openSessionMenu: async () => undefined,
    listSessionSummaries: () => [],
    getActiveSessionId: () => "auto-ask-session",
    listRewindCheckpoints: () => [],
    rewindSession: async () => false,
    createNewSession: async () => "auto-ask-new-session",
    switchActiveSession: async () => true,
    continueFromSession: async () => undefined,
    writeHandoff: () => undefined,
    isPlanMode: () => false,
    showPlanStatus: async () => 0,
    enterPlan: async () => 0,
    applyPlan: async () => 0,
    cancelPlan: async () => 0,
    requestPlanInterrupt: async () => undefined,
    requestRuntimeInterrupt: async () => undefined,
    runPlanTurn: async () => 0,
    handleUserCommandsCommand: async () => undefined,
    openCommandsMenu: async () => undefined,
    openPlanInEditor: async () => undefined,
    showHistory: async () => undefined,
    promptSkillCreatorRequirement: async () => undefined,
    runSkillCreator: async () => undefined,
    tryRunUserCommand: async () => false,
    executeTurn: async (userInput, interactiveMode, options) => {
      autoAskEvents.push(
        [
          "execute",
          userInput,
          interactiveMode ? "interactive" : "message",
          options?.autoOpenAskUserPanel === true ? "auto" : "manual",
        ].join(":"),
      );
      autoAskQueueSize = userInput === "needs clarification" ? 1 : 0;
      return 0;
    },
    markFailureObserved: () => {
      autoAskEvents.push("markFailureObserved");
    },
  });
  const autoAskAction = await autoAskHandler("needs clarification", {
    withInputPaused: async (operation) => {
      autoAskEvents.push("withInputPaused");
      return operation();
    },
  });

  const validPlan = [
    "# Contract Live Suggestion Plan",
    "",
    "- session_id: feishu:grobot:dm:interactive-binding-contract",
    "- plan_id: p_contract_live",
    "- seq: 1",
    "- status: draft",
    "",
    "## Goal",
    "",
    "验证 interactive suggestion state 会基于当前 plan 文件内容即时进入待决策态。",
    "",
    "## Scope In",
    "",
    "- 读取 active plan artifact。",
    "- 基于 live snapshot 输出 execute recommendation。",
    "",
    "## Scope Out",
    "",
    "- 不恢复旧 approve/reject 命令面。",
    "",
    "## Milestones",
    "",
    "1. [ ] 生成 live suggestion state",
    "   - 完成判据: active status 进入 ready / awaiting_decision。",
    "   - 验证: slash suggestions 出现 Implement the plan. 提示。",
    "   - 回退: 恢复 persisted-only suggestion 解析。",
    "",
    "## Validation",
    "",
    "- npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/start-interactive-bindings-contract.ts",
    "  - Expected: exit 0 and slash suggestions show Implement the plan.",
    "",
    "## Risk & Rollback",
    "",
    "- 风险: interactive/slash recommendation 与 /plan 状态页漂移。",
    "- 回退: 恢复旧 suggestion resolver 并重新对齐真相源。",
    "",
  ].join("\n");

  const createdPlan = createPlanArtifact(tempWorkDir, runtimeState.getSessionKey(), "interactive binding live suggestion");
  writeFileSync(createdPlan.planPath, `${validPlan}\n`, "utf8");
  runtimeState.setPlanMeta({
    active_plan_id: createdPlan.entry.plan_id,
    active_plan_status: "draft",
    active_plan_path: createdPlan.planPath,
    active_plan_seq: createdPlan.entry.seq,
    active_plan_title: createdPlan.entry.title,
    active_plan_phase: "drafting",
  });
  planModeActive = true;
  const livePlanSuggestionState = interactiveModeInput.getPlanSuggestionState?.();
  const livePlanSuggestions = listRunStartSlashSuggestions({
    homeDir: "/tmp/home",
    userInput: "/plan ",
    planMode: true,
    planSuggestionState: livePlanSuggestionState,
    maxItems: 80,
  });
  writeFileSync(
    createdPlan.planPath,
    "# Degraded Plan\n\nTODO: fill sections later.\n",
    "utf8",
  );
  const changedPlanSuggestionState = interactiveModeInput.getPlanSuggestionState?.();
  const changedPlanSuggestions = listRunStartSlashSuggestions({
    homeDir: "/tmp/home",
    userInput: "/plan ",
    planMode: true,
    planSuggestionState: changedPlanSuggestionState,
    maxItems: 80,
  });
  planModeActive = false;

  try {
    await interactiveModeInput.switchActiveSession("session-a", "switch");
    switchResult = false;
    await interactiveModeInput.switchActiveSession("session-b", "switch");
    interactiveModeInput.showHealthStatus();
    interactiveModeInput.showContextStatus();
    interactiveModeInput.showMemoryStatus();
    interactiveModeInput.showSkillsStatus();
    interactiveModeInput.showMcpStatus();
    await interactiveModeInput.showHistory();
    await interactiveModeInput.runInitProjectInstructions();
    writeFileSync(`${tempProjectRoot}/AGENTS.md`, "# Existing agents\n", "utf8");
    await interactiveModeInput.runInitProjectInstructions();
    interactiveModeInput.showStatusCurrent();
    interactiveModeInput.setStatusTheme("nerd");
    interactiveModeInput.setStatusLayoutMode("compact");
    interactiveModeInput.setStatusSegmentEnabled("tokens", false);
    await interactiveModeInput.openPlanInEditor(async (operation) => operation());
    const planOpenNoActiveText = stdoutChunks.join("");
    activePlanPathForEditor = joinPath(tempWorkDir, ".grobot", "plans", "interactive-open.md");
    mkdirSync(joinPath(tempWorkDir, ".grobot", "plans"), { recursive: true });
    writeFileSync(activePlanPathForEditor, "# Interactive open plan\n", "utf8");
    const originalVisual = process.env.VISUAL;
    const originalEditor = process.env.EDITOR;
    process.env.VISUAL = "true";
    delete process.env.EDITOR;
    const planOpenSuccessStart = stdoutChunks.join("").length;
    try {
      await interactiveModeInput.openPlanInEditor(async (operation) => operation());
    } finally {
      if (typeof originalVisual === "undefined") {
        delete process.env.VISUAL;
      } else {
        process.env.VISUAL = originalVisual;
      }
      if (typeof originalEditor === "undefined") {
        delete process.env.EDITOR;
      } else {
        process.env.EDITOR = originalEditor;
      }
    }
    const planOpenSuccessText = stdoutChunks.join("").slice(planOpenSuccessStart);
    interactiveModeInput.writeManualHandoff();
    interactiveModeInput.writeAutoExitHandoffIfNeeded();
    interactiveModeInput.showPendingAskQueue();
    const buildPendingAsk = (
      suffix: string,
      options: string[] = ["safe", "fast"],
    ) => normalizeAskUserEnvelopeFromPayload({
      blocking_node_id: "node.contract.ask",
      questions: [{
        id: `ask_q_contract_${suffix}`,
        header: "Profile",
        question: "Choose profile",
        options,
      }],
      default_on_timeout: "safe",
      resume_token: `resume_contract_${suffix}`,
    });
    const pendingAskPrimary = buildPendingAsk("001", [
      "safe",
      "fast",
      "aggressive",
      "balanced",
      "retry",
      "fallback",
    ]);
    const pendingAskSecondary = buildPendingAsk("002", ["yes", "no"]);
    if (!pendingAskPrimary || !pendingAskSecondary) {
      throw new Error("failed to build contract ask-user envelope");
    }
    gaMechanismRuntime.registerPendingAsk(runtimeState.getSessionKey(), pendingAskPrimary);
    gaMechanismRuntime.registerPendingAsk(runtimeState.getSessionKey(), pendingAskSecondary);
    const askStatusCompactStart = stdoutChunks.join("").length;
    await withStdinTty(true, async () => {
      interactiveModeInput.showPendingAskQueue();
      return undefined;
    });
    const askStatusCompactText = stdoutChunks.join("").slice(askStatusCompactStart);
    interactiveModeInput.showPendingAskQueue();
    interactiveModeInput.showPendingAskQueue(-1);
    const statusConfigAfter = interactiveModeInput.getStatusLineConfig();
    const stdoutBeforeCancelledMenus = stdoutChunks.join("").length;
    await withStdinTty(true, async () => {
      await interactiveModeInput.openStatusMenu(async (operation) => operation());
      await interactiveModeInput.openHistorySearch({ currentInput: "" });
    });
    const cancelledMenuOutput = stdoutChunks.join("").slice(stdoutBeforeCancelledMenus);

    const outputText = stdoutChunks.join("");
    const payload = {
      pass_through_project_name: interactiveModeInput.projectName === "grobot",
      pass_through_session_runtime:
        interactiveModeInput.sessionStoreRuntime.backend === "file",
      switch_calls: switchEvents.length,
      switch_first_call: switchEvents[0] ?? "",
      switch_second_call: switchEvents[1] ?? "",
      model_override_count: applyModelOverrideCount,
      health_has_header: outputText.includes("Model providers"),
      health_has_sticky_provider: outputText.includes("Sticky provider alpha"),
      health_hides_raw_sticky_label: !outputText.includes("sticky alpha"),
      health_hides_raw_session_namespace:
        !outputText.includes("session feishu:grobot:dm")
        && !outputText.includes("feishu:grobot:dm:interactive-binding-contract"),
      health_has_provider_row: outputText.includes("alpha · Healthy"),
      health_hides_raw_status_codes:
        !outputText.includes("(CLOSED)")
        && !outputText.includes("(OPEN)")
        && !outputText.includes("(HALF_OPEN)"),
      health_hides_raw_rpm_burst_labels:
        !outputText.includes("rpm ")
        && !outputText.includes("burst "),
      health_uses_human_cooldown: outputText.includes("cooldown 30s"),
      context_status_has_header: outputText.includes("Context"),
      context_status_uses_human_subtitle:
        outputText.includes("Context window assembled before each turn"),
      context_status_has_system_prompt_name: outputText.includes("System prompt · built-in SYSTEM.md"),
      context_status_keeps_memory_separate: outputText.includes("not the current context window"),
      memory_status_has_header: outputText.includes("Memory"),
      memory_status_uses_human_subtitle:
        outputText.includes("Persistent memory across turns, sessions, projects"),
      skills_status_counts_project_skill:
        outputText.includes("Project · available")
        && outputText.includes(`directory ${tempProjectRoot}/.grobot/skills`)
        && outputText.includes("skills 1"),
      skills_status_counts_global_skill:
        outputText.includes("Global · available")
        && outputText.includes(`directory ${tempHomeDir}/skills`)
        && outputText.includes("skills 1"),
      skills_status_uses_human_subtitle:
        outputText.includes("Project and global skill directories"),
      mcp_status_has_server: outputText.includes("Services · grok-search"),
      mcp_status_instruction_pack_loaded: outputText.includes("Instruction pack · loaded"),
      mcp_status_uses_human_subtitle:
        outputText.includes("Service list and instruction injection status"),
      history_status_uses_human_subtitle:
        outputText.includes("Recent conversation records"),
      init_prompt_targets_agents: turnInputs.some((item) =>
        item.includes(`Must create file: ${tempProjectRoot}/AGENTS.md`),
      ),
      init_prompt_blocks_trellis: turnInputs.some((item) =>
        item.includes("Do not generate Trellis files"),
      ),
      init_prompt_blocks_system_prompt_file: turnInputs.some((item) =>
        item.includes("Do not create or modify `SYSTEM.md`"),
      ),
      init_existing_agents_skips:
        outputText.includes("AGENTS.md already exists")
        && outputText.includes("/init skipped to avoid overwrite.")
        && outputText.includes("path "),
      init_generation_surface_is_human:
        outputText.includes("Generating project instructions")
        && !outputText.includes("[init] generating project instructions"),
      manual_handoff_reason: handoffReason,
      manual_handoff_to_stderr: handoffToStderr,
      auto_exit_to_stderr: autoExitToStderr,
      history_count: interactiveModeInput.getHistoryMessagesCount(),
      help_text: interactiveModeInput.buildHelpText(),
      active_session_id: interactiveModeInput.getActiveSessionId(),
      active_session_topic: interactiveModeInput.getActiveSessionTopic() ?? "",
      model_snapshot_model: interactiveModeInput.getModelSnapshot().model,
      model_snapshot_provider: interactiveModeInput.getModelSnapshot().providerName,
      prompt_budget_ctx_ratio: 0.42,
      prompt_budget_estimated_tokens: 512,
      prompt_budget_target_tokens: 2048,
      status_snapshot_has_header: outputText.includes("Status bar"),
      status_snapshot_uses_human_segment_labels:
        outputText.includes("Model on")
        && outputText.includes("Token on")
        && !outputText.includes("model on")
        && !outputText.includes("tokens on"),
      status_surface_hides_machine_fields:
        !outputText.includes("[status]")
        && !outputText.includes("[context]")
        && !outputText.includes("[memory]")
        && !outputText.includes("[skills]")
        && !outputText.includes("[mcp]")
        && !outputText.includes("[history]")
        && !outputText.includes("路径=")
        && !outputText.includes("存在=")
        && !outputText.includes("技能=")
        && !outputText.includes("layout_mode")
        && !outputText.includes("theme:")
        && !outputText.includes("布局:")
        && !outputText.includes("主题:")
        && !outputText.includes("tokens=off")
        && !outputText.includes("布局: compact")
        && !outputText.includes("主题: nerd_font")
        && !outputText.includes("recent conversation history")
        && !outputText.includes("bounded context window assembled before each turn")
        && !outputText.includes("persistent memory across turns, sessions, and projects")
        && !outputText.includes("server inventory and instruction injection state")
        && !outputText.includes("project and global skill directories")
        && !outputText.includes("上下文窗口 tokens:")
        && !outputText.includes("auto ·")
        && !outputText.includes("token_window")
        && !outputText.includes("auto_compact_threshold")
        && !outputText.includes("history_messages")
        && !outputText.includes("project_instruction_source")
        && !outputText.includes("strict_failure")
        && !outputText.includes("usage:")
        && !outputText.includes("directory:")
        && !outputText.includes("path:")
        && !outputText.includes("user:")
        && !outputText.includes("assistant:")
        && !outputText.includes("GA 行")
        && !outputText.includes("skill 卡")
        && !outputText.includes("Skills:")
        && !outputText.includes("skill 创建")
        && !outputText.includes("创建或更新 skill")
        && !outputText.includes("mcp_call(")
        && !outputText.includes("mcp_call(server, tool)")
        && !outputText.includes("provider failover"),
      status_theme_after_update: statusConfigAfter.theme,
      status_layout_after_update: statusConfigAfter.layoutMode,
      status_tokens_segment_after_update: statusConfigAfter.segments.tokens,
      status_segment_update_notice_is_human:
        outputText.includes("Status segment updated")
        && outputText.includes("segment Token")
        && outputText.includes("disabled")
        && !outputText.includes("segment: Token")
        && !outputText.includes("segment: tokens"),
      plan_open_no_active_surface_is_human:
        planOpenNoActiveText.includes("No active plan file")
        && !planOpenNoActiveText.includes("● No active plan file")
        && planOpenNoActiveText.includes("• Use /plan <goal> first."),
      plan_open_success_surface_is_human:
        planOpenSuccessText.includes("Plan file opened")
        && !planOpenSuccessText.includes("● Plan file opened")
        && planOpenSuccessText.includes("• plan file .grobot/plans/interactive-open.md")
        && !planOpenSuccessText.includes("Opened plan in editor"),
      status_menu_cancel_is_silent: cancelledMenuOutput.length === 0,
      status_menu_hint_is_reference_compact:
        capturedSelectMenuHints.includes("↑/↓ select · Enter confirm · Esc back"),
      history_search_hint_is_reference_fill:
        capturedSelectMenuHints.includes("↑/↓ select · Enter fill · Esc back"),
      interactive_menu_hints_omit_secondary_key_chords:
        capturedSelectMenuHints.every((hint) =>
          !hint.includes("Ctrl+n/p")
          && !hint.includes("number to select directly")
          && !hint.includes("Enter/Space")
          && !hint.includes("Esc to cancel")
        ),
      ask_status_no_pending_warned: outputText.includes("No pending questions."),
      ask_status_has_clean_question:
        outputText.includes("Input needed · Profile") && outputText.includes("Choose profile"),
      ask_status_has_clean_options:
        outputText.includes("❯ 1  safe") && outputText.includes("6  fallback"),
      ask_status_has_menu_hint:
        outputText.includes("Enter confirm") && outputText.includes("Esc back to input"),
      ask_status_hides_options_preview: !outputText.includes("options_preview: "),
      ask_status_hides_log_prefix: !outputText.includes("[ask-user]"),
      ask_status_hides_output_mode_full: !outputText.includes("ask_status_output_mode: full"),
      ask_status_hides_options_more: !outputText.includes("options_more: +1"),
      ask_status_has_pending_total: outputText.includes("Pending: 2 items"),
      ask_status_hides_followup_row: !outputText.includes("pending_followup_1: ask_q_contract_002"),
      ask_status_hides_reply_direct_log_hint:
        !outputText.includes("hint: reply directly in chat to answer active question"),
      ask_status_hides_status_only_log_hint:
        !outputText.includes("hint: ask-user actions are automatic; there is no /ask command"),
      ask_queue_hint_hides_log_prefix:
        !buildAskUserQueueContinuationHint(1).includes("[ask-user]"),
      ask_queue_hint_mentions_followup_count:
        buildAskUserQueueContinuationHint(2).includes("2 follow-up confirmations remain"),
      ask_status_compact_has_header:
        askStatusCompactText.includes("Input needed · Profile"),
      ask_status_compact_hides_output_mode:
        !askStatusCompactText.includes("ask_status_output_mode: compact"),
      ask_status_compact_hides_detail_hint:
        !askStatusCompactText.includes("ask_status_detail_hint:"),
      ask_status_compact_has_pending_total:
        askStatusCompactText.includes("Pending: 2 items"),
      ask_status_compact_hides_followup_rows:
        !askStatusCompactText.includes("pending_followup_1: "),
      ask_status_compact_hides_status_only_hint:
        !askStatusCompactText.includes("hint: ask-user actions are automatic; there is no /ask command"),
      plan_suggestion_state_detects_live_status:
        livePlanSuggestionState?.activePlanStatus === "ready",
      plan_suggestion_state_detects_live_phase:
        livePlanSuggestionState?.activePlanPhase === "awaiting_decision",
      plan_suggestion_state_detects_live_source:
        livePlanSuggestionState?.activePlanStatusSource === "live_snapshot",
      plan_suggestion_state_detects_decision_ready:
        livePlanSuggestionState?.activePlanDecisionReady === true,
      plan_suggestion_state_recommendation_execute:
        livePlanSuggestionState?.activePlanRecommendationCommand === "Implement the plan.",
      plan_suggestion_state_preserves_stored_latest:
        livePlanSuggestionState?.latestPlanStatus === "draft",
      plan_slash_suggestions_surface_direct_execute:
        livePlanSuggestions.some((item) => item.description.includes("reply Implement the plan")),
      plan_suggestion_state_invalidates_cache_on_file_change:
        changedPlanSuggestionState?.activePlanStatus !== "ready",
      plan_suggestion_state_after_file_change_uses_live_source:
        changedPlanSuggestionState?.activePlanStatusSource === "live_snapshot",
      plan_slash_suggestions_after_file_change_drops_execute_hint:
        !changedPlanSuggestions.some((item) => item.description.includes("Start implementation")),
      plan_execute_submit_transcript_suppressed:
        shouldSuppressRunStartSubmitTranscript({
          value: "Implement the plan.",
          planMode: true,
          pendingAskCount: 0,
        }),
      plan_refine_submit_transcript_kept:
        !shouldSuppressRunStartSubmitTranscript({
          value: "补充一下验证细节",
          planMode: true,
          pendingAskCount: 0,
        }),
      normal_submit_transcript_kept:
        !shouldSuppressRunStartSubmitTranscript({
          value: "Implement the plan.",
          planMode: false,
          pendingAskCount: 0,
        }),
      pending_ask_empty_submit_transcript_suppressed:
        shouldSuppressRunStartSubmitTranscript({
          value: "",
          planMode: true,
          pendingAskCount: 1,
        }),
      pending_ask_plan_execute_submit_transcript_kept:
        !shouldSuppressRunStartSubmitTranscript({
          value: "Implement the plan.",
          planMode: true,
          pendingAskCount: 1,
        }),
      auto_ask_handler_returns_continue:
        autoAskAction === "continue",
      auto_ask_handler_auto_opens_initial_runtime_ask:
        autoAskEvents.includes("execute:needs clarification:interactive:auto")
        && autoAskEvents.includes("selectPendingAskAnswer"),
      auto_ask_handler_uses_input_pause:
        autoAskEvents.includes("withInputPaused"),
      auto_ask_handler_feeds_selected_answer:
        autoAskEvents.includes("execute:auto-answer:interactive:auto"),
      auto_ask_handler_keeps_failure_clear:
        !autoAskEvents.includes("markFailureObserved"),
    };

    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } finally {
    rmSync(tempWorkDir, { recursive: true, force: true });
  }
}

void main();
