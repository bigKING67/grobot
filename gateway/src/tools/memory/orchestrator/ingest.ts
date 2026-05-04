import type {
  CreateMemoryOrchestratorInput,
  MemoryEventType,
  MemoryOrchestratorIngestInput,
  MemoryOrchestratorIngestResult,
} from "./contract";
import { normalizeText } from "./utils";

export function mapMemoryEventTypeToSourceEventType(eventType: MemoryEventType):
  | "turn_executed"
  | "tool_executed"
  | "checkpoint_updated"
  | "reflection_generated"
  | "ask_user_resolved" {
  if (eventType === "ask_user_resolved") {
    return "ask_user_resolved";
  }
  if (eventType === "tool_success") {
    return "tool_executed";
  }
  if (eventType === "turn_success") {
    return "turn_executed";
  }
  if (eventType === "manual_import") {
    return "reflection_generated";
  }
  return "checkpoint_updated";
}

export function ingestMemory(
  input: CreateMemoryOrchestratorInput,
  request: MemoryOrchestratorIngestInput,
): MemoryOrchestratorIngestResult {
  if (!input.ga.writeMemory) {
    return {
      accepted: false,
      reason: "ga_write_memory_unavailable",
      stderrEvents: [
        "[memory-orchestrator] event=ingest_skipped reason=ga_write_memory_unavailable\n",
      ],
    };
  }
  const normalizedText = normalizeText(request.text);
  if (!normalizedText) {
    return {
      accepted: false,
      reason: "empty_text",
      stderrEvents: [
        "[memory-orchestrator] event=ingest_skipped reason=empty_text\n",
      ],
    };
  }
  const writeResult = input.ga.writeMemory({
    sessionKey: request.sessionKey,
    memoryLevel: request.executionVerified ? "L2" : "L1",
    text: normalizedText,
    sourceEventType: mapMemoryEventTypeToSourceEventType(request.eventType),
    executionVerified: request.executionVerified,
    evidenceRef: request.evidenceRef,
    tags: request.tags,
    confidence: request.confidence,
  });
  if (!writeResult.ok) {
    return {
      accepted: false,
      reason: writeResult.code,
      stderrEvents: [
        `[memory-orchestrator] event=ingest_rejected reason=${writeResult.code} message=${writeResult.message ?? "<none>"}\n`,
      ],
    };
  }
  return {
    accepted: true,
    stderrEvents: [
      `[memory-orchestrator] event=ingest_accepted level=${writeResult.record?.memoryLevel ?? "<none>"} id=${writeResult.record?.id ?? "<none>"}\n`,
    ],
  };
}
