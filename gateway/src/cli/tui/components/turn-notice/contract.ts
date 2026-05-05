export interface RuntimeFailureEntry {
  providerName: string;
  errorClass: string;
  errorMessage: string;
}

export interface RuntimeFailureSummaryInput {
  failures: readonly RuntimeFailureEntry[];
  orderedProviders: readonly { name: string }[];
  terminalColumns?: number;
}

export interface TurnNoticeViewModel {
  title: string;
  detail?: string;
  footerLines?: readonly string[];
  tone?: "accent" | "muted" | "info" | "planMode";
  interactiveMode: boolean;
  terminalColumns?: number;
}
