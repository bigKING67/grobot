import { type SessionStoreRuntime } from "../services/session-store";
import { type RunStartInteractiveModeInput } from "./run-start-interactive-mode";
import { type RunStartModelOps } from "./run-start-model-ops";
import { type RunStartOutput } from "./run-start-output";
import { type RunStartPlanMode } from "./run-start-plan-mode";
import { formatProviderHealthSnapshot } from "./run-start-provider-health";
import { type RunStartRuntimeState } from "./run-start-runtime-state";
import { type RunStartSessionMenuOps } from "./run-start-session-menu-ops";
import {
  type RuntimeFailoverConfig,
  type RuntimeProviderCandidate,
} from "./run-start-turn";
import { type RunStartWire } from "./run-start-wire";

interface CreateRunStartInteractiveModeInput {
  homeDir: string;
  projectRoot: string;
  projectName: string;
  workDir: string;
  sessionNamespaceKey: string;
  sessionStoreRuntime: SessionStoreRuntime;
  sessionRegistryFilePathValue: string;
  handoffAutoOnExit: boolean;
  handoffRecentTurns: number;
  handoffPath: string;
  buildHelpText(): string;
  runtimeProviderChain: ReadonlyArray<RuntimeProviderCandidate>;
  runtimeFailoverConfig: RuntimeFailoverConfig;
  runtimeState: RunStartRuntimeState;
  output: Pick<RunStartOutput, "writeStdout">;
  modelOps: RunStartModelOps;
  sessionMenuOps: RunStartSessionMenuOps;
  wire: RunStartWire;
  planMode: RunStartPlanMode;
  requestRuntimeInterrupt(
    source: "command" | "cli_esc",
  ): {
    code: "TURN_INTERRUPT_OK" | "TURN_INTERRUPT_NOT_RUNNING";
    interrupted: boolean;
  };
  executeTurn(userInput: string, interactiveMode: boolean): Promise<number>;
}

export function createRunStartInteractiveModeInput(
  input: CreateRunStartInteractiveModeInput,
): RunStartInteractiveModeInput {
  return {
    homeDir: input.homeDir,
    projectRoot: input.projectRoot,
    projectName: input.projectName,
    workDir: input.workDir,
    sessionKey: input.runtimeState.getSessionKey(),
    sessionNamespaceKey: input.sessionNamespaceKey,
    activeSessionId: input.runtimeState.getActiveSessionId(),
    sessionStoreRuntime: input.sessionStoreRuntime,
    sessionRegistryFilePathValue: input.sessionRegistryFilePathValue,
    handoffAutoOnExit: input.handoffAutoOnExit,
    handoffRecentTurns: input.handoffRecentTurns,
    handoffPath: input.handoffPath,
    restoredTurns: input.runtimeState.getRestoredTurns(),
    restoreSource: input.runtimeState.getRestoreSource(),
    buildHelpText: input.buildHelpText,
      showHealthStatus: () => {
        input.output.writeStdout(
          formatProviderHealthSnapshot({
            sessionKey: input.runtimeState.getSessionKey(),
          stickyProvider: input.runtimeState.getStickyProvider(),
          failureThreshold: input.runtimeFailoverConfig.circuitFailures,
          cooldownSecs: input.runtimeFailoverConfig.circuitCooldownSecs,
          providers: input.runtimeProviderChain.map((provider) => ({
            name: provider.name,
            maxInFlight: provider.maxInFlight,
            requestsPerMinute: provider.requestsPerMinute,
            burst: provider.burst,
          })),
          states: input.runtimeState.getProviderRuntimeStates(),
          }),
        );
      },
      showModelCurrent: input.modelOps.showModelCurrent,
      listModels: input.modelOps.listModels,
      useModel: input.modelOps.useModel,
      resetModel: input.modelOps.resetModel,
      openModelMenu: input.modelOps.openModelMenu,
    openSessionMenu: input.sessionMenuOps.openSessionMenu,
    createNewSession: input.wire.sessionOps.createNewSession,
    switchActiveSession: async (targetSessionId, reason) => {
      const switched = await input.wire.sessionOps.switchActiveSession(
        targetSessionId,
        reason,
      );
      if (switched) {
        input.modelOps.applyModelOverrideForActiveSession();
      }
      return switched;
    },
    continueFromSession: input.wire.sessionOps.continueFromSession,
    writeManualHandoff: () => {
      input.wire.handoff.writeHandoff("manual-command", false);
    },
    isPlanMode: input.planMode.isPlanMode,
    showPlanStatus: input.planMode.showPlanStatus,
    enterPlan: input.planMode.enterPlan,
    applyPlan: input.planMode.applyPlan,
    cancelPlan: input.planMode.cancelPlan,
    requestPlanInterrupt: async (source) => {
      await input.planMode.requestPlanInterrupt(source);
    },
    requestRuntimeInterrupt: async (source) => {
      input.requestRuntimeInterrupt(source);
    },
    runPlanTurn: input.planMode.runPlanTurn,
    executeTurn: input.executeTurn,
    markFailureObserved: input.runtimeState.markFailureObserved,
    getHistoryMessagesCount: () => input.runtimeState.getHistoryMessages().length,
    writeAutoExitHandoffIfNeeded: () => {
      input.wire.handoff.writeAutoExitHandoffIfNeeded(false);
    },
  };
}
