import { runTerminalSelectMenu } from "../../tui/components/select-menu/controller";
import {
  type TerminalSelectMenuInput,
  type TerminalSelectMenuItem,
  type TerminalSelectMenuLayout,
} from "../../tui/components/select-menu/contract";
import { type RunStartSessionSummary } from "./ops";
import { type SessionMenuMode } from "../session-interactive";

export const SESSION_MENU_NEW_ID = "__new_session__";

export interface SessionMenuViewModel {
  title: string;
  subtitle: string;
  hint: string;
  items: TerminalSelectMenuItem[];
  initialIndex: number;
  layout?: TerminalSelectMenuLayout;
  visibleOptionCount?: number;
}

export type SessionMenuSelection =
  | { kind: "cancelled" }
  | { kind: "new" }
  | { kind: "session"; sessionId: string };

type SelectMenuRunner = typeof runTerminalSelectMenu;

function formatSessionMenuDescription(input: {
  sessionId: string;
  sessionKey: string;
  updatedAt: string;
  summary: string;
  active: boolean;
  mode: SessionMenuMode;
}): string {
  const parts: string[] = [];
  if (input.active) {
    if (input.mode === "continue") {
      parts.push("当前会话 · 选择后跳过");
    } else if (input.mode === "resume") {
      parts.push("当前会话 · 已恢复");
    } else {
      parts.push("当前会话");
    }
  }
  if (input.mode !== "sessions") {
    parts.push(`会话 ${input.sessionId}`);
  }
  parts.push(`更新 ${formatSessionMenuUpdatedAt(input.updatedAt)}`);
  const summary = input.summary.trim();
  if (summary.length > 0) {
    parts.push(`重点 ${summary}`);
  }
  return parts.join(" · ");
}

function formatSessionMenuUpdatedAt(value: string): string {
  const normalized = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(normalized);
  if (isoMatch) {
    const [, year, month, day, hour, minute] = isoMatch;
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }
  return normalized.length > 0 ? normalized : "未知";
}

function resolveSessionMenuTitle(mode: SessionMenuMode): string {
  if (mode === "continue") {
    return "从会话继续";
  }
  if (mode === "resume") {
    return "恢复会话";
  }
  if (mode === "rewind") {
    return "回退会话";
  }
  if (mode === "sessions") {
    return "会话管理";
  }
  return "切换会话";
}

function resolveSessionMenuHint(mode: SessionMenuMode): string {
  if (mode === "continue") {
    return "↑/↓ 选择 · Enter 继续 · Esc 返回";
  }
  if (mode === "resume") {
    return "↑/↓ 选择 · Enter 确认 · Esc 返回";
  }
  if (mode === "rewind") {
    return "↑/↓ 选择 · Enter 确认 · Esc 返回";
  }
  if (mode === "sessions") {
    return "↑/↓ 选择 · Enter 确认 · Esc 返回";
  }
  return "↑/↓ 选择 · Enter 确认 · Esc 返回";
}

function buildSessionMenuItems(input: {
  mode: SessionMenuMode;
  sessions: ReadonlyArray<RunStartSessionSummary>;
}): TerminalSelectMenuItem[] {
  const items: TerminalSelectMenuItem[] = [];
  if (input.mode === "sessions" || input.mode === "switch") {
    items.push({
      id: SESSION_MENU_NEW_ID,
      label: input.mode === "sessions" ? "新建会话" : "+ 新建并切换到新会话",
      description: input.mode === "sessions"
        ? "创建新的独立上下文。"
        : "创建全新的独立会话上下文。",
    });
  }
  for (const session of input.sessions) {
    items.push({
      id: session.id,
      label: session.title,
      description: formatSessionMenuDescription({
        sessionId: session.id,
        sessionKey: session.sessionKey,
        updatedAt: session.updatedAt,
        summary: session.summary,
        active: session.active,
        mode: input.mode,
      }),
      current: session.active,
    });
  }
  return items;
}

