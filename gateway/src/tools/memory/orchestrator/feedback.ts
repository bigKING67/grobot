import type {
  CreateMemoryOrchestratorInput,
  MemoryOrchestratorFeedbackInput,
  MemoryOrchestratorFeedbackResult,
} from "./contract";
import {
  extractFirstUrl,
  nowIso,
} from "./utils";

export function processMemoryFeedback(
  input: CreateMemoryOrchestratorInput,
  request: MemoryOrchestratorFeedbackInput,
): MemoryOrchestratorFeedbackResult {
  const stderrEvents: string[] = [];
  if (request.type === "turn_success") {
    input.ga.registerTurnSuccess({
      sessionKey: request.sessionKey,
      userText: request.userText,
      assistantText: request.assistantText,
      traceId: request.traceId,
      providerName: request.providerName,
      verificationPass: request.verificationPass,
    });
    const publish = input.experience.registerTurnSuccess({
      sessionKey: request.sessionKey,
      userText: request.userText,
      assistantText: request.assistantText,
      traceId: request.traceId,
      providerName: request.providerName,
      verificationPass: request.verificationPass,
      evidenceRef: {
        traceId: request.traceId,
        runId: request.requestId,
        url: extractFirstUrl(request.userText),
        sourceType: "turn_success",
        capturedAt: nowIso(),
      },
    });
    if (publish.skipped) {
      stderrEvents.push(
        `[experience] event=publish_skipped reason=${publish.reason ?? "unknown"} gate_verification=${publish.verificationPassed ? "pass" : "fail"} gate_evidence_ref=${publish.evidenceRefPassed ? "pass" : "fail"} gate_redaction=${publish.redactionPassed ? "pass" : "fail"}\n`,
      );
    } else {
      stderrEvents.push(
        `[experience] event=published id=${publish.recordId ?? "<unknown>"} created=${publish.created ? "true" : "false"} confidence=${typeof publish.confidence === "number" ? publish.confidence.toFixed(2) : "n/a"} gate_verification=${publish.verificationPassed ? "pass" : "fail"} gate_evidence_ref=${publish.evidenceRefPassed ? "pass" : "fail"} gate_redaction=${publish.redactionPassed ? "pass" : "fail"}\n`,
      );
    }
    return {
      stderrEvents,
    };
  }
  if (request.type === "verification_failure") {
    const failure = input.experience.registerTurnFailure({
      sessionKey: request.sessionKey,
      userText: request.userText,
      providerName: request.providerName,
      errorClass: "verification_failed",
      errorMessage: request.errorMessage,
      failureStage: "verification",
    });
    if (failure.matched) {
      stderrEvents.push(
        `[experience] event=failure_feedback id=${failure.recordId ?? "<unknown>"} score=${typeof failure.score === "number" ? failure.score.toFixed(2) : "n/a"} confidence=${typeof failure.confidence === "number" ? failure.confidence.toFixed(2) : "n/a"} quarantined=${failure.quarantined ? "true" : "false"} conflict_isolated=${failure.conflictIsolated ? "true" : "false"}\n`,
      );
    }
    return {
      stderrEvents,
    };
  }
  input.ga.registerTurnFailure({
    sessionKey: request.sessionKey,
    providerName: request.providerName,
    errorClass: request.errorClass,
    errorMessage: request.errorMessage,
    traceId: request.traceId,
  });
  const failure = input.experience.registerTurnFailure({
    sessionKey: request.sessionKey,
    userText: request.userText,
    providerName: request.providerName,
    errorClass: request.errorClass,
    errorMessage: request.errorMessage,
    failureStage: request.failureStage,
    toolContext: request.toolContext,
  });
  if (failure.matched) {
    stderrEvents.push(
      `[experience] event=failure_feedback id=${failure.recordId ?? "<unknown>"} score=${typeof failure.score === "number" ? failure.score.toFixed(2) : "n/a"} confidence=${typeof failure.confidence === "number" ? failure.confidence.toFixed(2) : "n/a"} quarantined=${failure.quarantined ? "true" : "false"} conflict_isolated=${failure.conflictIsolated ? "true" : "false"}\n`,
    );
  }
  return {
    stderrEvents,
  };
}
