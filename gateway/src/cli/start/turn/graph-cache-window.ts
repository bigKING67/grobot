import {
  appendGraphCacheWindowEntry,
  summarizeGraphHintQualityFromPrompt,
  type PromptCompactionStage,
} from "../../../tools/context";
import {
  diffGraphCacheCounter,
  readGraphCacheCounter,
} from "./graph-cache-stats";
import { nowIso } from "./time";

type GraphCacheStatsSnapshot = Record<string, {
  hit?: number;
  miss?: number;
  write?: number;
  evict?: number;
}>;

export function recordGraphCacheWindowEntry(input: {
  workDir: string;
  sessionKey: string;
  stage: PromptCompactionStage;
  selectionReason: "threshold" | "budget_guard";
  prompt: string;
  before: GraphCacheStatsSnapshot;
  after: GraphCacheStatsSnapshot;
}): string {
  const symbolQueryStatsBefore = readGraphCacheCounter(input.before, "symbol_query");
  const symbolDeclarationStatsBefore = readGraphCacheCounter(input.before, "symbol_declaration");
  const dependencyQueryStatsBefore = readGraphCacheCounter(input.before, "dependency_query");
  const dependencyImportStatsBefore = readGraphCacheCounter(input.before, "dependency_import");
  const symbolQueryStats = readGraphCacheCounter(input.after, "symbol_query");
  const symbolDeclarationStats = readGraphCacheCounter(input.after, "symbol_declaration");
  const dependencyQueryStats = readGraphCacheCounter(input.after, "dependency_query");
  const dependencyImportStats = readGraphCacheCounter(input.after, "dependency_import");
  const symbolQueryDeltaStats = diffGraphCacheCounter(symbolQueryStatsBefore, symbolQueryStats);
  const symbolDeclarationDeltaStats = diffGraphCacheCounter(
    symbolDeclarationStatsBefore,
    symbolDeclarationStats,
  );
  const dependencyQueryDeltaStats = diffGraphCacheCounter(
    dependencyQueryStatsBefore,
    dependencyQueryStats,
  );
  const dependencyImportDeltaStats = diffGraphCacheCounter(
    dependencyImportStatsBefore,
    dependencyImportStats,
  );
  const graphHintQuality = summarizeGraphHintQualityFromPrompt(input.prompt);

  appendGraphCacheWindowEntry({
    workDir: input.workDir,
    entry: {
      ts: nowIso(),
      sessionKey: input.sessionKey,
      stage: input.stage,
      selectionReason: input.selectionReason,
      delta: {
        symbolQuery: symbolQueryDeltaStats,
        symbolDeclaration: symbolDeclarationDeltaStats,
        dependencyQuery: dependencyQueryDeltaStats,
        dependencyImport: dependencyImportDeltaStats,
      },
      total: {
        symbolQuery: symbolQueryStats,
        symbolDeclaration: symbolDeclarationStats,
        dependencyQuery: dependencyQueryStats,
        dependencyImport: dependencyImportStats,
      },
      quality: graphHintQuality,
    },
  });

  return [
    "[context-engine]",
    "event=graph_cache_stats",
    `delta_symbol_query=${symbolQueryDeltaStats.hit}/${symbolQueryDeltaStats.miss}/${symbolQueryDeltaStats.write}/${symbolQueryDeltaStats.evict}`,
    `delta_symbol_decl=${symbolDeclarationDeltaStats.hit}/${symbolDeclarationDeltaStats.miss}/${symbolDeclarationDeltaStats.write}/${symbolDeclarationDeltaStats.evict}`,
    `delta_dependency_query=${dependencyQueryDeltaStats.hit}/${dependencyQueryDeltaStats.miss}/${dependencyQueryDeltaStats.write}/${dependencyQueryDeltaStats.evict}`,
    `delta_dependency_import=${dependencyImportDeltaStats.hit}/${dependencyImportDeltaStats.miss}/${dependencyImportDeltaStats.write}/${dependencyImportDeltaStats.evict}`,
    `total_symbol_query=${symbolQueryStats.hit}/${symbolQueryStats.miss}/${symbolQueryStats.write}/${symbolQueryStats.evict}`,
    `total_symbol_decl=${symbolDeclarationStats.hit}/${symbolDeclarationStats.miss}/${symbolDeclarationStats.write}/${symbolDeclarationStats.evict}`,
    `total_dependency_query=${dependencyQueryStats.hit}/${dependencyQueryStats.miss}/${dependencyQueryStats.write}/${dependencyQueryStats.evict}`,
    `total_dependency_import=${dependencyImportStats.hit}/${dependencyImportStats.miss}/${dependencyImportStats.write}/${dependencyImportStats.evict}`,
    `quality_dependency_rows=${String(graphHintQuality.dependency.rows)}`,
    `quality_dependency_max_depth=${String(graphHintQuality.dependency.maxChainDepth)}`,
    `quality_dependency_multi_hop_rows=${String(graphHintQuality.dependency.multiHopRows)}`,
    `quality_symbol_rows=${String(graphHintQuality.symbol.rows)}`,
    `quality_symbol_bridge_rows=${String(graphHintQuality.symbol.rowsWithBridge)}`,
    `quality_symbol_breadth_rows=${String(graphHintQuality.symbol.rowsWithBreadth)}`,
  ].join(" ") + "\n";
}
