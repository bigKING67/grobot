import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();

export function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

export function parseJsonFile(path: string): unknown {
  return JSON.parse(readRepoFile(path));
}

export interface RuntimeToolQualityRepoFiles {
  releaseGate: string;
  releaseQualityModule: string;
  statusCommand: string;
  statusQualityModule: string;
  statusQualityTextModule: string;
  statusQualityRegistry: string;
  releaseReportTest: string;
  startSmokeContract: string;
  startSmokeStatusRuntimeFlows: string;
  startSmokeStatusTsRustRuntimeToolsStatus: string;
  gatewayRuntimeToolAssertions: string;
  sharedContractsReadme: string;
  qualitySchema: unknown;
}

export function loadRuntimeToolQualityRepoFiles(): RuntimeToolQualityRepoFiles {
  return {
    releaseGate: readRepoFile("scripts/core-release-gate.sh"),
    releaseQualityModule: readRepoFile("scripts/lib/runtime-tool-quality-report.mjs"),
    statusCommand: readRepoFile("gateway/src/cli/status/run-status.ts"),
    statusQualityModule: readRepoFile("gateway/src/cli/status/runtime-tool-quality.ts"),
    statusQualityTextModule: readRepoFile("gateway/src/cli/status/runtime-tool-status-lines.ts"),
    statusQualityRegistry: readRepoFile("gateway/src/cli/status/runtime-tool-quality-registry.ts"),
    releaseReportTest: readRepoFile("scripts/test-runtime-tool-release-report.mjs"),
    startSmokeContract: readRepoFile("gateway/src/extensions/contracts/start-smoke-contract.mjs"),
    startSmokeStatusRuntimeFlows: readRepoFile("gateway/src/extensions/contracts/start-smoke-contract/status-runtime-flows.mjs"),
    startSmokeStatusTsRustRuntimeToolsStatus: readRepoFile(
      "gateway/src/extensions/contracts/start-smoke-contract/status-ts-rust-flow/runtime-tools-status.mjs",
    ),
    gatewayRuntimeToolAssertions: readRepoFile(
      "gateway/tests/check-gateway-node/runtime-smoke/status-surface/runtime-tool-assertions.mjs",
    ),
    sharedContractsReadme: readRepoFile("shared/contracts/README.md"),
    qualitySchema: parseJsonFile("shared/contracts/runtime-tool-quality-v1.json"),
  };
}
