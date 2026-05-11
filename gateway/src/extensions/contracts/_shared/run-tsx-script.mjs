import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const TSX_PACKAGE = "tsx@4.20.6";
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

function localBin(cwd, name) {
  const binaryName = process.platform === "win32" ? `${name}.cmd` : name;
  const candidate = resolve(cwd, "node_modules", ".bin", binaryName);
  return existsSync(candidate) ? candidate : name;
}

export function buildTsxInvocation(scriptPath, args = [], options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const tsxBin = localBin(cwd, "tsx");
  if (tsxBin !== "tsx") {
    return {
      command: tsxBin,
      args: [scriptPath, ...args],
    };
  }
  return {
    command: "npx",
    args: ["--yes", "--package", TSX_PACKAGE, "tsx", scriptPath, ...args],
  };
}

export function spawnTsxSync(scriptPath, args = [], options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const invocation = buildTsxInvocation(scriptPath, args, { cwd });
  return spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    input: options.input,
    maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
}
