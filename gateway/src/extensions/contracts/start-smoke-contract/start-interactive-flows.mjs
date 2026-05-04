import { resolve } from "node:path";

export function runStartInteractiveSessionFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    readJsonFileSafe,
    readTextFileSafe,
    sanitizeSessionKey,
  } = context;
  const workDir = createTempDir("grobot-start-work");
  const homeDir = createTempDir("grobot-start-home");
  const config = writeConfig(buildSmokeConfig(workDir));
  const commandResult = runCommand(
    repoRoot,
    [
      "./grobot",
      "start",
      "--project",
      "grobot",
      "--project-root",
      workDir,
      "--work-dir",
      workDir,
      "--home",
      homeDir,
      "--config",
      config.configPath,
      "--session-backend",
      "file",
      "--gateway-impl",
      "ts",
      "--runtime-impl",
      "rust",
      "--session-subject",
      "smoke-user",
      "--history-turns",
      "8",
    ],
    null,
    ["/sessions", "/new", "/sessions", "TODO: interactive ts start", "/exit", ""].join("\n"),
  );
  const namespaceKey = "feishu:grobot:dm:smoke-user";
  const registryPath = `${workDir}/.grobot/sessions/${sanitizeSessionKey(namespaceKey)}.sessions.json`;
  const registryPayload = readJsonFileSafe(registryPath);
  const handoffPath = `${workDir}/HANDOFF.md`;
  const handoffContent = readTextFileSafe(handoffPath);
  const sessions = registryPayload && Array.isArray(registryPayload.sessions) ? registryPayload.sessions : [];
  const activeSessionId = registryPayload && typeof registryPayload.active_id === "string" ? registryPayload.active_id : "";
  let activeSessionKey = namespaceKey;
  for (const item of sessions) {
    if (!item || typeof item !== "object") {
      continue;
    }
    if (String(item.id ?? "") !== activeSessionId) {
      continue;
    }
    const key = typeof item.session_key === "string" ? item.session_key : "";
    if (key.trim().length > 0) {
      activeSessionKey = key.trim();
      break;
    }
  }
  const activeHistoryPath = `${workDir}/.grobot/sessions/${sanitizeSessionKey(activeSessionKey)}.history.json`;
  const activeHistoryPayload = readJsonFileSafe(activeHistoryPath);
  return {
    ...commandResult,
    registry_path: registryPath,
    history_path: activeHistoryPath,
    handoff_path: handoffPath,
    session_count: sessions.length,
    active_session_id: activeSessionId,
    history_message_count:
      activeHistoryPayload && Array.isArray(activeHistoryPayload.messages) ? activeHistoryPayload.messages.length : 0,
    handoff_exists: handoffContent.length > 0,
    handoff_has_compact_instructions: handoffContent.includes("## Compact Instructions"),
    handoff_has_auto_exit_reason: handoffContent.includes("reason: auto-exit"),
  };
}

export function runStartBareInteractiveSessionFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    hasStartBannerMarker,
  } = context;
  const workDir = createTempDir("grobot-bare-start-work");
  const homeDir = createTempDir("grobot-bare-start-home");
  const config = writeConfig(buildSmokeConfig(workDir));
  const commandResult = runCommand(
    repoRoot,
    [
      "./grobot",
      "--project",
      "grobot",
      "--project-root",
      workDir,
      "--work-dir",
      workDir,
      "--home",
      homeDir,
      "--config",
      config.configPath,
      "--session-backend",
      "file",
      "--gateway-impl",
      "ts",
      "--runtime-impl",
      "rust",
      "--session-subject",
      "bare-command-user",
      "--history-turns",
      "8",
    ],
    null,
    ["/status", "/exit", ""].join("\n"),
  );
  const outputText = `${commandResult.stdout}\n${commandResult.stderr}`;
  return {
    ...commandResult,
    has_start_banner: hasStartBannerMarker(outputText),
    has_status_snapshot: outputText.includes("● 状态栏"),
    has_no_command_hint:
      !outputText.includes("Enter message")
      && !outputText.includes("/ for commands · ? for shortcuts"),
    has_no_unsupported_command_error:
      outputText.includes("unsupported command for grobot CLI") === false
      && outputText.includes("unsupported command for ts-dev-cli") === false,
  };
}

