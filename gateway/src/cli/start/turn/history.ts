import { type GaSessionStateSnapshot } from "../../services/ga-mechanism-runtime";
import {
  type ChatHistoryMessage,
  trimHistoryMessages,
} from "../session/history";
import { type SessionProviderRuntimeState } from "../session-registry";

export interface TurnHistoryRecorderInput {
  historyTurns: number;
  getSessionKey(): string;
  getHistoryMessages(): ChatHistoryMessage[];
  setHistoryMessages(rows: ChatHistoryMessage[]): void;
  onHistoryCompacted(): void;
  persistHistoryState(): Promise<void>;
  gaMechanismRuntime: {
    snapshotSession(sessionKey: string): GaSessionStateSnapshot | undefined;
  };
  setGaState(value: GaSessionStateSnapshot | undefined): void;
  updateActiveSessionProviderRuntime(
    stickyProvider: string | undefined,
    providerRuntimeStates: readonly SessionProviderRuntimeState[],
  ): void;
  updateActiveSessionGaState(gaState: GaSessionStateSnapshot | undefined): void;
  touchActiveSession(userText: string): void;
  persistSessionRegistryState(): Promise<void>;
}

export type TurnRecordedHook = (input: {
  userText: string;
  assistantText: string;
  historyAfter: ChatHistoryMessage[];
}) => Promise<void> | void;

export type TurnHistoryRecorder = (record: {
  userText: string;
  assistantText: string;
  stickyProvider: string | undefined;
  providerRuntimeStates: readonly SessionProviderRuntimeState[];
  onTurnRecorded?: TurnRecordedHook;
}) => Promise<void>;

export function createTurnHistoryRecorder(input: TurnHistoryRecorderInput) {
  return async (record: {
    userText: string;
    assistantText: string;
    stickyProvider: string | undefined;
    providerRuntimeStates: readonly SessionProviderRuntimeState[];
    onTurnRecorded?: TurnRecordedHook;
  }): Promise<void> => {
    const historyMessages = input.getHistoryMessages();
    const nextHistory = [
      ...historyMessages,
      { role: "user", content: record.userText } as ChatHistoryMessage,
      {
        role: "assistant",
        content: record.assistantText,
      } as ChatHistoryMessage,
    ];
    const trimmed = trimHistoryMessages(nextHistory, input.historyTurns);
    if (trimmed.length < nextHistory.length) {
      input.onHistoryCompacted();
    }
    input.setHistoryMessages(trimmed);
    await input.persistHistoryState();
    if (record.onTurnRecorded) {
      await record.onTurnRecorded({
        userText: record.userText,
        assistantText: record.assistantText,
        historyAfter: [...trimmed],
      });
    }
    const gaState = input.gaMechanismRuntime.snapshotSession(
      input.getSessionKey(),
    );
    input.setGaState(gaState);
    input.updateActiveSessionProviderRuntime(
      record.stickyProvider,
      record.providerRuntimeStates,
    );
    input.updateActiveSessionGaState(gaState);
    input.touchActiveSession(record.userText);
    await input.persistSessionRegistryState();
  };
}
