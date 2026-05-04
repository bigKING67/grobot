import type { RuntimeAttachment } from "../../../../models/types";
import type { SessionPromptLayout } from "../../interactive/interactive-frame";

export const DEFAULT_SESSION_PROMPT = "❯ ";
export const INLINE_IMAGE_PARSE_PATTERN = /\[Image #(\d+)\]/g;
export const INLINE_IMAGE_RENDER_PATTERN = /\[Image #\d+\]/g;

export interface SessionInputLoopControls {
  withInputPaused<T>(operation: () => Promise<T>): Promise<T>;
}

export type SessionEscapeInterruptPhase = "idle" | "running";

export interface SessionInputLoopOptions {
  onEscapeInterrupt?: (phase: SessionEscapeInterruptPhase) => void | Promise<void>;
  getSlashSuggestions?: (input: string) => readonly SessionSlashSuggestion[];
  getInlineImageHighlightTheme?: () => "plain" | "nerd_font" | "ccline" | undefined;
  shouldSuppressSubmitTranscript?: (value: string) => boolean;
  openHistorySearch?: (input: {
    currentInput: string;
  }) => Promise<string | undefined>;
}

export type SessionInputPromptValue = string | SessionPromptLayout;

export type SessionInputPrompt = SessionInputPromptValue | (() => SessionInputPromptValue);

export interface SessionSlashSuggestion {
  command: string;
  description?: string;
  source?: string;
}

export interface MenuInputStream {
  isTTY?: boolean;
  setRawMode?: (enabled: boolean) => void;
  on?: (event: "data", listener: (chunk: string) => void) => void;
  off?: (event: "data", listener: (chunk: string) => void) => void;
  resume?: () => void;
  pause?: () => void;
  setEncoding?: (encoding: string) => void;
}

export interface KeypressPayload {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

export interface KeypressInputStream {
  on?: (event: "keypress", listener: (chunk: string, key: KeypressPayload) => void) => void;
  off?: (event: "keypress", listener: (chunk: string, key: KeypressPayload) => void) => void;
}

export interface SlashSuggestionApplyResult {
  command: string;
  submitImmediately: boolean;
}

export type SlashSuggestionKey = "enter" | "tab" | "escape";

export type SlashSuggestionKeyAction =
  | { kind: "noop" }
  | { kind: "hide_panel"; hiddenLineInput: string }
  | { kind: "apply"; appliedCommand: string; submitImmediately: boolean };

export type SubmitKeyAction = "submit" | "newline" | "none";

export type ShortcutOverlayKeyAction = "none" | "toggle_overlay" | "insert_text";

export type InputShortcutAction = "none" | "sigint" | "history_search";

export type TerminalLinePromptResult =
  | { kind: "submitted"; value: string }
  | { kind: "cancelled" };

export interface InlineAttachmentResolution {
  userInput: string;
  attachments: RuntimeAttachment[];
}

export type PromptInputTurnResult =
  | { kind: "submit"; value: string }
  | { kind: "sigint" };

export interface PromptInputTurnRuntime {
  resolvedPrompt: SessionPromptLayout;
  menuInput: MenuInputStream;
  keypressInput: KeypressInputStream;
  controls: SessionInputLoopControls;
  options: SessionInputLoopOptions;
  getPauseDepth(): number;
  getEscArmedAt(): number;
  setEscArmedAt(value: number): void;
  triggerEscInterrupt(phase: SessionEscapeInterruptPhase): void;
}

export interface InputLineDescriptor {
  start: number;
  end: number;
  text: string;
  textWidth: number;
  codeStart: number;
  codeEnd: number;
}
