import { runCiSummaryCli } from "./ci-summary/cli";

export { runCiSummaryCli } from "./ci-summary/cli";
export { renderHarnessCiSummaryMarkdown } from "./ci-summary/markdown";
export {
  buildHarnessCiSummary,
  computePolicyDriftActionHint,
  computePolicyDriftOwner,
  computePolicyDriftTransitionState,
  computeTrendActionHint,
  computeTrendDecisionSeverity,
  computeTrendDecisionTag,
  computeTrendOwner,
  normalizePolicyDriftReport,
} from "./ci-summary/normalizers";
export type {
  HarnessCiSummary,
  JsonObject,
  ParsedCliArgs,
  PolicyDriftSeverity,
  PolicyDriftSummary,
} from "./ci-summary/types";

try {
  process.exitCode = runCiSummaryCli(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`ci-summary fatal: ${String(error)}\n`);
  process.exitCode = 1;
}
