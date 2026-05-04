import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  runContract,
} from "../harness.mjs";
import { runContextEngineCompressionContracts } from "./context-history-contracts/context-engine-compression-contracts.mjs";
import { runContextEngineConfigContracts } from "./context-history-contracts/context-engine-config-contracts.mjs";
import { runContextEnginePromptContracts } from "./context-history-contracts/context-engine-prompt-contracts.mjs";
import { runHistoryRetrievalConfigContracts } from "./context-history-contracts/retrieval-config-contracts.mjs";

function runHistoryTrimContract() {
  const historyCompactionResult = runContract("history-compaction-contract.mjs", "trim", [
    "--payload",
    JSON.stringify({
      history: [{ role: "user", content: "hello" }],
      max_turns: 3,
    }),
  ]);
  const historyCompactionPayload = parseJsonOutput("history-compaction-contract trim", historyCompactionResult.stdout);
  assert.equal(typeof historyCompactionPayload.header, "string");
  logStep("history-compaction-contract trim");
}

export async function runContextHistoryContracts() {
  runHistoryTrimContract();
  runHistoryRetrievalConfigContracts();
  runContextEngineConfigContracts();
  runContextEnginePromptContracts();
  runContextEngineCompressionContracts();
}
