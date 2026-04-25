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
  sessions_hint_has_ctrl_np: sessionMenu.hint.includes("Ctrl+n/p"),
  sessions_hint_has_number_direct: sessionMenu.hint.includes("number to select directly"),
  sessions_hint_has_enter_space: sessionMenu.hint.includes("Enter/Space"),
  sessions_hint_has_filter_shortcut: sessionMenu.hint.includes("/ or Ctrl+f"),
  switch_hint_has_ctrl_np: switchMenu.hint.includes("Ctrl+n/p"),
  continue_hint_has_ctrl_np: continueMenu.hint.includes("Ctrl+n/p"),
  resume_hint_has_ctrl_np: resumeMenu.hint.includes("Ctrl+n/p"),
  resume_hint_has_filter_shortcut: resumeMenu.hint.includes("/ or Ctrl+f"),
  rewind_hint_has_ctrl_np: rewindMenu.hint.includes("Ctrl+n/p"),
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