function resolveSessionMenuSubtitle(input: {
  mode: SessionMenuMode;
  sessionNamespaceKey: string;
  sessions: ReadonlyArray<RunStartSessionSummary>;
}): string {
  const count = input.sessions.length;
  const active = input.sessions.find((session) => session.active);
  if (input.mode === "sessions") {
    const activeLabel = active ? `当前 ${active.title || active.id}` : "无当前会话";
    return `${String(count)} 个会话 · ${activeLabel}`;
  }
  if (input.mode === "continue") {
    return `${String(count)} 个会话 · 选择摘要来源`;
  }
  if (input.mode === "resume") {
    return `${String(count)} 个会话 · 选择恢复来源`;
  }
  if (input.mode === "rewind") {
    return `${String(count)} 个会话 · 选择回退来源`;
  }
  return `${String(count)} 个会话 · 选择当前上下文`;
}

function resolveSessionMenuInitialIndex(items: ReadonlyArray<TerminalSelectMenuItem>): number {
  const activeIndex = items.findIndex((item) => item.current);
  return activeIndex >= 0 ? activeIndex : 0;
}

export function buildSessionMenuViewModel(input: {
  mode: SessionMenuMode;
  sessionNamespaceKey: string;
  sessions: ReadonlyArray<RunStartSessionSummary>;
}): SessionMenuViewModel {
  const items = buildSessionMenuItems({
    mode: input.mode,
    sessions: input.sessions,
  });
  return {
    title: resolveSessionMenuTitle(input.mode),
    subtitle: resolveSessionMenuSubtitle(input),
    hint: resolveSessionMenuHint(input.mode),
    items,
    initialIndex: resolveSessionMenuInitialIndex(items),
    layout: input.mode === "sessions" ? "compact-vertical" : undefined,
    visibleOptionCount: input.mode === "sessions" ? 6 : undefined,
  };
}

export function buildSessionsHubMenuViewModel(input: {
  sessions: ReadonlyArray<RunStartSessionSummary>;
}): TerminalSelectMenuInput {
  const active = input.sessions.find((session) => session.active);
  const sessionCount = input.sessions.length;
  return {
    title: "会话",
    subtitle: active
      ? `${String(sessionCount)} 个会话 · 当前 ${active.title || active.id}`
      : `${String(sessionCount)} 个会话 · 尚无当前会话`,
    hint: "↑/↓ 选择 · Enter 确认 · Esc 返回",
    layout: "compact-vertical",
    visibleOptionCount: 6,
    items: [
      {
        id: "create",
        label: "新建会话",
        description: "创建新的独立上下文。",
      },
      {
        id: "switch",
        label: "切换会话",
        description: "选择已有会话作为当前上下文。",
      },
      {
        id: "resume",
        label: "恢复会话",
        description: "从完整历史恢复到选中会话。",
      },
      {
        id: "rewind",
        label: "回退会话",
        description: "选择检查点恢复对话或代码。",
      },
      {
        id: "continue",
        label: "继续摘要",
        description: "把旧会话摘要桥接到当前会话。",
      },
      {
        id: "overview",
        label: "会话概览",
        description: "打印列表和元数据。",
      },
    ],
  };
}

export async function runSessionMenuPicker(input: {
  mode: SessionMenuMode;
  sessionNamespaceKey: string;
  sessions: ReadonlyArray<RunStartSessionSummary>;
  withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>;
  runSelectMenu?: SelectMenuRunner;
}): Promise<SessionMenuSelection> {
  const menu = buildSessionMenuViewModel({
    mode: input.mode,
    sessionNamespaceKey: input.sessionNamespaceKey,
    sessions: input.sessions,
  });
  const runSelectMenu = input.runSelectMenu ?? runTerminalSelectMenu;
  const picked = await input.withInputPaused(() =>
    runSelectMenu({
      title: menu.title,
      subtitle: menu.subtitle,
      hint: menu.hint,
      items: menu.items,
      initialIndex: menu.initialIndex,
      layout: menu.layout,
      visibleOptionCount: menu.visibleOptionCount,
    }),
  );
  if (picked.kind === "cancelled") {
    return { kind: "cancelled" };
  }
  if (picked.item.id === SESSION_MENU_NEW_ID) {
    return { kind: "new" };
  }
  return {
    kind: "session",
    sessionId: picked.item.id,
  };
}
