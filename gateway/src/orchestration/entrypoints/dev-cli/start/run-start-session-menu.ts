import { runTerminalSelectMenu, type TerminalSelectMenuItem } from "./run-start-io";
import { type RunStartSessionSummary } from "./run-start-session-ops";
import { type SessionMenuMode } from "./session-interactive";

export const SESSION_MENU_NEW_ID = "__new_session__";

export interface SessionMenuViewModel {
  title: string;
  subtitle: string;
  hint: string;
  items: TerminalSelectMenuItem[];
  initialIndex: number;
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
  parts.push(`id=${input.sessionId}`);
  parts.push(`updated ${input.updatedAt}`);
  if (input.mode !== "sessions") {
    parts.push(input.sessionKey);
  }
  if (input.active) {
    if (input.mode === "continue") {
      parts.push("current session (selecting will skip)");
    } else if (input.mode === "resume") {
      parts.push("current session (already resumed)");
    } else if (input.mode === "rewind") {
      parts.push("current session");
    } else {
      parts.push("current session");
    }
  }
  const summary = input.summary.trim();
  if (summary.length > 0) {
    parts.push(`summary: ${summary}`);
  }
  return parts.join(" | ");
}

function resolveSessionMenuTitle(mode: SessionMenuMode): string {
  if (mode === "continue") {
    return "Continue From Session";
  }
  if (mode === "resume") {
    return "Resume Session";
  }
  if (mode === "rewind") {
    return "Rewind Session";
  }
  if (mode === "sessions") {
    return "Session Manager";
  }
  return "Switch Session";
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
      label: "+ Create and switch to new session",
      description: "Create a fresh isolated session context.",
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
    subtitle: `Namespace: ${input.sessionNamespaceKey}`,
    hint: resolveSessionMenuHint(input.mode),
    items,
    initialIndex: resolveSessionMenuInitialIndex(items),
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
