import { rmSync } from "node:fs";
import { join } from "node:path";
import { runRuntimeToolActionCatalogContracts } from "./runtime-tool-events-contract/action-catalog";
import { runRuntimeToolEnvironmentRecoveryContracts } from "./runtime-tool-events-contract/environment-recovery";
import { runRuntimeToolMcpFeedbackContracts } from "./runtime-tool-events-contract/mcp-feedback";
import { runRuntimeToolMetricsAndRepeatContracts } from "./runtime-tool-events-contract/metrics-and-repeat";
import { runRuntimeToolStructuredFeedbackContracts } from "./runtime-tool-events-contract/structured-feedback";

const contractWorkDir = join(
  process.env.TMPDIR ?? "/tmp",
  `grobot-runtime-tool-events-${String(process.pid)}-${String(Date.now())}`,
);
process.on("exit", () => {
  rmSync(contractWorkDir, { recursive: true, force: true });
});

function contractPath(name: string): string {
  return join(contractWorkDir, name);
}

const {
  events,
  summary,
  knownRecoveryActions,
  missingActionSummary,
  legacyActionFeedback,
} = runRuntimeToolActionCatalogContracts({
  contractPath,
});

const {
  structuredRecoveryObservedAt,
  structuredFeedback,
  oversizedFeedback,
} = runRuntimeToolStructuredFeedbackContracts({
  contractPath,
});

runRuntimeToolMcpFeedbackContracts({
  contractPath,
  structuredRecoveryObservedAt,
});

runRuntimeToolEnvironmentRecoveryContracts({
  contractPath,
  structuredRecoveryObservedAt,
});

const contractResult = runRuntimeToolMetricsAndRepeatContracts({
  contractPath,
  events,
  summary,
  structuredFeedback,
  legacyActionFeedback,
  oversizedFeedback,
  knownRecoveryActions,
  missingActionSummary,
});
process.stdout.write(`${JSON.stringify(contractResult)}\n`);
