import type {
  AskUserEnvelope,
  AskUserQuestionnaireState,
} from "../../../../tools/ask-user";

export interface TerminalAskUserQuestionnairePanelInput {
  queue: readonly AskUserEnvelope[];
  initialState?: AskUserQuestionnaireState;
  terminalColumns?: number;
  planMode?: boolean;
  planFilePath?: string;
}

export type TerminalAskUserQuestionnairePanelResult =
  | {
    kind: "submitted";
    answers: Record<string, string>;
    notes: Record<string, string>;
    text: string;
  }
  | { kind: "chat" }
  | { kind: "cancelled" };

export type AskUserPanelInputAction =
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "left" }
  | { kind: "right" }
  | { kind: "tab" }
  | { kind: "notes" }
  | { kind: "chat" }
  | { kind: "skip" }
  | { kind: "enter" }
  | { kind: "backspace" }
  | { kind: "cancel" }
  | { kind: "select_index"; index: number }
  | { kind: "text"; value: string }
  | { kind: "submit_text"; value: string }
  | { kind: "ignore" };
