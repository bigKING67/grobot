import { existsSync } from "node:fs";

export function runStartPlanModeFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    readJsonFileSafe,
    readTextFileSafe,
    sanitizeSessionKey,
    sanitizePlanSessionSegment,
  } = context;
  const workDir = createTempDir("grobot-plan-work");
  const homeDir = createTempDir("grobot-plan-home");
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
      "plan-smoke-user",
      "--history-turns",
      "8",
    ],
    null,
    [
      "/plan implement plan-mode skeleton",
      "Implement the plan.",
      "/plan open",
      "/exit",
      "",
    ].join("\n"),
  );
  const namespaceKey = "feishu:grobot:dm:plan-smoke-user";
  const registryPath = `${workDir}/.grobot/sessions/${sanitizeSessionKey(namespaceKey)}.sessions.json`;
  const registryPayload = readJsonFileSafe(registryPath);
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
  const planDir = `${workDir}/.grobot/plans/${sanitizePlanSessionSegment(activeSessionKey)}`;
  const planIndexPath = `${planDir}/index.json`;
  const activePlanPath = `${planDir}/ACTIVE.md`;
  const eventsPath = `${planDir}/events.jsonl`;
  const planIndex = readJsonFileSafe(planIndexPath);
  const planEntries = planIndex && Array.isArray(planIndex.entries) ? planIndex.entries : [];
  const planEntry =
    planEntries.length > 0 && planEntries[0] && typeof planEntries[0] === "object"
      ? planEntries[0]
      : null;
  const reviewFailCount =
    planEntry && Number.isFinite(Number(planEntry.review_fail_count))
      ? Number(planEntry.review_fail_count)
      : 0;
  const blockedCount =
    planEntry && Number.isFinite(Number(planEntry.blocked_count))
      ? Number(planEntry.blocked_count)
      : 0;
  const eventsContent = readTextFileSafe(eventsPath);
  const combinedOutput = `${commandResult.stdout}\n${commandResult.stderr}`;
  const finalStatusMarkerCurrent = "计划草稿";
  return {
    ...commandResult,
    registry_path: registryPath,
    plan_dir: planDir,
    plan_index_path: planIndexPath,
    active_plan_path: activePlanPath,
    events_path: eventsPath,
    events_count: eventsContent ? eventsContent.trim().split("\n").filter((line) => line.trim().length > 0).length : 0,
    session_count: sessions.length,
    active_session_id: activeSessionId,
    active_session_key: activeSessionKey,
    plan_entry_count: planEntries.length,
    plan_active_id: planIndex && typeof planIndex.active_plan_id === "string" ? planIndex.active_plan_id : "",
    plan_active_exists: existsSync(activePlanPath),
    review_failed_marker_seen:
      combinedOutput.includes("[plan-review] code=PLAN_REVIEW_FAILED")
      || combinedOutput.includes("[plan-review] code=PLAN_REVIEW_BLOCKED")
      || combinedOutput.includes("诊断: PLAN_REVIEW_FAILED")
      || combinedOutput.includes("诊断: PLAN_REVIEW_BLOCKED"),
    review_failed_recommends_refine:
      combinedOutput.includes("下一步: 继续完善计划")
      || combinedOutput.includes("下一步: 继续完善当前计划（直接输入补充内容）")
      || combinedOutput.includes("suggested_action_command: 继续完善当前计划（直接输入补充内容）"),
    review_failed_avoids_execute_recommendation:
      !combinedOutput.includes("suggested_action_command: Implement the plan."),
    review_failed_validation_command_gap_seen:
      combinedOutput.includes("validation_missing_command")
      || combinedOutput.includes("Validation: 增加真实命令或明确的手工验证步骤。"),
    review_blocked_marker_seen:
      combinedOutput.includes("[plan-review] code=PLAN_REVIEW_BLOCKED")
      || combinedOutput.includes("诊断: PLAN_REVIEW_BLOCKED"),
    plan_cancelled_marker_seen:
      combinedOutput.includes("已取消计划")
      && combinedOutput.includes("计划已丢弃，plan mode 已退出。")
      && !commandResult.stdout.includes("[plan] 已取消计划 plan_id="),
    plan_final_status_line_seen: combinedOutput.includes(finalStatusMarkerCurrent),
    plan_open_script_notice_hidden:
      !combinedOutput.includes("/plan open is interactive-only")
      && !combinedOutput.includes("showing current status in script mode"),
    plan_status_preview_hides_machine_metadata:
      !commandResult.stdout.includes("session_id:")
      && !commandResult.stdout.includes("plan_id:")
      && !commandResult.stdout.includes("seq:")
      && !commandResult.stdout.includes("status:"),
    plan_draft_status_seen:
      commandResult.stdout.includes("计划草稿"),
    plan_draft_status_has_path:
      commandResult.stdout.includes(".grobot/plans/"),
    plan_draft_status_has_read_only_boundary:
      commandResult.stdout.includes("确认最终计划前，plan mode 只会读取和规划。"),
    plan_draft_status_has_refine_hint:
      commandResult.stdout.includes('直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。'),
    plan_draft_status_avoids_legacy_empty_message:
      !commandResult.stdout.includes("Already in plan mode. No plan written yet."),
    plan_enter_surface_seen: commandResult.stdout.includes("已进入 plan mode"),
    plan_enter_surface_has_path:
      commandResult.stdout.includes("计划文件: .grobot/plans/"),
    plan_enter_surface_has_goal:
      commandResult.stdout.includes("目标: implement plan-mode skeleton"),
    plan_enter_surface_read_only_seen:
      commandResult.stdout.includes("确认计划前，plan mode 只会读取和规划。"),
    plan_enter_surface_working_notice_seen:
      commandResult.stdout.includes("正在规划..."),
    plan_enter_surface_hides_absolute_path:
      !commandResult.stdout.includes(`${workDir}/.grobot/plans`)
      && !commandResult.stdout.includes(activePlanPath),
    plan_status_preview_hides_required_placeholder:
      !commandResult.stdout.includes("__REQUIRED__"),
    plan_current_display_seen:
      commandResult.stdout.includes("当前计划")
      || commandResult.stdout.includes("计划草稿"),
    plan_current_display_has_plan_open_hint:
      commandResult.stdout.includes('使用 "/plan open" 编辑此计划')
      || commandResult.stdout.includes('"/plan open" 编辑草稿'),
    plan_status_uses_relative_plan_file:
      /^\.grobot\/plans\//m.test(commandResult.stdout),
    plan_status_hides_absolute_plan_file:
      !commandResult.stdout.includes(`${workDir}/.grobot/plans`)
      && !commandResult.stdout.includes(activePlanPath),
    plan_status_omits_legacy_next_line:
      !/^Next: /m.test(commandResult.stdout),
    plan_status_omits_legacy_focus_line:
      !/^Focus: /m.test(commandResult.stdout),
    plan_status_omits_quality_noise:
      !/^Quality: /m.test(commandResult.stdout)
      && !/^Guard: /m.test(commandResult.stdout),
    plan_status_hides_redundant_stored_state:
      !commandResult.stdout.includes("Stored state: drafting, drafting")
      && !commandResult.stdout.includes("Stored state:"),
    plan_status_avoids_duplicate_focus:
      commandResult.stdout.split("\n").filter((line) => line.startsWith("Focus: ")).length === 0,
    plan_status_avoids_duplicate_guard:
      commandResult.stdout.split("\n").filter((line) => line.startsWith("Guard: ")).length === 0,
    plan_status_next_line_avoids_reason_dump:
      !/^Next: .*quality guard=/m.test(commandResult.stdout)
      && !/^Next: .*质量分仅/m.test(commandResult.stdout),
    plan_last_status: planEntry && typeof planEntry.status === "string" ? planEntry.status : "",
    plan_last_review_fail_count: reviewFailCount,
    plan_last_blocked_count: blockedCount,
    events_has_plan_review_failed: eventsContent.includes("\"event\":\"plan_review_failed\""),
    events_has_plan_mode_cancelled: eventsContent.includes("\"event\":\"plan_mode_cancelled\""),
  };
}

export function runStartPlanConcurrencyFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    runShellScript,
    shellEscape,
    readJsonFileSafe,
    readTextFileSafe,
    sanitizePlanSessionSegment,
    countOccurrences,
  } = context;
  const appendAttempts = 8;
  const maxAttempts = 3;
  let lastPayload = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const workDir = createTempDir("grobot-plan-concurrency-work");
    const homeDir = createTempDir("grobot-plan-concurrency-home");
    const config = writeConfig(buildSmokeConfig(workDir));
    const subject = "plan-concurrency-user";
    const namespaceKey = `feishu:grobot:dm:${subject}`;
    const sessionId = sanitizePlanSessionSegment(namespaceKey);
    const baseArgs = [
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
    ];
    const seedResult = runCommand(repoRoot, [...baseArgs, "--message", "/plan concurrency lock smoke"]);
    const prefix = baseArgs.map(shellEscape).join(" ");
    const shellLines = [
      "set +e",
      "fail=0",
      "pids=''",
    ];
    for (let index = 1; index <= appendAttempts; index += 1) {
      const message = `none of these: concurrent-note-${String(index)}`;
      shellLines.push(`(${prefix} --message ${shellEscape(message)}) &`);
      shellLines.push("pids=\"$pids $!\"");
    }
    shellLines.push("for pid in $pids; do");
    shellLines.push("  wait \"$pid\" || fail=1");
    shellLines.push("done");
    shellLines.push("exit $fail");
    const parallelResult = runShellScript(repoRoot, shellLines.join("\n"));
    const planDir = `${workDir}/.grobot/plans/${sessionId}`;
    const planIndexPath = `${planDir}/index.json`;
    const planIndex = readJsonFileSafe(planIndexPath);
    const planEntries = planIndex && Array.isArray(planIndex.entries) ? planIndex.entries : [];
    const activePlanId = planIndex && typeof planIndex.active_plan_id === "string" ? planIndex.active_plan_id : "";
    const activeEntry = planEntries.find((item) => item && typeof item === "object" && item.plan_id === activePlanId) || null;
    const activePlanContent =
      activeEntry && typeof activeEntry.filename === "string"
        ? readTextFileSafe(`${planDir}/${activeEntry.filename}`)
        : "";
    const noteMatches = activePlanContent.match(/concurrent-note-\d+/g) ?? [];
    const uniqueNotes = Array.from(new Set(noteMatches));
    const eventsPath = `${planDir}/events.jsonl`;
    const eventsContent = readTextFileSafe(eventsPath);
    const combinedOutput = [
      seedResult.stdout,
      seedResult.stderr,
      parallelResult.stdout,
      parallelResult.stderr,
    ].join("\n");
    const lockTimeoutCount = countOccurrences(combinedOutput, "plan artifact lock timeout");
    const payload = {
      attempt,
      max_attempts: maxAttempts,
      seed_exit_code: seedResult.exit_code,
      parallel_exit_code: parallelResult.exit_code,
      append_attempts: appendAttempts,
      append_hits: uniqueNotes.length,
      plan_dir: planDir,
      plan_index_path: planIndexPath,
      events_path: eventsPath,
      events_count: eventsContent ? eventsContent.trim().split("\n").filter((line) => line.trim().length > 0).length : 0,
      lock_timeout_count: lockTimeoutCount,
      plan_entry_count: planEntries.length,
      active_plan_id: activePlanId,
      active_plan_status: activeEntry && typeof activeEntry.status === "string" ? activeEntry.status : "",
    };
    const passed =
      seedResult.exit_code === 0 &&
      parallelResult.exit_code === 0 &&
      payload.append_hits === payload.append_attempts &&
      payload.lock_timeout_count === 0;
    if (passed) {
      return {
        exit_code: 0,
        ...payload,
      };
    }
    lastPayload = payload;
  }
  if (!lastPayload) {
    return {
      exit_code: 1,
      seed_exit_code: 1,
      parallel_exit_code: 1,
      append_attempts: appendAttempts,
      append_hits: 0,
      events_count: 0,
      lock_timeout_count: 0,
      plan_entry_count: 0,
      active_plan_id: "",
      active_plan_status: "",
      attempt: maxAttempts,
      max_attempts: maxAttempts,
    };
  }
  return {
    exit_code: 1,
    ...lastPayload,
  };
}
