import { runCli } from "./hill-climb/cli";

export { runCli } from "./hill-climb/cli";
export { runHarness } from "./hill-climb/harness";

const entryScript = process.argv[1] ?? "";
const shouldRunCli = entryScript.includes("hill-climb");

if (shouldRunCli) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`hill-climb fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