export function runStartInteractiveDiagnosticsFlow(context, mode, scriptedInput, subjectSuffix = "base") {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
  } = context;
  const normalizedMode = mode === "trace"
    ? "trace"
    : mode === "verbose"
      ? "verbose"
      : "compact";
  const normalizedSuffix = String(subjectSuffix)
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "base";
  const sessionSubject = normalizedMode === "compact"
    ? `diagnostics-compact-user-${normalizedSuffix}`
    : normalizedMode === "trace"
      ? `diagnostics-trace-user-${normalizedSuffix}`
      : `diagnostics-verbose-user-${normalizedSuffix}`;
  const workDir = createTempDir("grobot-interactive-diagnostics-work");
  const homeDir = createTempDir("grobot-interactive-diagnostics-home");
  const config = writeConfig(buildSmokeConfig(workDir));
  const args = [
    "./grobot",
    "--project",
    "grobot",
    "--project-root",
    workDir,
    "--work-dir",
    workDir,
    "--home",
    homeDir,
    "--config",
    config.configPath,
    "--session-backend",
    "file",
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
    "--session-subject",
    sessionSubject,
    "--history-turns",
    "8",
  ];
  if (normalizedMode !== "compact") {
    args.push("--verbose");
  }
  if (normalizedMode === "trace") {
    args.push("--trace");
  }
  const commandResult = runCommand(
    repoRoot,
    args,
    {
      GROBOT_STARTUP_DIAGNOSTICS: "0",
      GROBOT_INTERACTIVE_DIAGNOSTICS: "0",
      GROBOT_ALLOW_TS_DEV_CLI: "1",
      GROBOT_ALLOW_REDIS_FALLBACK: "1",
    },
    scriptedInput ?? ["/new", "diagnostics visibility smoke", "/exit", ""].join("\n"),
  );
  return {
    ...commandResult,
    diagnostic_mode: normalizedMode,
    verbose_mode: normalizedMode !== "compact",
    has_process_lines: commandResult.stdout.includes("[process]"),
    has_process_summary_lines: commandResult.stdout.includes("[process-summary]"),
    has_short_process_summary_code: /\[process-summary\]\s+(ok|err|int)\s+\d/.test(
      commandResult.stdout,
    ),
    stderr_has_event_lines: /\bevent=/.test(commandResult.stderr),
    stderr_has_trace_lines: commandResult.stderr.includes("[trace]"),
    stderr_has_runtime_error: commandResult.stderr.includes("runtime failed:"),
    stderr_has_prompt_prepared: commandResult.stderr.includes(
      "[context-engine] event=prompt_prepared",
    ),
  };
}

export function runStartInteractiveDiagnosticsPlanFlow(context, mode) {
  const payload = runStartInteractiveDiagnosticsFlow(
    context,
    mode,
    ["/plan diagnostics integration flow", "/plan open", "/exit", ""].join("\n"),
    "plan",
  );
  return {
    ...payload,
    command_flow: "plan",
    has_plan_marker:
      payload.stdout.includes("当前计划")
      || payload.stdout.includes("Enabled plan mode")
      || payload.stdout.includes("Already in plan mode")
      || payload.stdout.includes("计划草稿")
      || payload.stdout.includes("已进入 plan mode")
      || payload.stdout.includes("[plan]"),
    has_entered_plan_mode_surface: payload.stdout.includes("已进入 plan mode"),
    has_plan_entry_path_line: payload.stdout.includes("计划文件: .grobot/plans/"),
    has_plan_entry_goal_line: payload.stdout.includes("目标: diagnostics integration flow"),
    has_plan_entry_read_only_line:
      payload.stdout.includes("确认计划前，plan mode 只会读取和规划。"),
    has_plan_entry_working_notice: payload.stdout.includes("正在规划..."),
    has_plan_draft_surface: payload.stdout.includes("计划草稿"),
    has_plan_draft_refine_hint:
      payload.stdout.includes('直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。'),
    plan_draft_avoids_legacy_empty_message:
      !payload.stdout.includes("Already in plan mode. No plan written yet."),
  };
}

