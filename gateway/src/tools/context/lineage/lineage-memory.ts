export interface LineageSummaryRow {
  commitId: string;
  author?: string;
  timestamp?: string;
  summary: string;
}

/**
 * v1 placeholder for lineage retrieval.
 * The concrete commit indexing/summarization pipeline will populate this source.
 */
export function retrieveLineageSummaries(_query: string, _limit: number): LineageSummaryRow[] {
  return [];
}
