import { OptionValue, readOptionString } from "../cli-args";
import { buildInteractiveHelpText } from "./session-interactive";
import { bootstrapRunStartState } from "./run-start-bootstrap";
import { resolveRunStartContext } from "./run-start-context";
import { createRunStartInteractiveModeInput } from "./run-start-interactive-bindings";
import { runStartInteractiveMode } from "./run-start-interactive-mode";
import { createRunStartModelOps } from "./run-start-model-ops";
import { createRunStartSessionMenuOps } from "./run-start-session-menu-ops";
import { runStartMessageMode } from "./run-start-message-mode";
import { createRunStartOutput } from "./run-start-output";
import { createRunStartPersistence } from "./run-start-persistence";
import { createRunStartRuntimeState } from "./run-start-runtime-state";
import { createRunStartWire } from "./run-start-wire";
import { createRunStartPlanMode } from "./run-start-plan-mode";
import { TURN_INTERRUPTED_EXIT_CODE } from "./run-start-turn";
import { createGaMechanismRuntime } from "../services/ga-mechanism-runtime";
import { createExperiencePoolRuntime } from "../services/experience-pool-runtime";
import {
  createExperienceSchedulerRuntime,
  resolveExperienceSchedulerConfig,
} from "../services/experience-scheduler";

export async function runStart(
  options: Record<string, OptionValue>,
): Promise<number> {
  const TURN_INTERRUPT_OK_CODE = "TURN_INTERRUPT_OK";
  const TURN_INTERRUPT_NOT_RUNNING_CODE = "TURN_INTERRUPT_NOT_RUNNING";
  const isTurnInterruptedCode = (code: number): boolean => code === TURN_INTERRUPTED_EXIT_CODE;
  const context = resolveRunStartContext(options);
  const {
    homeDir,
    projectRoot,
    workDir,
    projectTomlPath,
    projectName,
    historyTurns,
    handoffRecentTurns,
    handoffAutoOnExit,
    handoffPath,
    interruptStorePath,
    experiencePoolPath,
    experienceLegacyPoolPath,
    experienceTeam,
    experiencePublishMode,
    experienceRecallLimit,
    subject,
    executionPlane,
    runtimeModelConfig,
    runtimeProviderChain,
    runtimeFailoverConfig,
    runtimeModelConfigSource,
    contextEngineConfig,
    runtimeToolContext,
    kimiSearchRoutingPolicy,
    statusLineConfig,
    mcpInstructionPromptPrefix,
    mcpInstructionServerNames,
    mcpInstructionEvents,
    mcpInstructionStrictFailure,
    sessionNamespaceKey,
    sessionRegistryFilePathValue,
    sessionStore,
  } = context;
  const output = createRunStartOutput();
  for (const event of mcpInstructionEvents) {
    output.writeStderr(`[governance:mcp-instruction] ${event}\n`);
  }
  if (mcpInstructionStrictFailure) {
    output.writeStderr(
      `[governance:mcp-instruction] event=strict_failure reason=${mcpInstructionStrictFailure}\n`,
    );
    return 1;
  }
  const experiencePoolRuntime = createExperiencePoolRuntime({
    poolPath: experiencePoolPath,
    legacyPoolPath: experienceLegacyPoolPath,
    publishMode: experiencePublishMode,
    recallLimit: experienceRecallLimit,
    teamDefault: experienceTeam,
  });
  output.writeStderr(
    `[experience-pool] mode=${experiencePoolRuntime.getPublishMode()} recall_limit=${String(experiencePoolRuntime.getRecallLimit())} records=${String(experiencePoolRuntime.getRecordCount())} path=${experiencePoolRuntime.getPath()}\n`,
  );

  const bootstrapState = await bootstrapRunStartState({
    sessionNamespaceKey,
    sessionStore,
    writeSessionWarnings: output.writeSessionWarnings,
    writeStoreWarnings: output.writeStoreWarnings,
  });

  const runtimeState = createRunStartRuntimeState({ bootstrapState });
  const persistence = createRunStartPersistence({
    sessionStore,
    runtimeState,
    writeSessionWarnings: output.writeSessionWarnings,
    writeStoreWarnings: output.writeStoreWarnings,
    });
    const gaMechanismRuntime = createGaMechanismRuntime();
    gaMechanismRuntime.hydrateSession(runtimeState.getSessionKey(), runtimeState.getGaState());

  const wire = createRunStartWire({
    sessionNamespaceKey,
    historyTurns,
    sessionStore,
    projectName,
    workDir,
    handoffPath,
    handoffRecentTurns,
    interruptStorePath,
    subject,
    executionPlane,
    runtimeModelConfig,
    runtimeProviderChain,
    runtimeFailoverConfig,
    runtimeModelConfigSource,
    contextEngineConfig,
    runtimeToolContext,
    gaMechanismRuntime,
    kimiSearchRoutingPolicy,
    mcpInstructionPromptPrefix,
    mcpInstructionServerNames,
    experiencePoolRuntime,
    runtimeState,
    persistence,
    writeStoreWarnings: output.writeStoreWarnings,
    writeStdout: output.writeStdout,
    writeStderr: output.writeStderr,
  });
  const { handoff, sessionOps } = wire;
  output.writeStderr(
    `[context-engine] enabled=${contextEngineConfig.enabled ? "on" : "off"} profile=${contextEngineConfig.profile} thresholds=${contextEngineConfig.thresholds.proactiveRatio.toFixed(2)}/${contextEngineConfig.thresholds.forcedRatio.toFixed(2)}/${contextEngineConfig.thresholds.hardRatio.toFixed(2)} recovery=${contextEngineConfig.recovery.reactiveMaxRetries}/${contextEngineConfig.recovery.ptlMaxRetries}/${contextEngineConfig.recovery.circuitBreakerFailures} lineage=${contextEngineConfig.lineage.enabled ? "on" : "off"}:${String(contextEngineConfig.lineage.maxRows)}/${String(contextEngineConfig.lineage.maxCommits)} workspace=${contextEngineConfig.workspaceSignals.enabled ? "on" : "off"}:${String(contextEngineConfig.workspaceSignals.maxRows)}/${contextEngineConfig.workspaceSignals.includeUntracked ? "u1" : "u0"} dependency_graph=${contextEngineConfig.dependencyGraph.enabled ? "on" : "off"}:${String(contextEngineConfig.dependencyGraph.maxRows)} symbol_graph=${contextEngineConfig.symbolGraph.enabled ? "on" : "off"}:${String(contextEngineConfig.symbolGraph.maxRows)} semantic_prefetch=${contextEngineConfig.semanticPrefetch.enabled ? "on" : "off"}:${String(contextEngineConfig.semanticPrefetch.maxEvidence)}/${String(contextEngineConfig.semanticPrefetch.timeoutMs)}\n`,
  );
  let turnQueue: Promise<unknown> = Promise.resolve();
  let activeTurnAbortController: AbortController | undefined;
  let pendingRuntimeInterruptSource: "command" | "cli_esc" | undefined;
  const requestRuntimeInterrupt = (
    source: "command" | "cli_esc",
  ): {
    code: typeof TURN_INTERRUPT_OK_CODE | typeof TURN_INTERRUPT_NOT_RUNNING_CODE;
    interrupted: boolean;
  } => {
    const controller = activeTurnAbortController;
    if (!controller || controller.signal.aborted) {
      output.writeStdout(
        `[interrupt] code=${TURN_INTERRUPT_NOT_RUNNING_CODE} detail=no_active_turn source=${source}\n\n`,
      );
      output.writeStderr(
        `[interrupt] event=rejected reason=no_active_turn source=${source}\n`,
      );
      return {
        code: TURN_INTERRUPT_NOT_RUNNING_CODE,
        interrupted: false,
      };
    }
    controller.abort(`source=${source}`);
    pendingRuntimeInterruptSource = source;
    output.writeStdout(
      `[interrupt] code=${TURN_INTERRUPT_OK_CODE} detail=requested source=${source}\n\n`,
    );
    output.writeStderr(
      `[interrupt] event=requested source=${source}\n`,
    );
    return {
      code: TURN_INTERRUPT_OK_CODE,
      interrupted: true,
    };
  };
  const runTurnWithController = async (
    userInput: string,
    interactiveMode: boolean,
    controller: AbortController,
  ): Promise<number> => {
    activeTurnAbortController = controller;
    try {
      const code = await wire.executeTurn(userInput, interactiveMode, {
        signal: controller.signal,
      });
      if (pendingRuntimeInterruptSource && code === TURN_INTERRUPTED_EXIT_CODE) {
        output.writeStderr(
          `[interrupt] event=applied source=${pendingRuntimeInterruptSource} interactive=${interactiveMode ? "true" : "false"}\n`,
        );
        pendingRuntimeInterruptSource = undefined;
      } else if (
        pendingRuntimeInterruptSource &&
        controller.signal.aborted &&
        code !== TURN_INTERRUPTED_EXIT_CODE
      ) {
        output.writeStderr(
          `[interrupt] event=ignored source=${pendingRuntimeInterruptSource} reason=turn_completed_before_abort interactive=${interactiveMode ? "true" : "false"}\n`,
        );
        pendingRuntimeInterruptSource = undefined;
      }
      return code;
    } finally {
      if (activeTurnAbortController === controller) {
        activeTurnAbortController = undefined;
      }
    }
  };
  const executeTurn = async (userInput: string, interactiveMode: boolean): Promise<number> => {
    const controller = new AbortController();
    const next = turnQueue.then(
      async () => runTurnWithController(userInput, interactiveMode, controller),
      async () => runTurnWithController(userInput, interactiveMode, controller),
    );
    turnQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const schedulerRuntime = createExperienceSchedulerRuntime(
    resolveExperienceSchedulerConfig({
      workDir,
      projectTomlPath,
    }),
  );
  const schedulerConfig = schedulerRuntime.getConfig();
  output.writeStderr(
    `[experience-scheduler] enabled=${schedulerConfig.enabled ? "on" : "off"} interval_ms=${String(schedulerConfig.intervalMs)} tasks_dir=${schedulerConfig.tasksDir} done_dir=${schedulerConfig.doneDir} log_path=${schedulerConfig.logPath}\n`,
  );

  const modelOps = createRunStartModelOps({
    runtimeProviderChain,
    runtimeModelConfig,
    runtimeModelConfigSource,
    getActiveSessionId: runtimeState.getActiveSessionId,
    getActiveSessionMetadata: () => {
      const activeSessionId = runtimeState.getActiveSessionId();
      const activeSession = sessionOps
        .listSessions()
        .find((item) => item.id === activeSessionId);
      if (!activeSession) {
        return undefined;
      }
      return {
        title: activeSession.title,
        summary: activeSession.summary,
      };
    },
    writeStdout: output.writeStdout,
  });

  const sessionMenuOps = createRunStartSessionMenuOps({
    sessionNamespaceKey,
    listSessions: sessionOps.listSessions,
    printSessionOverview: sessionOps.printSessionOverview,
    createNewSession: sessionOps.createNewSession,
    switchActiveSession: sessionOps.switchActiveSession,
    continueFromSession: sessionOps.continueFromSession,
    applyModelOverrideForActiveSession:
      modelOps.applyModelOverrideForActiveSession,
    writeStdout: output.writeStdout,
  });

  modelOps.applyModelOverrideForActiveSession();

  const planMode = createRunStartPlanMode({
    workDir,
    runtimeState,
    persistence,
    executeTurn,
    requestRuntimeInterrupt,
    markFailureObserved: runtimeState.markFailureObserved,
    writeStdout: output.writeStdout,
    writeStderr: output.writeStderr,
  });

  const message = readOptionString(options, "message");
  if (message) {
      const planHandled = await planMode.handleMessageInput(message);
      if (planHandled.handled) {
        if (planHandled.code !== 0 && !isTurnInterruptedCode(planHandled.code)) {
          runtimeState.markFailureObserved();
        }
      if (handoffAutoOnExit) {
        handoff.writeAutoExitHandoffIfNeeded(true);
      }
      return planHandled.code;
    }
    return runStartMessageMode({
      message,
      executeTurn,
      markFailureObserved: runtimeState.markFailureObserved,
      handoffAutoOnExit,
      writeAutoExitHandoffIfNeeded: () => {
        handoff.writeAutoExitHandoffIfNeeded(true);
      },
    });
  }

  let schedulerTimer: ReturnType<typeof setInterval> | undefined;
  let schedulerTickRunning = false;
  const runSchedulerTick = async (): Promise<void> => {
    if (!schedulerConfig.enabled || schedulerTickRunning) {
      return;
    }
    schedulerTickRunning = true;
    try {
      const tickResult = schedulerRuntime.tick();
      for (const error of tickResult.errors) {
        output.writeStderr(`[experience-scheduler] event=tick_error detail=${error}\n`);
      }
      for (const trigger of tickResult.triggered) {
        if (runtimeState.getPlanMode() === "plan_only") {
          output.writeStderr(
            `[experience-scheduler] event=task_skipped reason=plan_mode task=${trigger.taskId}\n`,
          );
          continue;
        }
        output.writeStderr(
          `[experience-scheduler] event=task_triggered task=${trigger.taskId} report_path=${trigger.reportPath}\n`,
        );
        try {
          const code = await executeTurn(trigger.prompt, false);
          schedulerRuntime.writeDoneReport(trigger, {
            status: code === 0 ? "success" : "failed",
            exitCode: code,
            reason: code === 0 ? "turn_completed" : "turn_failed",
          });
          if (code !== 0) {
            runtimeState.markFailureObserved();
          }
          output.writeStderr(
            `[experience-scheduler] event=task_finished task=${trigger.taskId} status=${code === 0 ? "success" : "failed"} exit_code=${String(code)}\n`,
          );
        } catch (error) {
          schedulerRuntime.writeDoneReport(trigger, {
            status: "failed",
            exitCode: 1,
            reason: String(error),
          });
          runtimeState.markFailureObserved();
          output.writeStderr(
            `[experience-scheduler] event=task_failed task=${trigger.taskId} detail=${String(error)}\n`,
          );
        }
      }
    } finally {
      schedulerTickRunning = false;
    }
  };
  if (schedulerConfig.enabled) {
    schedulerTimer = setInterval(() => {
      void runSchedulerTick();
    }, schedulerConfig.intervalMs);
  }
  try {
    await runStartInteractiveMode(
      createRunStartInteractiveModeInput({
        homeDir,
        projectRoot,
        projectName,
        workDir,
        sessionNamespaceKey,
        sessionStoreRuntime: sessionStore.getRuntime(),
        sessionRegistryFilePathValue,
        handoffAutoOnExit,
        handoffRecentTurns,
          handoffPath,
          buildHelpText: buildInteractiveHelpText,
        statusLineConfig,
        runtimeProviderChain,
        runtimeFailoverConfig,
        runtimeState,
        output,
        modelOps,
        sessionMenuOps,
          wire,
          planMode,
          requestRuntimeInterrupt,
          executeTurn,
        }),
      );
  } finally {
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
    }
  }
  return 0;
}
