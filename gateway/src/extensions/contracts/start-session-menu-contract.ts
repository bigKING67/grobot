import { readFileSync } from "node:fs";
import { type RunStartSessionSummary } from "../../cli/start/session/ops";
import {
  buildSessionsHubMenuViewModel,
  buildSessionMenuViewModel,
  SESSION_MENU_NEW_ID,
} from "../../cli/start/session/menu";
import { buildCheckpointSummaryText } from "../../cli/start/rewind-store/summary";

function findDescriptionById(
  rows: ReadonlyArray<{ id: string; description?: string }>,
  id: string,
): string {
  const row = rows.find((item) => item.id === id);
  return typeof row?.description === "string" ? row.description : "";
}

const sessions: RunStartSessionSummary[] = [
  {
    id: "session-main",
    title: "Main Session",
    summary: "当前主会话上下文",
    sessionKey: "feishu:grobot:dm:menu-contract-user",
    updatedAt: "2026-04-14T10:30:00.000Z",
    active: true,
  },
  {
    id: "session-branch",
    title: "Campaign Growth Plan",
    summary: "品牌复盘并继续追踪转化漏斗",
    sessionKey: "feishu:grobot:dm:menu-contract-user:branch",
    updatedAt: "2026-04-14T09:30:00.000Z",
    active: false,
  },
];

const namespace = "feishu:grobot:dm:menu-contract-user";
const sessionMenu = buildSessionMenuViewModel({
  mode: "sessions",
  sessionNamespaceKey: namespace,
  sessions,
});
const sessionsHubMenu = buildSessionsHubMenuViewModel({
  sessions,
});
const switchMenu = buildSessionMenuViewModel({
  mode: "switch",
  sessionNamespaceKey: namespace,
  sessions,
});
const continueMenu = buildSessionMenuViewModel({
  mode: "continue",
  sessionNamespaceKey: namespace,
  sessions,
});
const resumeMenu = buildSessionMenuViewModel({
  mode: "resume",
  sessionNamespaceKey: namespace,
  sessions,
});
const rewindMenu = buildSessionMenuViewModel({
  mode: "rewind",
  sessionNamespaceKey: namespace,
  sessions,
});

const switchBranchDescription = findDescriptionById(switchMenu.items, "session-branch");
const sessionsBranchDescription = findDescriptionById(sessionMenu.items, "session-branch");
const continueActiveDescription = findDescriptionById(continueMenu.items, "session-main");
const resumeActiveDescription = findDescriptionById(resumeMenu.items, "session-main");
const rewindBranchDescription = findDescriptionById(rewindMenu.items, "session-branch");
const allHints = [
  sessionMenu.hint,
  switchMenu.hint,
  continueMenu.hint,
  resumeMenu.hint,
  rewindMenu.hint,
];
const sessionMenuOpsSource = readFileSync(
  "gateway/src/cli/start/session/menu-ops.ts",
  "utf8",
);
const sessionOpsSource = readFileSync(
  "gateway/src/cli/start/session/ops.ts",
  "utf8",
);
const rewindStoreSource = readFileSync(
  "gateway/src/cli/start/rewind-store.ts",
  "utf8",
);
const rewindStoreSummarySource = readFileSync(
  "gateway/src/cli/start/rewind-store/summary.ts",
  "utf8",
);
const startupSessionActionsSource = readFileSync(
  "gateway/src/cli/start/startup/session-actions.ts",
  "utf8",
);
const checkpointSummaryText = buildCheckpointSummaryText("session-main", [
  {
    checkpointId: "checkpoint-a",
    createdAt: "2026-04-14T10:10:00.000Z",
    userText: "用户提出需要恢复到精修前状态",
    assistantText: "助手执行了检查点恢复前的总结",
    historyBeforeCount: 12,
    historyAfterCount: 14,
    changedFilesCount: 2,
  },
]);
const scopedCheckpointSummaryText = buildCheckpointSummaryText(
  "feishu:grobot:dm:menu-contract-user__s_session-branch",
  [],
);

