export type JsonObject = Record<string, unknown>;

export interface TracePipelineArgs {
  policyPath: string | null;
  sessionsDir: string;
  traceCasesOutput: string;
  traceRunsOutput: string;
  variant: string;
  holdoutRatio: number;
  seed: number;
  maxCases: number;
  minChars: number;
  cleanCasesOutput: string;
  cleanRunsOutput: string;
  cleanReportOutput: string;
  minPromptChars: number;
  minResponseChars: number;
  maxExactDuplicatesPerPrompt: number;
  similarityThreshold: number;
  maxNearDuplicatesPerAnchor: number;
  minCasesPerSplit: number;
  minCleanCases: number;
  failOnLowSample: boolean;
  minCleanCasesBySplitRaw: unknown;
  failOnSplitUnderflow: boolean;
  whitelistCaseIdsFile: string | null;
  dryValidateOnly: boolean;
  printJson: boolean;
  policyProfile: string | null;
  policySchemaVersion: number | null;
}

export interface ParsedCliArgs {
  args: TracePipelineArgs;
  splitThresholds: Record<string, number>;
}

export interface SampleGuardSplitResult {
  required: number;
  actual: number;
  pass: boolean;
}
