import { runCommandDispatchFlows } from "./session-interactive-dispatch-contract/command-flows";
import { runPendingAskDispatchFlows } from "./session-interactive-dispatch-contract/pending-ask-flows";
import { runRewindDispatchFlows } from "./session-interactive-dispatch-contract/rewind-flows";
import { runSessionDispatchFlows } from "./session-interactive-dispatch-contract/session-flows";

async function main(): Promise<void> {
  const payload = {
    ...(await runSessionDispatchFlows()),
    ...(await runRewindDispatchFlows()),
    ...(await runCommandDispatchFlows()),
    ...(await runPendingAskDispatchFlows()),
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

void main();
