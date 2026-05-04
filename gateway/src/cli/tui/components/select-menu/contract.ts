import type { CliEnv } from "../../kernel/render-mode";

export interface TerminalSelectMenuItem {
  id: string;
  label: string;
  description?: string;
  current?: boolean;
  input?: {
    placeholder?: string;
    initialValue?: string;
    allowEmptySubmitToCancel?: boolean;
    showLabelWithValue?: boolean;
    labelValueSeparator?: string;
    resetCursorOnUpdate?: boolean;
  };
  inputValue?: string;
  inputActive?: boolean;
}

export interface TerminalSelectMenuModelPickerMeta {
  providerName: string;
  currentModel?: string;
  startupModel?: string;
  totalModelCount?: number;
  sessionId?: string;
  sessionTitle?: string;
  sessionSummary?: string;
}

export interface TerminalSelectMenuPlanApprovalMeta {
  planContent: string;
  planPath?: string;
  agentName?: string;
  editorName?: string;
  planEdited?: boolean;
  emptyPlan?: boolean;
}

export interface TerminalSelectMenuViewport {
  startIndex: number;
  visibleCount: number;
  totalCount: number;
}

export type TerminalSelectMenuLayout = "compact" | "expanded" | "compact-vertical";

export interface TerminalSelectMenuInput {
  title: string;
  subtitle?: string;
  hint?: string;
  items: TerminalSelectMenuItem[];
  initialIndex?: number;
  visibleOptionCount?: number;
  hideIndexes?: boolean;
  layout?: TerminalSelectMenuLayout;
  inlineDescriptions?: boolean;
  viewport?: TerminalSelectMenuViewport;
  variant?: "default" | "model_picker" | "ask_user" | "plan_approval";
  modelPickerMeta?: TerminalSelectMenuModelPickerMeta;
  planApprovalMeta?: TerminalSelectMenuPlanApprovalMeta;
}

export type TerminalSelectMenuResult =
  | { kind: "selected"; item: TerminalSelectMenuItem; index: number; inputValue?: string }
  | { kind: "edit_plan"; item: TerminalSelectMenuItem; index: number; inputValue?: string }
  | { kind: "cancelled" };

export type TerminalSelectMenuInputAction =
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "page_up" }
  | { kind: "page_down" }
  | { kind: "enter" }
  | { kind: "edit_plan" }
  | { kind: "cancel" }
  | { kind: "ignore" }
  | { kind: "select_index"; index: number };

export type TerminalSelectMenuInlineInputReduction =
  | { kind: "ignored" }
  | { kind: "activate"; value: string }
  | { kind: "update"; value: string }
  | { kind: "exit_input"; value: string }
  | { kind: "submit"; value: string }
  | { kind: "edit_plan"; value: string };

export interface TerminalSelectMenuViewportResolution {
  startIndex: number;
  endIndex: number;
  visibleCount: number;
  totalCount: number;
  activeIndex: number;
}

export interface RenderTerminalSelectMenuInput {
  menu: TerminalSelectMenuInput;
  activeIndex: number;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  env?: CliEnv;
}
