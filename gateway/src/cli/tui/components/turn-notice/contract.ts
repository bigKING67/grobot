export interface RuntimeFailureEntry {
  providerName: string;
  errorClass: string;
  errorMessage: string;
}

export interface RuntimeFailureSummaryInput {
  failures: readonly RuntimeFailureEntry[];
  orderedProviders: readonly { name: string }[];
}
