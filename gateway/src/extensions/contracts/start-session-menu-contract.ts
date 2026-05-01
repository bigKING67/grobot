import { readFileSync } from "node:fs";
import { type RunStartSessionSummary } from "../../orchestration/entrypoints/dev-cli/start/run-start-session-ops";
import {
  buildSessionMenuViewModel,
  SESSION_MENU_NEW_ID,
} from "../../orchestration/entrypoints/dev-cli/start/run-start-session-menu";

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
  "gateway/src/orchestration/entrypoints/dev-cli/start/run-start-session-menu-ops.ts",
  "utf8",
);

const payload = {
  sessions_title: sessionMenu.title,
  switch_title: switchMenu.title,
  continue_title: continueMenu.title,
  resume_title: resumeMenu.title,
  rewind_title: rewindMenu.title,
  sessions_has_create_item: sessionMenu.items.some((item) => item.id === SESSION_MENU_NEW_ID),
  continue_has_create_item: continueMenu.items.some((item) => item.id === SESSION_MENU_NEW_ID),
  resume_has_create_item: resumeMenu.items.some((item) => item.id === SESSION_MENU_NEW_ID),
  rewind_has_create_item: rewindMenu.items.some((item) => item.id === SESSION_MENU_NEW_ID),
  sessions_hint: sessionMenu.hint,
  switch_hint: switchMenu.hint,
  continue_hint: continueMenu.hint,
  resume_hint: resumeMenu.hint,
  rewind_hint: rewindMenu.hint,
  sessions_summary_visible: sessionsBranchDescription.includes("summary: 品牌复盘并继续追踪转化漏斗"),
  switch_includes_session_key: switchBranchDescription.includes("feishu:grobot:dm:menu-contract-user:branch"),
  resume_includes_session_key: findDescriptionById(resumeMenu.items, "session-branch").includes(
    "feishu:grobot:dm:menu-contract-user:branch",
  ),
  rewind_includes_session_key: rewindBranchDescription.includes(
    "feishu:grobot:dm:menu-contract-user:branch",
  ),
  sessions_omits_session_key: !sessionsBranchDescription.includes("feishu:grobot:dm:menu-contract-user:branch"),
  continue_current_skip_hint: continueActiveDescription.includes("current session (selecting will skip)"),
  resume_current_hint: resumeActiveDescription.includes("current session (already resumed)"),
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
