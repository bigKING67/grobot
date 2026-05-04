import { runAdaptivePolicyContracts } from "./context-prompt-quality-contracts/adaptive-policy.mjs";
import { runAdaptiveSequenceContracts } from "./context-prompt-quality-contracts/adaptive-sequence.mjs";
import { runPreSendCompressionPlanContracts } from "./context-prompt-quality-contracts/pre-send-compression-plan.mjs";
import { runPromptQualityGuardContracts } from "./context-prompt-quality-contracts/prompt-quality-guard.mjs";
import { runPromptQualityWindowContract } from "./context-prompt-quality-contracts/prompt-quality-window.mjs";

export async function runContextPromptQualityContracts() {
  runPromptQualityWindowContract();
  runPromptQualityGuardContracts();
  runAdaptivePolicyContracts();
  runAdaptiveSequenceContracts();
  runPreSendCompressionPlanContracts();
}
