import { parseArgs, parseJsonArg, requireOption } from "./runtime-paths-contract/cli-args.mjs";
import {
  buildManagementStatusScenario,
  resolveExecutionPlaneConfigScenario
} from "./runtime-paths-contract/execution-plane.mjs";
import {
  runHooksDoctorScenario,
  runInitFallback,
  runInitHooksSamples
} from "./runtime-paths-contract/init-scenarios.mjs";
import {
  memoryImportInvalidSchemaScenario,
  memoryLifecycleScenario,
  memoryManagementOpsScenario,
  memoryQueryRestrictedScenario,
  memoryWriteReviewQueryScenario,
  resolveMemoryConfig
} from "./runtime-paths-contract/memory-scenarios.mjs";
import {
  resolveMcpRuntimeInvalid,
  resolveMcpRuntimeMerge
} from "./runtime-paths-contract/mcp-runtime.mjs";
import {
  persistMemoryLayersScenario,
  resolveRuntimePaths,
  resolveSessionStoreConfig
} from "./runtime-paths-contract/runtime-paths.mjs";
import {
  resolveWikiConfig,
  wikiIngestReviewApplyScenario,
  wikiLintScenario
} from "./runtime-paths-contract/wiki-scenarios.mjs";

function writeJsonLine(payload) {
  process.stdout.write(`${JSON.stringify(payload)}
`);
}

function readPayload(options) {
  return parseJsonArg(requireOption(options, "payload"), "--payload");
}

function runCli(argv) {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "resolve-runtime-paths": {
      writeJsonLine(resolveRuntimePaths(options));
      return 0;
    }
    case "resolve-session-store-config": {
      writeJsonLine(resolveSessionStoreConfig(readPayload(options)));
      return 0;
    }
    case "persist-memory-layers-scenario": {
      writeJsonLine(persistMemoryLayersScenario(readPayload(options)));
      return 0;
    }
    case "run-init-fallback": {
      writeJsonLine(runInitFallback(readPayload(options)));
      return 0;
    }
    case "run-init-hooks-samples": {
      writeJsonLine(runInitHooksSamples(readPayload(options)));
      return 0;
    }
    case "hooks-doctor-scenario": {
      writeJsonLine(runHooksDoctorScenario());
      return 0;
    }
    case "resolve-mcp-runtime-merge": {
      writeJsonLine(resolveMcpRuntimeMerge(readPayload(options)));
      return 0;
    }
    case "resolve-mcp-runtime-invalid": {
      writeJsonLine(resolveMcpRuntimeInvalid(readPayload(options)));
      return 0;
    }
    case "resolve-wiki-config": {
      writeJsonLine(resolveWikiConfig(readPayload(options)));
      return 0;
    }
    case "resolve-memory-config": {
      writeJsonLine(resolveMemoryConfig(readPayload(options)));
      return 0;
    }
    case "wiki-ingest-review-apply-scenario": {
      writeJsonLine(wikiIngestReviewApplyScenario(readPayload(options)));
      return 0;
    }
    case "wiki-lint-scenario": {
      writeJsonLine(wikiLintScenario(readPayload(options)));
      return 0;
    }
    case "resolve-execution-plane-config-scenario": {
      writeJsonLine(resolveExecutionPlaneConfigScenario(readPayload(options)));
      return 0;
    }
    case "build-management-status-scenario": {
      writeJsonLine(buildManagementStatusScenario(readPayload(options)));
      return 0;
    }
    case "memory-write-review-query-scenario": {
      writeJsonLine(memoryWriteReviewQueryScenario(readPayload(options)));
      return 0;
    }
    case "memory-query-restricted-scenario": {
      writeJsonLine(memoryQueryRestrictedScenario());
      return 0;
    }
    case "memory-import-invalid-schema-scenario": {
      writeJsonLine(memoryImportInvalidSchemaScenario());
      return 0;
    }
    case "memory-lifecycle-scenario": {
      writeJsonLine(memoryLifecycleScenario(readPayload(options)));
      return 0;
    }
    case "memory-management-ops-scenario": {
      writeJsonLine(memoryManagementOpsScenario(readPayload(options)));
      return 0;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

const entryScript = process.argv[1] ?? "";
const shouldRun = entryScript.includes("runtime-paths-contract");
if (shouldRun) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`runtime-paths-contract fatal: ${String(error)}
`);
    process.exitCode = 1;
  }
}

export {
  runCli
};
