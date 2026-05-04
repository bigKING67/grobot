import { consumeInterruptFlag } from "../../services/interrupt-store";
import { type AskUserTurnPromptContext, createAskUserTurnPromptContext, formatAskUserResolvedAnswerForPersistence } from "../../../tools/ask-user";
import { renderManagementInterruptNotice } from "../../tui/screens/turn-screen";
import { type CreateRunStartTurnRunnerInput, type RunStartTurnExecuteOptions } from "./contract";
import { parseSessionKeyPartsLoose } from "../session-registry";
import { type TurnHistoryRecorder } from "./history";

export interface RunStartPreTurnContinue {
  kind: "continue";
  sessionKey: string;
  parsedSession: NonNullable<ReturnType<typeof parseSessionKeyPartsLoose>>;
  askUserTurnContext: AskUserTurnPromptContext;
  turnUserText: string;
}

export interface RunStartPreTurnHandled {
  kind: "handled";
  exitCode: number;
}

export type RunStartPreTurnGateResult =
  | RunStartPreTurnContinue
  | RunStartPreTurnHandled;

export async function runStartPreTurnGate(input: {
  runnerInput: CreateRunStartTurnRunnerInput;
  userText: string;
  interactiveMode: boolean;
  options?: Pick<RunStartTurnExecuteOptions, "autoOpenAskUserPanel" | "onTurnRecorded">;
  recordTurn: TurnHistoryRecorder;
  writeTurnDiagnostic(message: string): void;
  writeTurnDiagnosticEvents(events: readonly string[]): void;
}): Promise<RunStartPreTurnGateResult> {
  const runnerInput = input.runnerInput;
  const sessionKey = runnerInput.getSessionKey();
  runnerInput.gaMechanismRuntime.hydrateSession(
    sessionKey,
    runnerInput.getGaState(),
  );
  const parsedSession = parseSessionKeyPartsLoose(sessionKey);
  if (!parsedSession) {
    const gaState = runnerInput.gaMechanismRuntime.snapshotSession(sessionKey);
    runnerInput.setGaState(gaState);
    runnerInput.updateActiveSessionGaState(gaState);
    await runnerInput.persistSessionRegistryState();
    runnerInput.writeStderr(`error: invalid active session key: ${sessionKey}\n`);
    return { kind: "handled", exitCode: 1 };
  }
  const askUserTurnContext = createAskUserTurnPromptContext({
    runtime: runnerInput.gaMechanismRuntime,
    sessionKey,
    userText: input.userText,
  });
  const turnUserText = askUserTurnContext.safeUserText;
  if (askUserTurnContext.hasSecretAnswers) {
    input.writeTurnDiagnostic(
      `[ask-user] event=secret_answer_redacted count=${String(askUserTurnContext.secretAnswerCount)} surfaces=history,memory,logs\n`,
    );
  }
  runnerInput.touchActiveSession(turnUserText);
  if (consumeInterruptFlag(runnerInput.interruptStorePath, sessionKey)) {
    runnerInput.writeStdout(
      renderManagementInterruptNotice(input.interactiveMode),
    );
    return { kind: "handled", exitCode: 0 };
  }
  if (askUserTurnContext.resolvedEvent.length > 0) {
    input.writeTurnDiagnostic(askUserTurnContext.resolvedEvent);
    for (const resolvedAsk of askUserTurnContext.resolvedAsks) {
      const safeAnswer = formatAskUserResolvedAnswerForPersistence(resolvedAsk);
      const ingestResult = runnerInput.memoryOrchestrator.ingest({
        eventType: "ask_user_resolved",
        sessionKey,
        text: `[ask-user-resolved] question=${resolvedAsk.envelope.question} answer=${safeAnswer} blocking_node=${resolvedAsk.envelope.blockingNodeId}`,
        executionVerified: true,
        evidenceRef: {
          source: `ask_user:${resolvedAsk.envelope.askId}`,
        },
        tags: ["ask_user", "clarification"],
        confidence: 0.82,
      });
      input.writeTurnDiagnosticEvents(ingestResult.stderrEvents);
    }
  }
  if (askUserTurnContext.pendingNextAsk) {
    const activeAskEnvelope = askUserTurnContext.pendingNextAsk;
    const queueDepth = askUserTurnContext.queueSizeAfterResolve;
    const askUserDisplay = input.interactiveMode
      ? input.options?.autoOpenAskUserPanel
        ? ""
        : "需要你的输入 · Enter 打开选择\n\n"
      : runnerInput.gaMechanismRuntime.buildAskUserDisplay(activeAskEnvelope);
    await input.recordTurn({
      userText: turnUserText,
      assistantText: `需要确认：${activeAskEnvelope.question}`,
      stickyProvider: runnerInput.getStickyProvider(),
      providerRuntimeStates: runnerInput.getProviderRuntimeStates(),
      onTurnRecorded: input.options?.onTurnRecorded,
    });
    runnerInput.writeStdout(askUserDisplay);
    input.writeTurnDiagnostic(
      `[ask-user] event=awaiting_more_answers remaining=${String(queueDepth)} active_ask_id=${activeAskEnvelope.askId}\n`,
    );
    input.writeTurnDiagnostic(
      "[experience] event=publish_skipped reason=ask_user_pending_followup\n",
    );
    return { kind: "handled", exitCode: 0 };
  }

  return {
    kind: "continue",
    sessionKey,
    parsedSession,
    askUserTurnContext,
    turnUserText,
  };
}