const payload = {
  sessions_title: sessionMenu.title,
  switch_title: switchMenu.title,
  continue_title: continueMenu.title,
  resume_title: resumeMenu.title,
  rewind_title: rewindMenu.title,
  sessions_has_create_item: sessionMenu.items.some((item) => item.id === SESSION_MENU_NEW_ID),
  sessions_create_label: sessionMenu.items.find((item) => item.id === SESSION_MENU_NEW_ID)?.label,
  switch_create_label: switchMenu.items.find((item) => item.id === SESSION_MENU_NEW_ID)?.label,
  continue_has_create_item: continueMenu.items.some((item) => item.id === SESSION_MENU_NEW_ID),
  resume_has_create_item: resumeMenu.items.some((item) => item.id === SESSION_MENU_NEW_ID),
  rewind_has_create_item: rewindMenu.items.some((item) => item.id === SESSION_MENU_NEW_ID),
  sessions_hint: sessionMenu.hint,
  sessions_subtitle: sessionMenu.subtitle,
  sessions_layout: sessionMenu.layout,
  sessions_visible_option_count: sessionMenu.visibleOptionCount,
  sessions_hub_title: sessionsHubMenu.title,
  sessions_hub_subtitle: sessionsHubMenu.subtitle,
  sessions_hub_layout: sessionsHubMenu.layout,
  sessions_hub_visible_option_count: sessionsHubMenu.visibleOptionCount,
  sessions_hub_item_count: sessionsHubMenu.items.length,
  sessions_hub_labels: sessionsHubMenu.items.map((item) => item.label),
  switch_hint: switchMenu.hint,
  switch_subtitle: switchMenu.subtitle,
  continue_hint: continueMenu.hint,
  continue_subtitle: continueMenu.subtitle,
  resume_hint: resumeMenu.hint,
  resume_subtitle: resumeMenu.subtitle,
  rewind_hint: rewindMenu.hint,
  rewind_subtitle: rewindMenu.subtitle,
  sessions_summary_visible: sessionsBranchDescription.includes("重点 品牌复盘并继续追踪转化漏斗"),
  session_descriptions_omit_full_session_key:
    !sessionsBranchDescription.includes("feishu:grobot:dm:menu-contract-user:branch")
    && !switchBranchDescription.includes("feishu:grobot:dm:menu-contract-user:branch")
    && !findDescriptionById(resumeMenu.items, "session-branch").includes(
      "feishu:grobot:dm:menu-contract-user:branch",
    )
    && !rewindBranchDescription.includes("feishu:grobot:dm:menu-contract-user:branch"),
  session_descriptions_avoid_machine_id_label:
    !sessionsBranchDescription.includes("id session-branch")
    && !switchBranchDescription.includes("id session-branch")
    && !findDescriptionById(resumeMenu.items, "session-branch").includes("id session-branch")
    && !rewindBranchDescription.includes("id session-branch")
    && switchBranchDescription.includes("会话 session-branch")
    && findDescriptionById(resumeMenu.items, "session-branch").includes("会话 session-branch")
    && rewindBranchDescription.includes("会话 session-branch"),
  sessions_omits_raw_iso_timestamp: !sessionsBranchDescription.includes("T09:30:00.000Z"),
  sessions_uses_compact_timestamp: sessionsBranchDescription.includes("更新 2026-04-14 09:30"),
  sessions_descriptions_avoid_pipe_table_style:
    !sessionsBranchDescription.includes(" | ")
    && !switchBranchDescription.includes(" | ")
    && switchBranchDescription.includes(" · "),
  sessions_has_low_noise_subtitle:
    sessionMenu.subtitle === "2 个会话 · 当前 Main Session",
  sessions_create_label_is_reference_compact:
    sessionMenu.items.find((item) => item.id === SESSION_MENU_NEW_ID)?.label === "新建会话",
  switch_keeps_explicit_create_label:
    switchMenu.items.find((item) => item.id === SESSION_MENU_NEW_ID)?.label === "+ 新建并切换到新会话",
  sessions_hub_uses_reference_labels:
    sessionsHubMenu.items.some((item) => item.label === "新建会话")
    && sessionsHubMenu.items.some((item) => item.label === "继续摘要")
    && !sessionsHubMenu.items.some((item) => item.label.includes("并切换到")),
  continue_current_skip_hint: continueActiveDescription.includes("当前会话 · 选择后跳过"),
  resume_current_hint: resumeActiveDescription.includes("当前会话 · 已恢复"),
  sessions_hint_is_reference_compact: sessionMenu.hint === "↑/↓ 选择 · Enter 确认 · Esc 返回",
  switch_hint_is_reference_compact: switchMenu.hint === "↑/↓ 选择 · Enter 确认 · Esc 返回",
  continue_hint_is_reference_continue: continueMenu.hint === "↑/↓ 选择 · Enter 继续 · Esc 返回",
  resume_hint_is_reference_compact: resumeMenu.hint === "↑/↓ 选择 · Enter 确认 · Esc 返回",
  rewind_hint_is_reference_compact: rewindMenu.hint === "↑/↓ 选择 · Enter 确认 · Esc 返回",
  session_hints_omit_secondary_key_chords: allHints.every((hint) =>
    !hint.includes("Ctrl+n/p")
    && !hint.includes("number to select directly")
    && !hint.includes("Enter/Space")
    && !hint.includes("/ or Ctrl+f")
    && !hint.includes("Esc to cancel")
  ),
  session_menu_ops_cancel_is_silent_source:
    !sessionMenuOpsSource.includes("[session] menu cancelled")
    && !sessionMenuOpsSource.includes("[session] picker cancelled")
    && !sessionMenuOpsSource.includes("[rewind] picker cancelled")
    && !sessionMenuOpsSource.includes("selection cancelled")
    && !sessionMenuOpsSource.includes("file filter input cancelled"),
  session_menu_ops_rewind_surface_avoids_legacy_marker:
    !sessionMenuOpsSource.includes("[rewind]"),
  session_menu_ops_rewind_file_filter_prompt_is_human:
    sessionMenuOpsSource.includes("文件过滤（可选，逗号分隔）> ")
    && !sessionMenuOpsSource.includes("[rewind] 文件过滤"),
  session_menu_ops_rewind_checkpoint_description_is_reference_style:
    sessionMenuOpsSource.includes("个文件 · 消息")
    && sessionMenuOpsSource.includes("· 用户 ")
    && !sessionMenuOpsSource.includes(" | 文件="),
  session_ops_rewind_surface_avoids_legacy_marker:
    !sessionOpsSource.includes("[rewind]"),
  session_ops_overview_surface_is_reference_style:
    sessionOpsSource.includes("subtitle: active")
    && sessionOpsSource.includes("重点 ${record.summary}")
    && sessionOpsSource.includes("formatSessionUpdatedAtForDisplay(record.updatedAt)")
    && !sessionOpsSource.includes("${record.id} | ${record.title}"),
  session_ops_overview_avoids_raw_session_table:
    !sessionOpsSource.includes("`${marker} ${record.id} · ${record.title} · ${record.updatedAt}\\n`")
    && !sessionOpsSource.includes("⎿  摘要")
    && !sessionOpsSource.includes("数量 ${String(sessions.length)}"),
  rewind_store_summary_avoids_legacy_marker:
    !rewindStoreSource.includes("[rewind]"),
  rewind_store_summary_surface_is_reference_style:
    checkpointSummaryText.includes("• 会话 session-main")
    && checkpointSummaryText.includes("⎿  检查点 1")
    && checkpointSummaryText.includes("2026-04-14 10:10 · 2 个文件 · 消息 12->14")
    && !checkpointSummaryText.includes("2026-04-14T10:10:00.000Z")
    && checkpointSummaryText.includes("⎿  用户 用户提出需要恢复到精修前状态")
    && checkpointSummaryText.includes("⎿  助手 助手执行了检查点恢复前的总结")
    && !checkpointSummaryText.includes("会话:")
    && !checkpointSummaryText.includes("检查点:")
    && !checkpointSummaryText.includes(" | 文件=")
    && !checkpointSummaryText.includes("用户=")
    && !checkpointSummaryText.includes("助手=")
    && !rewindStoreSummarySource.includes(" | 文件=")
    && !rewindStoreSummarySource.includes("用户="),
  rewind_store_summary_hides_raw_namespace:
    scopedCheckpointSummaryText.includes("• 会话 session-branch")
    && !scopedCheckpointSummaryText.includes("feishu:grobot:dm:menu-contract-user"),
  startup_session_actions_rewind_picker_description_is_reference_style:
    startupSessionActionsSource.includes(" 个文件 · 用户 ")
    && startupSessionActionsSource.includes(" · 助手 ")
    && !startupSessionActionsSource.includes(" | 文件=")
    && !startupSessionActionsSource.includes(" | 用户=")
    && !startupSessionActionsSource.includes(" | 助手="),
  sessions_initial_index: sessionMenu.initialIndex,
  switch_initial_index: switchMenu.initialIndex,
  continue_initial_index: continueMenu.initialIndex,
  resume_initial_index: resumeMenu.initialIndex,
  rewind_initial_index: rewindMenu.initialIndex,
  sessions_item_count: sessionMenu.items.length,
  continue_item_count: continueMenu.items.length,
  resume_item_count: resumeMenu.items.length,
  rewind_item_count: rewindMenu.items.length,
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
