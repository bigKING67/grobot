import type { StatusLinePromptInput } from "../status-line/contract";

export interface BottomPanePromptInput extends StatusLinePromptInput {
  pendingAskCount?: number;
  pendingAskSummary?: string;
  queuedInputCount?: number;
  queuedInputPreview?: string;
  running?: boolean;
}
