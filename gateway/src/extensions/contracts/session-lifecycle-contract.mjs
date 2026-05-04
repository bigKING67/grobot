import {
  parseArgs,
  parseJsonArg,
  parseJsonArrayArg,
  requireOption,
  normalizeBool,
} from "./session-lifecycle-contract/shared.mjs";
import {
  buildSessionKey,
  prepareRegistry,
  runSessionRegistryFlow,
} from "./session-lifecycle-contract/session-registry.mjs";
import { buildContinueBridgeMessage } from "./session-lifecycle-contract/continue-bridge.mjs";
import { buildWikiContextBlock } from "./session-lifecycle-contract/wiki-context.mjs";
import { parseCliArgv } from "./session-lifecycle-contract/cli-args.mjs";
import { runInteractiveMemoryFlow } from "./session-lifecycle-contract/interactive-memory.mjs";

function runCli(argv) {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "build-session-key": {
      const projectName = requireOption(options, "project-name");
      const platform = requireOption(options, "platform");
      const scope = requireOption(options, "scope");
      const subject = requireOption(options, "subject");
      process.stdout.write(`${JSON.stringify({ session_key: buildSessionKey(projectName, platform, scope, subject) })}\n`);
      return 0;
    }
    case "session-registry-flow": {
      const root = requireOption(options, "root");
      const namespaceKey = requireOption(options, "namespace-key");
      process.stdout.write(`${JSON.stringify(runSessionRegistryFlow(root, namespaceKey))}\n`);
      return 0;
    }
    case "continue-bridge-message": {
      const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
      const bridge = buildContinueBridgeMessage(payload);
      process.stdout.write(`${JSON.stringify({ bridge })}\n`);
      return 0;
    }
    case "build-wiki-context": {
      const prompt = requireOption(options, "prompt");
      const projectWikiDir = requireOption(options, "project-wiki-dir");
      const globalWikiDir = requireOption(options, "global-wiki-dir");
      const sessionKey = requireOption(options, "session-key");
      const allowOrgShared = normalizeBool(requireOption(options, "allow-org-shared"));
      const block = buildWikiContextBlock(prompt, projectWikiDir, globalWikiDir, sessionKey, allowOrgShared);
      process.stdout.write(`${JSON.stringify({ block })}\n`);
      return 0;
    }
    case "parse-args": {
      const argvTokens = parseJsonArrayArg(requireOption(options, "argv"), "--argv");
      process.stdout.write(`${JSON.stringify(parseCliArgv(argvTokens))}\n`);
      return 0;
    }
    case "interactive-memory-flow": {
      const root = requireOption(options, "root");
      const sessionKey = requireOption(options, "session-key");
      process.stdout.write(`${JSON.stringify(runInteractiveMemoryFlow(root, sessionKey))}\n`);
      return 0;
    }
    case "prepare-registry": {
      const root = requireOption(options, "root");
      const namespaceKey = requireOption(options, "namespace-key");
      const sessionKey = requireOption(options, "session-key");
      process.stdout.write(`${JSON.stringify(prepareRegistry(root, namespaceKey, sessionKey))}\n`);
      return 0;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

const entryScript = process.argv[1] ?? "";
const shouldRun = entryScript.includes("session-lifecycle-contract");
if (shouldRun) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`session-lifecycle-contract fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}

export {
  runCli,
};
