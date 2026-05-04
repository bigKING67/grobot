import { resolve } from "node:path";
import {
  runProviderConfigPassthrough,
  runProviderPoolLoadBalance,
  runToolCallDiagnosticEvents,
  runToolCallFailFast,
  runToolCallSuccess,
} from "./runtime-smoke-contract/basic-cases.mjs";
import {
  runMcpCallSuccess,
  runMcpCallTimeout,
  runMcpServersSuccess,
  runMcpSessionIdleReap,
} from "./runtime-smoke-contract/mcp-cases.mjs";
import {
  isObject,
  parseArgs,
  requireOption,
} from "./runtime-smoke-contract/helpers.mjs";

async function runCli(argv) {
  const { command, options } = parseArgs(argv);
  const repoRoot = resolve(requireOption(options, "repo-root"));
  let payload;
  switch (command) {
    case "provider-config-passthrough":
      payload = await runProviderConfigPassthrough(repoRoot);
      break;
    case "provider-pool-load-balance":
      payload = await runProviderPoolLoadBalance(repoRoot);
      break;
    case "tool-call-fail-fast":
      payload = await runToolCallFailFast(repoRoot);
      break;
    case "tool-call-success":
      payload = await runToolCallSuccess(repoRoot);
      break;
    case "tool-call-diagnostic-events":
      payload = await runToolCallDiagnosticEvents(repoRoot);
      break;
    case "mcp-call-success":
      payload = await runMcpCallSuccess(repoRoot);
      break;
    case "mcp-call-timeout":
      payload = await runMcpCallTimeout(repoRoot);
      break;
    case "mcp-session-idle-reap":
      payload = await runMcpSessionIdleReap(repoRoot);
      break;
    case "mcp-servers-success":
      payload = await runMcpServersSuccess(repoRoot);
      break;
    default:
      throw new Error(`unknown command: ${command}`);
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  return 0;
}

const entryScript = process.argv[1] ?? "";
const shouldRun = entryScript.includes("runtime-smoke-contract");

if (shouldRun) {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    const message = isObject(error) && typeof error.message === "string" ? error.message : String(error);
    process.stderr.write(`runtime-smoke-contract fatal: ${message}\n`);
    process.exitCode = 1;
  }
}
