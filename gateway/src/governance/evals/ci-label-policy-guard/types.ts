export type JsonObject = Record<string, unknown>;

export interface ParsedCliArgs {
  policies: string[];
  printJson: boolean;
}