export function runStartInteractiveDiagnosticsSkillCreatorFlow(context, mode) {
  const { stripAnsi } = context;
  const payload = runStartInteractiveDiagnosticsFlow(
    context,
    mode,
    ["/skill-creator create a demo skill for diagnostics contracts", "/exit", ""].join("\n"),
    "skill-creator",
  );
  const stdoutPlain = stripAnsi(payload.stdout);
  return {
    ...payload,
    command_flow: "skill_creator",
    has_skill_creator_marker: stdoutPlain.includes("正在生成技能"),
    skill_creator_surface_avoids_legacy_marker: !payload.stdout.includes("[skill-creator]"),
    has_human_skill_creator_surface:
      stdoutPlain.includes("正在生成技能")
      && stdoutPlain.includes("create a demo skill for diagnostics contracts"),
  };
}

export function runStartInteractiveDiagnosticsUserCommandFlow(context, mode) {
  const { stripAnsi } = context;
  const payload = runStartInteractiveDiagnosticsFlow(
    context,
    mode,
    [
      "/commands new ping You are /ping. reply with pong.",
      "/ping diagnostics",
      "/exit",
      "",
    ].join("\n"),
    "user-command",
  );
  const stdoutPlain = stripAnsi(payload.stdout);
  return {
    ...payload,
    command_flow: "user_command",
    has_commands_marker: stdoutPlain.includes("已创建自定义命令"),
    command_surface_avoids_legacy_marker: !payload.stdout.includes("[commands]"),
    has_human_created_command_surface: stdoutPlain.includes("命令: /ping"),
  };
}

export function runStartInteractiveSessionCommandsFallbackFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    readJsonFileSafe,
    sanitizeSessionKey,
    stripAnsi,
  } = context;
  const workDir = createTempDir("grobot-start-work");
  const homeDir = createTempDir("grobot-start-home");
  const config = writeConfig(buildSmokeConfig(workDir));
  const subject = "session-command-fallback-user";
  const commandResult = runCommand(
    repoRoot,
    [
      "./grobot",
      "start",
      "--project",
      "grobot",
      "--project-root",
      workDir,
      "--work-dir",
      workDir,
      "--home",
      homeDir,
      "--config",
      config.configPath,
      "--session-backend",
      "file",
      "--gateway-impl",
      "ts",
      "--runtime-impl",
      "rust",
      "--session-subject",
      subject,
      "--history-turns",
      "8",
    ],
    null,
    [
      "/new",
      "/switch",
      "/continue",
      "/resume",
      "/rewind",
      "/sessions",
      "/status",
      "/status theme nerd",
      "/status layout compact",
      "/status segment tokens off",
      "/status current",
      "/exit",
      "",
    ].join("\n"),
  );
  const namespaceKey = `feishu:grobot:dm:${subject}`;
  const registryPath = `${workDir}/.grobot/sessions/${sanitizeSessionKey(namespaceKey)}.sessions.json`;
  const registryPayload = readJsonFileSafe(registryPath);
  const sessions = registryPayload && Array.isArray(registryPayload.sessions) ? registryPayload.sessions : [];
  const outputText = `${commandResult.stdout}\n${commandResult.stderr}`;
  const outputPlain = stripAnsi(outputText);
  const inferredSessionIds = new Set();
  for (const match of outputText.matchAll(/^\s*\*?\s*([A-Za-z0-9_-]+)\s+\|/gm)) {
    const sessionId = String(match[1] ?? "").trim();
    if (sessionId.length > 0) {
      inferredSessionIds.add(sessionId);
    }
  }
  return {
    ...commandResult,
    registry_path: registryPath,
    session_count: Math.max(sessions.length, inferredSessionIds.size),
    has_switch_usage: outputText.includes("用法: /switch"),
    has_continue_usage: outputText.includes("用法: /continue"),
    has_resume_usage: outputText.includes("用法: /resume"),
    has_rewind_usage: outputText.includes("用法: /rewind"),
    has_sessions_overview:
      outputPlain.includes("● 会话")
      && outputPlain.includes("命名空间:"),
    session_surface_avoids_legacy_plain_namespace:
      !outputPlain.includes("会话命名空间:"),
    session_switch_surface_is_human:
      outputPlain.includes("● 已切换会话")
      && outputPlain.includes("历史来源:"),
    has_session_title_main: outputPlain.includes("主会话"),
    has_session_title_untitled: outputPlain.includes("未命名会话"),
    has_status_snapshot: outputText.includes("● 状态栏"),
    has_status_theme_set:
      outputText.includes("● 已更新状态栏主题")
      && outputText.includes("主题: nerd_font"),
    has_status_layout_set:
      outputText.includes("● 已更新状态栏布局")
      && outputText.includes("布局: compact"),
    has_status_tokens_off:
      outputText.includes("● 已更新状态栏状态段")
      && outputText.includes("状态段: tokens")
      && outputText.includes("状态: 已关闭"),
    has_status_theme_current: outputText.includes("主题: nerd_font"),
    has_status_layout_current: outputText.includes("布局: compact"),
    has_status_tokens_current_off: outputText.includes("tokens 关闭"),
  };
}

