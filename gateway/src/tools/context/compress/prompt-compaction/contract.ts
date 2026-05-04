export type PromptPreSendCompressionStep =
  | "recent_trim"
  | "snapshot_semantic_compress"
  | "snapshot_trim"
  | "head_trim";

export interface PromptPreSendCompressionPlan {
  strategy: "quality_first" | "hard_budget";
  overflowRatio: number;
  pressureScore: number;
  order: PromptPreSendCompressionStep[];
}

export interface PromptSemanticGenerationContext {
  available: boolean;
  warning?: string;
  technicalTerms: string[];
  topPaths: string[];
  evidencePaths: string[];
}
