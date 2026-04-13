import { type ExecutionPlaneConfig } from "../../../execution-plane";
import { runGatewayTurn } from "../../../main";
import { consumeInterruptFlag } from "../services/interrupt-store";
import {
  buildPromptWithHistory,
  trimHistoryMessages,
  type ChatHistoryMessage,
} from "./session-history";
import { parseSessionKeyPartsLoose } from "./session-registry";
import { parsePlatform, parseScope } from "./session-options";

interface CreateRunStartTurnRunnerInput {
  interruptStorePath: string;
  historyTurns: number;
  projectName: string;
  subject: string;
  executionPlane: ExecutionPlaneConfig;
  getSessionKey(): string;
  getHistoryMessages(): ChatHistoryMessage[];
  setHistoryMessages(rows: ChatHistoryMessage[]): void;
  onHistoryCompacted(): void;
  onVerificationFailure(): void;
  touchActiveSession(userText: string): void;
  persistHistoryState(): Promise<void>;
  persistSessionRegistryState(): Promise<void>;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
}

export function createRunStartTurnRunner(input: CreateRunStartTurnRunnerInput) {
  const recordTurn = async (userText: string, assistantText: string): Promise<void> => {
    const historyMessages = input.getHistoryMessages();
    const nextHistory = [
      ...historyMessages,
      { role: "user", content: userText } as ChatHistoryMessage,
      { role: "assistant", content: assistantText } as ChatHistoryMessage,
    ];
    const trimmed = trimHistoryMessages(nextHistory, input.historyTurns);
    if (trimmed.length < nextHistory.length) {
      input.onHistoryCompacted();
    }
    input.setHistoryMessages(trimmed);
    await input.persistHistoryState();
    input.touchActiveSession(userText);
    await input.persistSessionRegistryState();
  };

  return async (userText: string, interactiveMode: boolean): Promise<number> => {
    const sessionKey = input.getSessionKey();
    if (consumeInterruptFlag(input.interruptStorePath, sessionKey)) {
      if (interactiveMode) {
        input.writeStdout("Session interrupted by management API. Current input skipped.\n\n");
      } else {
        input.writeStdout("Session interrupted by management API. Current request skipped.\n");
      }
      return 0;
    }
    const historyMessages = input.getHistoryMessages();
    const prompt = buildPromptWithHistory(userText, historyMessages, Math.min(input.historyTurns, 6));
    const parsedSession = parseSessionKeyPartsLoose(sessionKey);
    if (!parsedSession) {
      input.writeStderr(`error: invalid active session key: ${sessionKey}\n`);
      return 1;
    }
    const report = await runGatewayTurn(
      prompt,
      {
        platform: parsePlatform(parsedSession[0]),
        tenant: parsedSession[1],
        scope: parseScope(parsedSession[2]),
        subject: parsedSession[3],
      },
      {
        actorId: process.env.USER ?? input.subject,
        projectId: input.projectName,
      },
      {
        gatewayImpl: input.executionPlane.gatewayImpl,
        runtimeImpl: input.executionPlane.runtimeImpl,
        shadowMode: input.executionPlane.shadowMode,
      },
    );
    await recordTurn(userText, report.assistantMessage);
    input.writeStdout(`${report.assistantMessage}\n`);
    if (interactiveMode) {
      input.writeStdout("\n");
    }
    input.writeStderr(
      `[execution] gateway=${input.executionPlane.gatewayImpl}(${input.executionPlane.gatewayImplSource}) runtime=${input.executionPlane.runtimeImpl}(${input.executionPlane.runtimeImplSource}) shadow=${input.executionPlane.shadowMode ? "on" : "off"}(${input.executionPlane.shadowModeSource})\n`,
    );
    input.writeStderr(
      `[governance] plane=${report.governance.plane} decision=${report.governance.decision} score=${report.governance.score.toFixed(4)} gate=${report.governance.gatePassed ? "pass" : "fail"} action=${report.governance.suggestedAction}\n`,
    );
    if (!report.verification.pass) {
      input.onVerificationFailure();
    }
    return report.verification.pass ? 0 : 1;
  };
}
