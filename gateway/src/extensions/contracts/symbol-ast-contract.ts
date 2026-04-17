import {
  extractTypeScriptAstSymbols,
  isTypeScriptAstRuntimeAvailable,
} from "../../tools/context/graph/symbol-ts-ast";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonArg(raw: string, argName: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON for ${argName}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`${argName} must be a JSON object`);
  }
  return parsed;
}

function parseArgs(argv: string[]): {
  command: string;
  options: Map<string, string>;
} {
  const command = argv[0] ?? "";
  if (!command) {
    throw new Error("missing command");
  }
  const options = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) {
      throw new Error(`unknown argument: ${token}`);
    }
    const value = argv[index + 1] ?? "";
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }
    options.set(token.slice(2), value);
    index += 1;
  }
  return { command, options };
}

function requireOption(options: Map<string, string>, key: string): string {
  const value = options.get(key);
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

function runCli(argv: string[]): number {
  const { command, options } = parseArgs(argv);
  const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
  switch (command) {
    case "extract": {
      const filePath = typeof payload.file_path === "string" ? payload.file_path : "sample.ts";
      const content = typeof payload.content === "string" ? payload.content : "";
      const symbols = extractTypeScriptAstSymbols(filePath, content);
      process.stdout.write(`${JSON.stringify({
        ast_runtime_available: isTypeScriptAstRuntimeAvailable(),
        symbols,
      })}\n`);
      return 0;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

const entryScript = process.argv[1] ?? "";
const shouldRun = entryScript.includes("symbol-ast-contract");
if (shouldRun) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`symbol-ast-contract fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}

export { runCli };
