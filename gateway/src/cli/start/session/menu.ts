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
      parts.push("current session · skip after select");
    } else if (input.mode === "resume") {
      parts.push("current session · resumed");
    } else {
      parts.push("current session");
    }
  }
  if (input.mode !== "sessions") {
    parts.push(`session ${input.sessionId}`);
  }
  parts.push(`updated ${formatSessionMenuUpdatedAt(input.updatedAt)}`);
  const summary = input.summary.trim();
  if (summary.length > 0) {
    parts.push(`summary ${summary}`);
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
  return normalized.length > 0 ? normalized : "unknown";
}

function resolveSessionMenuTitle(mode: SessionMenuMode): string {
  if (mode === "continue") {
    return "Continue from session";
  }
  if (mode === "resume") {
    return "Resume session";
  }
  if (mode === "rewind") {
    return "Rewind session";
  }
  if (mode === "sessions") {
    return "Sessions";
  }
  return "Switch session";
}

function resolveSessionMenuHint(mode: SessionMenuMode): string {
  if (mode === "continue") {
    return "↑/↓ select · Enter continue · Esc back";
  }
  if (mode === "resume") {
    return "↑/↓ select · Enter confirm · Esc back";
  }
  if (mode === "rewind") {
    return "↑/↓ select · Enter confirm · Esc back";
  }
  if (mode === "sessions") {
    return "↑/↓ select · Enter confirm · Esc back";
  }
  return "↑/↓ select · Enter confirm · Esc back";
}

function buildSessionMenuItems(input: {
  mode: SessionMenuMode;
  sessions: ReadonlyArray<RunStartSessionSummary>;
}): TerminalSelectMenuItem[] {
  const items: TerminalSelectMenuItem[] = [];
  if (input.mode === "sessions" || input.mode === "switch") {
    items.push({
      id: SESSION_MENU_NEW_ID,
      label: input.mode === "sessions" ? "New session" : "+ New session and switch",
      description: input.mode === "sessions"
        ? "Create a separate context."
        : "Create a new separate session context.",
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
    const activeLabel = active ? `current ${active.title || active.id}` : "no current session";
    return `${String(count)} sessions · ${activeLabel}`;
  }
  if (input.mode === "continue") {
    return `${String(count)} sessions · choose summary source`;
  }
  if (input.mode === "resume") {
    return `${String(count)} sessions · choose resume source`;
  }
  if (input.mode === "rewind") {
    return `${String(count)} sessions · choose rewind source`;
  }
  return `${String(count)} sessions · choose current context`;
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
    title: "Sessions",
    subtitle: active
      ? `${String(sessionCount)} sessions · current ${active.title || active.id}`
      : `${String(sessionCount)} sessions · no current session`,
    hint: "↑/↓ select · Enter confirm · Esc back",
    layout: "compact-vertical",
    visibleOptionCount: 6,
    items: [
      {
        id: "create",
        label: "New session",
        description: "Create a separate context.",
      },
      {
        id: "switch",
        label: "Switch session",
        description: "Use an existing session as the current context.",
      },
      {
        id: "resume",
        label: "Resume session",
        description: "Restore full history from the selected session.",
      },
      {
        id: "rewind",
        label: "Rewind session",
        description: "Restore conversation or code from a checkpoint.",
      },
      {
        id: "continue",
        label: "Continue summary",
        description: "Bridge an old session summary into the current session.",
      },
      {
        id: "overview",
        label: "Session overview",
        description: "Print list and metadata.",
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
