export const ASK_USER_INTERACTION_TITLE_LIMIT = 72;
export const ASK_USER_INTERACTION_QUESTION_LIMIT = 120;
export const ASK_USER_INTERACTION_OPTION_DESCRIPTION_LIMIT = 96;
export const ASK_USER_INTERACTION_NAV_LIMIT = 120;
export const ASK_USER_INTERACTION_TAB_LABEL_LIMIT = 18;
export const ASK_USER_INTERACTION_VISIBLE_OPTION_LIMIT = 7;
export const ASK_USER_OTHER_OPTION_ID = "__other__";
export const ASK_USER_OTHER_OPTION_LABEL = "Custom";
export const ASK_USER_OTHER_OPTION_PLACEHOLDER = "Type custom reply";

export type AskUserQuestionnaireMode = "question" | "review";
export type AskUserQuestionnaireOptionKind = "option" | "other";
export type AskUserQuestionnaireTextInputMode = "none" | "other" | "notes";

export interface AskUserQuestionnaireState {
  currentQuestionIndex: number;
  focusedOptionIndex: number;
  answers: Record<string, string>;
  notes: Record<string, string>;
  textInputValue: string;
  textInputMode: AskUserQuestionnaireTextInputMode;
  mode: AskUserQuestionnaireMode;
}

export type AskUserQuestionnaireAction =
  | { type: "previous_question"; totalCount: number }
  | { type: "next_question"; totalCount: number }
  | { type: "go_question"; index: number; totalCount: number }
  | { type: "previous_option"; optionCount: number }
  | { type: "next_option"; optionCount: number }
  | { type: "focus_option"; index: number; optionCount: number }
  | { type: "set_note"; askId: string; value: string }
  | {
    type: "set_answer";
    askId: string;
    answer: string;
    totalCount: number;
    shouldAdvance?: boolean;
  }
  | { type: "set_text_input_value"; value: string }
  | { type: "set_text_input_mode"; value: AskUserQuestionnaireTextInputMode }
  | { type: "go_review" }
  | { type: "reset_focus" };

export interface AskUserQuestionnaireTab {
  index: number;
  label: string;
  status: "current" | "answered" | "pending" | "submit";
}

export interface AskUserQuestionnaireOptionItem {
  id: string;
  label: string;
  description?: string;
  optionIndex: number;
  selected: boolean;
  kind: AskUserQuestionnaireOptionKind;
  placeholder?: string;
  inputValue?: string;
  sensitive?: boolean;
}

export interface AskUserQuestionnaireReviewItem {
  askId: string;
  question: string;
  answer?: string;
  isSecret?: boolean;
}

export type AskUserQuestionnaireView =
  | {
    kind: "empty";
    title: string;
    hint: string;
  }
  | {
    kind: "question";
    title: string;
    subtitle: string;
    question: string;
    navigationText: string;
    tabs: AskUserQuestionnaireTab[];
    optionItems: AskUserQuestionnaireOptionItem[];
    hint: string;
    queueHint: string;
    noteValue: string;
    textInputMode: AskUserQuestionnaireTextInputMode;
    isSecret: boolean;
    visibleOptionCount: number;
    activeOptionIndex: number;
    currentQuestionIndex: number;
    currentQuestionNumber: number;
    totalCount: number;
    answeredCount: number;
    defaultAnswer?: string;
  }
  | {
    kind: "review";
    title: string;
    navigationText: string;
    reviewItems: AskUserQuestionnaireReviewItem[];
    hint: string;
    totalCount: number;
    answeredCount: number;
    unansweredCount: number;
  };

export interface AskUserSelectMenuItemDescriptor {
  id: string;
  label: string;
  description?: string;
}

export interface AskUserSelectMenuDescriptor {
  title: string;
  subtitle: string;
  hint: string;
  items: AskUserSelectMenuItemDescriptor[];
  initialIndex: number;
  visibleOptionCount: number;
}

export type AskUserReviewActionId =
  | "__submit"
  | "__cancel"
  | `edit:${number}`;
