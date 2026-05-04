import { runCoreContracts } from "./gateway-contract-smoke/core-contracts.mjs";
import { runSessionContracts } from "./gateway-contract-smoke/session-contracts.mjs";
import { runPlanCommandContracts } from "./gateway-contract-smoke/plan-command-contracts.mjs";
import { runTuiContracts } from "./gateway-contract-smoke/tui-contracts.mjs";
import { runMemoryContracts } from "./gateway-contract-smoke/memory-contracts.mjs";
import { runContextHistoryContracts } from "./gateway-contract-smoke/context-history-contracts.mjs";
import { runContextPromptQualityContracts } from "./gateway-contract-smoke/context-prompt-quality-contracts.mjs";
import { runContextGraphContracts } from "./gateway-contract-smoke/context-graph-contracts.mjs";
import { runAstHandoffContracts } from "./gateway-contract-smoke/ast-handoff-contracts.mjs";

export async function runGatewayContractSmoke() {
  await runCoreContracts();
  await runSessionContracts();
  await runPlanCommandContracts();
  await runTuiContracts();
  await runMemoryContracts();
  await runContextHistoryContracts();
  await runContextPromptQualityContracts();
  await runContextGraphContracts();
  await runAstHandoffContracts();
}