export function runStartInteractiveInterruptFlow(
  context,
  providerBaseUrl,
  providerApiKey,
  providerModel,
) {
  const {
    repoRoot,
    createTempDir,
    buildSingleProviderConfig,
    writeConfig,
    runShellScript,
    shellEscape,
  } = context;
  const workDir = createTempDir("grobot-start-interrupt-work");
  const homeDir = createTempDir("grobot-start-interrupt-home");
  const config = writeConfig(
    buildSingleProviderConfig(workDir, {
      name: "interrupt-provider",
      baseUrl: providerBaseUrl,
      apiKey: providerApiKey,
      model: providerModel,
    }),
  );
  const commandArgs = [
    "./grobot",
    "start",
    "--project",
    "grobot",
    "--project-root",
    workDir,
    "--work-dir",
    workDir,
    "--home",
    homeDir,
    "--config",
    config.configPath,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
    "--session-subject",
    "interrupt-smoke-user",
    "--history-turns",
    "8",
    "--runtime-http-timeout-ms",
    "12000",
  ];
  const commandLine = commandArgs.map(shellEscape).join(" ");
  const commandResult = runShellScript(
    repoRoot,
    [
      "{",
      "  printf '%s\\n' 'interrupt smoke turn'",
      "  sleep 0.80",
      "  printf '%s\\n' '/interrupt'",
      "  sleep 0.25",
      "  printf '%s\\n' '/exit'",
      "  printf '\\n'",
      `} | ${commandLine}`,
    ].join("\n"),
  );
  const combinedOutput = `${commandResult.stdout}\n${commandResult.stderr}`;
  return {
    ...commandResult,
    interrupt_requested_seen:
      combinedOutput.includes("已请求中断当前回合")
      && combinedOutput.includes("诊断: TURN_INTERRUPT_OK")
      && !commandResult.stdout.includes("[interrupt] code=TURN_INTERRUPT_OK"),
    interrupt_requested_avoids_legacy_event: !combinedOutput.includes(
      "[interrupt] event=requested source=command",
    ),
    interrupt_applied_avoids_legacy_event: !combinedOutput.includes(
      "[interrupt] event=applied source=command",
    ),
    interrupt_ignored_avoids_legacy_event: !combinedOutput.includes(
      "[interrupt] event=ignored source=command",
    ),
    interrupt_notice_seen:
      combinedOutput.includes("回合已中断")
      && !commandResult.stdout.includes("[interrupt] 回合已中断"),
    interrupt_continue_hint_seen: combinedOutput.includes("可以继续输入新指令。"),
  };
}

export function runStartSessionMenuViewModelContract(context) {
  const { repoRoot, runCommand } = context;
  const scriptPath = resolve(repoRoot, "gateway/src/extensions/contracts/start-session-menu-contract.ts");
  const contractResult = runCommand(repoRoot, [
    "npx",
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    scriptPath,
  ]);
  if (contractResult.exit_code !== 0) {
    return contractResult;
  }
  try {
    const parsed = JSON.parse(contractResult.stdout);
    return {
      ...contractResult,
      ...parsed,
    };
  } catch (error) {
    return {
      ...contractResult,
      exit_code: 1,
      parse_error: String(error),
    };
  }
}
