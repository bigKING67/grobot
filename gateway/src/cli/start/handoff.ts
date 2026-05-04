import {
  buildHandoffMarkdown,
  hasFailureSignals,
  hasOpenTodoItems,
  shouldAutoWriteHandoff,
  type ChatHistoryMessage,
} from "./session-history";
import { writeHandoffFile } from "./handoff-file";

interface CreateRunStartHandoffInput {
  getSessionKey(): string;
  projectName: string;
  workDir: string;
  handoffPath: string;
  handoffRecentTurns: number;
  getHistoryMessages(): ChatHistoryMessage[];
  hasHistoryCompacted(): boolean;
  hasFailureObserved(): boolean;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
}

export function createRunStartHandoff(input: CreateRunStartHandoffInput) {
  const writeHandoff = (reason: string, toStderr: boolean): void => {
    const content = buildHandoffMarkdown({
      sessionKey: input.getSessionKey(),
      projectName: input.projectName,
      workDir: input.workDir,
      historyMessages: input.getHistoryMessages(),
      recentTurns: input.handoffRecentTurns,
      reason,
    });
    const wrote = writeHandoffFile(input.handoffPath, content);
    const writeOutput = toStderr ? input.writeStderr : input.writeStdout;
    if (wrote.ok) {
      writeOutput(`[handoff] wrote ${input.handoffPath} (reason=${reason})\n`);
      return;
    }
    writeOutput(`[handoff] write failed (${input.handoffPath}): ${wrote.error}\n`);
  };

  const writeAutoExitHandoffIfNeeded = (toStderr: boolean): void => {
    const historyMessages = input.getHistoryMessages();
    const todoOpen = hasOpenTodoItems(historyMessages);
    const failSignals = input.hasFailureObserved() || hasFailureSignals(historyMessages);
    if (shouldAutoWriteHandoff(input.hasHistoryCompacted(), failSignals, todoOpen)) {
      writeHandoff("auto-exit", toStderr);
    }
  };

  return {
    writeHandoff,
    writeAutoExitHandoffIfNeeded,
  };
}
