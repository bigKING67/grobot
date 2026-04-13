import { SessionStoreController } from "../services/session-store";
import { type ChatHistoryMessage } from "./session-history";
import { type RunStartRuntimeState } from "./run-start-runtime-state";
import { type SessionRegistryPayload } from "./session-registry";

interface CreateRunStartPersistenceInput {
  sessionStore: SessionStoreController<SessionRegistryPayload, ChatHistoryMessage>;
  runtimeState: RunStartRuntimeState;
  writeSessionWarnings(warnings: readonly string[]): void;
  writeStoreWarnings(warnings: readonly string[]): void;
}

export interface RunStartPersistence {
  persistSessionRegistryState(): Promise<void>;
  persistHistoryState(): Promise<void>;
}

export function createRunStartPersistence(input: CreateRunStartPersistenceInput): RunStartPersistence {
  const persistSessionRegistryState = async (): Promise<void> => {
    const warnings = await input.sessionStore.saveSessionRegistryState(input.runtimeState.getSessionRegistry());
    input.writeSessionWarnings(warnings);
  };

  const persistHistoryState = async (): Promise<void> => {
    const warnings = await input.sessionStore.saveHistoryMessagesState(
      input.runtimeState.getSessionKey(),
      input.runtimeState.getHistoryMessages(),
    );
    input.writeStoreWarnings(warnings);
  };

  return {
    persistSessionRegistryState,
    persistHistoryState,
  };
}
