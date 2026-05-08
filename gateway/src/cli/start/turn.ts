import { runGatewayTurn } from "../../orchestration/main";
import { loadGrobotSystemPrompt } from "../system/gro-system-prompt";
import { compactSingleLine } from "./session/history";
import { parsePlatform, parseScope } from "./session/options";
import {
  renderRuntimeFailureSummary,
  renderRuntimeOpenCircuitNotice,
  renderTurnInterruptedNotice,
} from "../tui/components/turn-notice/render";
import {
  classifyPromptOverflow,
  escalatePromptVariant,
  truncatePromptHeadForPtlRetry,
  type PromptCompactionStage,
} from "../../tools/context";
import { recordRuntimeToolSuccessfulRecoveryConsumption } from "../../tools/runtime/tool-surface-adaptation-state";
import {
  extractRuntimeErrorClass,
  extractRuntimeErrorData,
  extractRuntimeErrorEvents,
} from "../../tools/runtime/runtime-error";
import {
  type CreateRunStartTurnRunnerInput,
  type RunStartTurnExecuteOptions,
} from "./turn/contract";
import {
  type ProviderAttemptFailure,
  type ProviderFlowState,
  createDefaultProviderState,
  normalizeProviderStateMap,
  releaseProviderCapacity,
  resolveProviderOrder,
  resolveProviderRetryReason,
  resolveTurnModelConfig,
  shouldRetryProviderRequest,
  shouldRetryWithKimiBuiltinFallback,
  tryAcquireProviderCapacity,
  updateProviderEwmaState,
} from "./turn/provider-routing";
import {
  TURN_INTERRUPTED_ERROR_CLASS,
  TURN_INTERRUPTED_EXIT_CODE,
  sleepAsync,
  throwIfTurnInterrupted,
} from "./turn/interrupt";
import { buildTurnTerminalOutputSegments } from "./turn/output";
import {
  buildProviderFailureDiagnostics,
  buildProviderFailureToolContext,
  deriveFailureStageFromError,
  recordRuntimeToolMetricsForEvents,
  resolveErrorClass,
  writeRuntimeToolSurfaceAdaptationOutcome,
} from "./turn/diagnostics";
import { nowIso } from "./turn/time";
import { createTurnHistoryRecorder } from "./turn/history";
import { prepareRunStartTurnPromptContext } from "./turn/prompt-context";
import { runStartPreTurnGate } from "./turn/pre-turn";
import {
  prepareSuccessfulTurnReportPresentation,
  writeSuccessfulTurnDiagnostics,
} from "./turn/report-success";
import { normalizeProviderLastErrorData } from "./session-registry/normalization";

export type {
  CreateRunStartTurnRunnerInput,
  KimiSearchRoutingPolicy,
  RuntimeFailoverConfig,
  RuntimeProviderCandidate,
  RunStartTurnExecuteOptions,
  RunStartTurnPromptBudgetSnapshot,
  TurnTerminalOutputSegments,
} from "./turn/contract";
export { buildAskUserQueueContinuationHint } from "./turn/ask-user";
export {
  TURN_INTERRUPTED_ERROR_CLASS,
  TURN_INTERRUPTED_EXIT_CODE,
} from "./turn/interrupt";
export {
  buildTurnTerminalOutputSegments,
  resolveRuntimeActivityFeedTranscriptEnabled,
} from "./turn/output";

export function createRunStartTurnRunner(
  baseInput: CreateRunStartTurnRunnerInput,
) {
  const providerFlowStateMap = new Map<string, ProviderFlowState>();
  const grobotSystemPrompt = loadGrobotSystemPrompt();
  let consecutiveCompactionFailures = 0;
  let previousTargetTokenLimit: number | undefined;
  const recordTurn = createTurnHistoryRecorder(baseInput);

  return async (
    userText: string,
    interactiveMode: boolean,
    options?: RunStartTurnExecuteOptions,
  ): Promise<number> => {
    const input =
      typeof options?.writeStdout === "function" ||
      typeof options?.writeStderr === "function"
        ? {
            ...baseInput,
            writeStdout: options.writeStdout ?? baseInput.writeStdout,
            writeStderr: options.writeStderr ?? baseInput.writeStderr,
          }
        : baseInput;
    const turnSignal = options?.signal;
    const runtimeAttachments = options?.attachments;
    const emitTerminalDiagnostics =
      interactiveMode || options?.emitDiagnostics === true;
    const writeTurnDiagnostic = (message: string): void => {
      if (emitTerminalDiagnostics) {
        input.writeStderr(message);
      }
    };
    const writeTurnDiagnosticEvents = (events: readonly string[]): void => {
      if (!emitTerminalDiagnostics) {
        return;
      }
      for (const event of events) {
        input.writeStderr(event);
      }
    };
    throwIfTurnInterrupted(turnSignal, "aborted_before_turn_start");
    const preTurn = await runStartPreTurnGate({
      runnerInput: input,
      userText,
      interactiveMode,
      options,
      recordTurn,
      writeTurnDiagnostic,
      writeTurnDiagnosticEvents,
    });
    if (preTurn.kind === "handled") {
      return preTurn.exitCode;
    }
    const {
      sessionKey,
      parsedSession,
      askUserTurnContext,
      turnUserText,
    } = preTurn;
    const [sessionPlatformRaw, sessionTenant, sessionScopeRaw, sessionSubject] =
      parsedSession;

    const promptContext = prepareRunStartTurnPromptContext({
      runnerInput: input,
      sessionKey,
      sessionTenant,
      sessionSubject,
      turnUserText,
      askUserPromptParts: askUserTurnContext.promptParts,
      promptPrelude: options?.promptPrelude,
      consecutiveCompactionFailures,
      previousTargetTokenLimit,
      writeTurnDiagnostic,
      writeTurnDiagnosticEvents,
    });
    previousTargetTokenLimit = promptContext.nextPreviousTargetTokenLimit;

    const selectedStage = promptContext.selectedStage;
    const preparedPromptVariants = promptContext.preparedPromptVariants;
    const prompt = promptContext.prompt;
    const kimiBuiltinFallbackPrompt = promptContext.kimiBuiltinFallbackPrompt;
    const kimiMcpFirstRouteEnabled = promptContext.kimiMcpFirstRouteEnabled;
    const runtimeToolContextForTurn = promptContext.runtimeToolContextForTurn;
    const runtimeToolRecoveryFeedback =
      promptContext.runtimeToolRecoveryFeedback;
    const runtimeToolSurfaceAdaptationStartedAtIso =
      promptContext.runtimeToolSurfaceAdaptationStartedAtIso;
    const providers =
      input.runtimeProviderChain.length > 0
        ? input.runtimeProviderChain
        : [
            {
              name: "default",
              modelConfig: input.runtimeModelConfig ?? {},
              source: "runtime-model",
              priority: 1,
              weight: 1,
            },
          ];
    const providerNames = providers.map((item) => item.name);
    const providerStateMap = normalizeProviderStateMap(
      providerNames,
      input.getProviderRuntimeStates(),
    );
    const currentStickyProvider =
      input.runtimeFailoverConfig.stickyMode === "session_key"
        ? input.getStickyProvider()
        : undefined;
    const routeDecision = resolveProviderOrder({
      providers,
      stickyProvider: currentStickyProvider,
      sessionKey,
      stateMap: providerStateMap,
    });
    const orderedProviders = routeDecision.orderedProviders;
    const routeScoreOrder = routeDecision.trace.scoreOrder
      .map((entry) => `${entry.name}:${entry.score.toFixed(2)}`)
      .join(",");
    const routeLastErrorPenalties = routeDecision.trace.scoreOrder
      .filter((entry) => entry.lastErrorPenalty > 0)
      .map((entry) => {
        const reason = entry.lastErrorReason ?? "last_error";
        return `${entry.name}:${reason}+${String(entry.lastErrorPenalty)}`;
      })
      .join(",");
    const routeCircuitSkipped = routeDecision.trace.circuitSkipped
      .map((entry) => `${entry.name}@${String(entry.reopenAtMs)}`)
      .join(",");
    writeTurnDiagnostic(
      `[runtime-route] event=decision sticky=${routeDecision.trace.stickyProvider ?? "<none>"} sticky_hit=${routeDecision.trace.stickyHit ? "true" : "false"} sticky_reason=${routeDecision.trace.stickyReason} selected=${orderedProviders[0]?.name ?? "<none>"} score_order=${routeScoreOrder || "<none>"} last_error_penalties=${routeLastErrorPenalties || "<none>"} circuit_skipped=${routeCircuitSkipped || "<none>"} probe=${routeDecision.trace.probeProvider ?? "<none>"} strategy=sticky+score\n`,
    );
    if (orderedProviders.length === 0) {
      const gaState = input.gaMechanismRuntime.snapshotSession(sessionKey);
      input.setGaState(gaState);
      input.updateActiveSessionGaState(gaState);
      await input.persistSessionRegistryState();
      if (interactiveMode) {
        input.writeStderr(
          "[runtime-route] all provider circuits are OPEN; no attempt executed\n",
        );
      } else {
        input.writeStderr(renderRuntimeOpenCircuitNotice(false));
      }
      return 1;
    }

    const failures: ProviderAttemptFailure[] = [];
    for (const provider of orderedProviders) {
      throwIfTurnInterrupted(turnSignal, "aborted_before_provider_attempt");
      const startedAtMs = Date.now();
      const turnModelConfig = resolveTurnModelConfig(
        provider.modelConfig,
        turnUserText,
      );
      if (turnModelConfig.timeoutBoosted) {
        writeTurnDiagnostic(
          `[runtime-model] timeout_boost provider=${provider.name} reason=search_intent timeout_ms=${String(turnModelConfig.modelConfig.timeoutMs)}\n`,
        );
      }
      const capacity = tryAcquireProviderCapacity({
        provider,
        stateMap: providerFlowStateMap,
        nowMs: startedAtMs,
      });
      if (!capacity.ok) {
        failures.push({
          providerName: provider.name,
          errorClass: capacity.errorClass,
          errorMessage: capacity.errorMessage,
        });
        continue;
      }
      try {
        let providerRetryCount = 0;
        let kimiBuiltinFallbackRetryCount = 0;
        let reactiveRetryCount = 0;
        let ptlRetryCount = 0;
        let activeCompactionStage: PromptCompactionStage = selectedStage;
        let turnPrompt = prompt;
        let report;
        while (true) {
          throwIfTurnInterrupted(turnSignal, "aborted_before_gateway_turn");
          try {
            report = await runGatewayTurn(
              turnPrompt,
              {
                platform: parsePlatform(sessionPlatformRaw),
                tenant: sessionTenant,
                scope: parseScope(sessionScopeRaw),
                subject: sessionSubject,
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
              {
                modelConfig: turnModelConfig.modelConfig,
                toolContext: runtimeToolContextForTurn.context,
                attachments: runtimeAttachments,
                abortSignal: turnSignal,
                onEvent: options?.onRuntimeEvent,
                streamEvents: Boolean(options?.onRuntimeEvent),
                turnGate: input.turnGate,
                systemPrompt: grobotSystemPrompt,
              },
            );
            break;
          } catch (error) {
            const retryMessage = String(error);
            const retryErrorClass =
              extractRuntimeErrorClass(error) ?? resolveErrorClass(retryMessage);
            const retryErrorData = extractRuntimeErrorData(error);
            if (
              shouldRetryWithKimiBuiltinFallback({
                provider,
                retryCount: kimiBuiltinFallbackRetryCount,
                mcpFirstRouteEnabled: kimiMcpFirstRouteEnabled,
                policy: input.kimiSearchRoutingPolicy,
              })
            ) {
              kimiBuiltinFallbackRetryCount += 1;
              turnPrompt = kimiBuiltinFallbackPrompt;
              writeTurnDiagnostic(
                `[runtime-route] provider_retry provider=${provider.name} reason=kimi_mcp_unavailable fallback=builtin_web_search retry=${String(kimiBuiltinFallbackRetryCount)}\n`,
              );
              continue;
            }
            const overflow = classifyPromptOverflow(
              retryErrorClass,
              retryMessage,
            );
            const canUseReactiveCompaction =
              consecutiveCompactionFailures <
              input.contextEngineConfig.recovery.circuitBreakerFailures;
            if (
              overflow.overflow &&
              input.contextEngineConfig.reactiveOnPromptTooLong &&
              canUseReactiveCompaction
            ) {
              if (
                reactiveRetryCount <
                input.contextEngineConfig.recovery.reactiveMaxRetries
              ) {
                const escalated = escalatePromptVariant(
                  preparedPromptVariants,
                  activeCompactionStage,
                );
                if (escalated && escalated.prompt !== turnPrompt) {
                  reactiveRetryCount += 1;
                  activeCompactionStage = escalated.stage;
                  turnPrompt = escalated.prompt;
                  input.onHistoryCompacted();
                  writeTurnDiagnostic(
                    `[context-engine] event=reactive_compact_retry provider=${provider.name} reason=${overflow.reason} stage=${activeCompactionStage} retry=${String(reactiveRetryCount)}\n`,
                  );
                  continue;
                }
              }
              if (
                ptlRetryCount < input.contextEngineConfig.recovery.ptlMaxRetries
              ) {
                const truncatedPrompt = truncatePromptHeadForPtlRetry(
                  turnPrompt,
                  ptlRetryCount + 1,
                );
                if (truncatedPrompt !== turnPrompt) {
                  ptlRetryCount += 1;
                  turnPrompt = truncatedPrompt;
                  input.onHistoryCompacted();
                  writeTurnDiagnostic(
                    `[context-engine] event=ptl_retry provider=${provider.name} reason=${overflow.reason} retry=${String(ptlRetryCount)}\n`,
                  );
                  continue;
                }
              }
              consecutiveCompactionFailures += 1;
              writeTurnDiagnostic(
                `[context-engine] event=reactive_compact_failed provider=${provider.name} failures=${String(consecutiveCompactionFailures)} reason=${overflow.reason}\n`,
              );
              if (
                consecutiveCompactionFailures >=
                input.contextEngineConfig.recovery.circuitBreakerFailures
              ) {
                writeTurnDiagnostic(
                  `[context-engine] event=circuit_open failures=${String(consecutiveCompactionFailures)} limit=${String(input.contextEngineConfig.recovery.circuitBreakerFailures)}\n`,
                );
              }
            } else if (
              overflow.overflow &&
              input.contextEngineConfig.reactiveOnPromptTooLong &&
              !canUseReactiveCompaction
            ) {
              writeTurnDiagnostic(
                `[context-engine] event=reactive_compact_skipped reason=circuit_open failures=${String(consecutiveCompactionFailures)}\n`,
              );
            }
            if (
              !shouldRetryProviderRequest({
                errorClass: retryErrorClass,
                errorMessage: retryMessage,
                retryCount: providerRetryCount,
                errorData: retryErrorData,
              })
            ) {
              throw error;
            }
            providerRetryCount += 1;
            const retryReason = resolveProviderRetryReason({
              errorClass: retryErrorClass,
              errorMessage: retryMessage,
              errorData: retryErrorData,
            });
            const backoffBaseMs =
              retryErrorClass === "upstream_response_read_failed" ? 600 : 1_500;
            const backoffMs = providerRetryCount * backoffBaseMs;
            writeTurnDiagnostic(
              `[runtime-route] provider_retry provider=${provider.name} reason=${retryReason} retry=${String(providerRetryCount)} backoff_ms=${String(backoffMs)}\n`,
            );
            await sleepAsync(backoffMs, turnSignal);
          }
        }
        if (!report) {
          throw new Error("provider response missing after retry");
        }
        consecutiveCompactionFailures = 0;
        const state =
          providerStateMap.get(provider.name) ??
          createDefaultProviderState(provider.name);
        updateProviderEwmaState({
          state,
          latencyMs: Date.now() - startedAtMs,
          isError: false,
        });
        state.consecutive_failures = 0;
        state.circuit_open_until_ms = 0;
        state.last_error_class = undefined;
        state.last_error_message = undefined;
        state.last_error_data = undefined;
        state.last_failed_at = undefined;
        state.last_succeeded_at = nowIso();
        providerStateMap.set(provider.name, state);
        const stickyProvider =
          input.runtimeFailoverConfig.stickyMode === "session_key"
            ? provider.name
            : undefined;
        input.setStickyProvider(stickyProvider);
        const providerStates = Array.from(providerStateMap.values());
        input.setProviderRuntimeStates(providerStates);
        recordRuntimeToolMetricsForEvents({
          workDir: input.workDir,
          events: report.events,
          source: "runtime_turn",
          writeStderr: writeTurnDiagnostic,
        });
        writeRuntimeToolSurfaceAdaptationOutcome({
          workDir: input.workDir,
          adaptation: runtimeToolContextForTurn.adaptation,
          events: report.events,
          verificationPass: report.verification.pass,
          traceId: report.traceId,
          startedAtIso: runtimeToolSurfaceAdaptationStartedAtIso,
          recoveryObservedAt: runtimeToolRecoveryFeedback.observedAt,
          writeStderr: writeTurnDiagnostic,
        });
        if (
          !runtimeToolContextForTurn.adaptation.active &&
          !runtimeToolContextForTurn.guard.active
        ) {
          const successfulRecoveryConsumption =
            recordRuntimeToolSuccessfulRecoveryConsumption({
              workDir: input.workDir,
              recoveryFeedback: runtimeToolRecoveryFeedback,
              events: report.events,
              verificationPass: report.verification.pass,
              traceId: report.traceId,
              nowIso: nowIso(),
            });
          if (successfulRecoveryConsumption.recorded) {
            writeTurnDiagnostic(
              `[tool-recovery] event=successful_tool_call_consumed action=${runtimeToolRecoveryFeedback.recommendedNextAction ?? "<none>"} tool=${runtimeToolRecoveryFeedback.toolName ?? "<none>"} error_class=${runtimeToolRecoveryFeedback.errorClass ?? "<none>"} consumed_at=${successfulRecoveryConsumption.record?.consumedAt ?? "<none>"}\n`,
            );
          }
        }
        const presentation = prepareSuccessfulTurnReportPresentation({
          runnerInput: input,
          report,
          sessionKey,
          turnUserText,
          providerName: provider.name,
          interactiveMode,
          options,
          writeTurnDiagnostic,
          writeTurnDiagnosticEvents,
        });
        await recordTurn({
          userText: turnUserText,
          assistantText: presentation.assistantTextForHistory,
          stickyProvider,
          providerRuntimeStates: providerStates,
          onTurnRecorded: options?.onTurnRecorded,
        });
        if (presentation.activityFeedStdout.length > 0) {
          input.writeStdout(presentation.activityFeedStdout);
        }
        input.writeStdout(presentation.turnStdout);
        if (emitTerminalDiagnostics) {
          writeSuccessfulTurnDiagnostics({
            runnerInput: input,
            report,
            providerName: provider.name,
            attempts: failures.length + 1,
            stickyProvider,
            askUserEvent: presentation.askUserEvent,
            writeTurnDiagnostic,
          });
        }
        if (!report.verification.pass) {
          input.onVerificationFailure();
          const feedback = input.memoryOrchestrator.feedback({
            type: "verification_failure",
            sessionKey,
            userText: turnUserText,
            providerName: provider.name,
            errorMessage: "turn verification failed",
          });
          writeTurnDiagnosticEvents(feedback.stderrEvents);
        }
        const reflections =
          input.gaMechanismRuntime.pullReflectionTasks(sessionKey);
        if (emitTerminalDiagnostics) {
          for (const task of reflections) {
            input.writeStderr(
              `[reflection] trigger=${task.triggerType} id=${task.id} next_action="${task.nextActionHint}"\n`,
            );
          }
        }
        return report.verification.pass ? 0 : 1;
      } catch (error) {
        const rawMessage = String(error);
        const compactMessage = compactSingleLine(rawMessage, 240);
        const errorClass =
          extractRuntimeErrorClass(error) ?? resolveErrorClass(rawMessage);
        const errorData = normalizeProviderLastErrorData(
          extractRuntimeErrorData(error),
        );
        const runtimeErrorEvents = extractRuntimeErrorEvents(error);
        recordRuntimeToolMetricsForEvents({
          workDir: input.workDir,
          events: runtimeErrorEvents,
          source: "runtime_failure",
          writeStderr: writeTurnDiagnostic,
        });
        writeRuntimeToolSurfaceAdaptationOutcome({
          workDir: input.workDir,
          adaptation: runtimeToolContextForTurn.adaptation,
          events: runtimeErrorEvents,
          verificationPass: false,
          startedAtIso: runtimeToolSurfaceAdaptationStartedAtIso,
          recoveryObservedAt: runtimeToolRecoveryFeedback.observedAt,
          writeStderr: writeTurnDiagnostic,
        });
        if (errorClass === TURN_INTERRUPTED_ERROR_CLASS) {
          const providerStates = Array.from(providerStateMap.values());
          input.setProviderRuntimeStates(providerStates);
          input.updateActiveSessionProviderRuntime(
            input.getStickyProvider(),
            providerStates,
          );
          const gaState = input.gaMechanismRuntime.snapshotSession(sessionKey);
          input.setGaState(gaState);
          input.updateActiveSessionGaState(gaState);
          await input.persistSessionRegistryState();
          if (interactiveMode) {
            input.writeStdout(renderTurnInterruptedNotice(true));
          } else {
            input.writeStderr(renderTurnInterruptedNotice(false));
          }
          return TURN_INTERRUPTED_EXIT_CODE;
        }
        failures.push({
          providerName: provider.name,
          errorClass,
          errorMessage: compactMessage,
          errorData,
        });
        const feedback = input.memoryOrchestrator.feedback({
          type: "turn_failure",
          sessionKey,
          userText: turnUserText,
          providerName: provider.name,
          errorClass,
          errorMessage: compactMessage,
          failureStage: deriveFailureStageFromError(errorClass, compactMessage, errorData),
          toolContext: buildProviderFailureToolContext({
            providerName: provider.name,
            errorData,
          }),
          providerFailureDiagnostics: buildProviderFailureDiagnostics({
            providerName: provider.name,
            errorData,
          }),
        });
        writeTurnDiagnosticEvents(feedback.stderrEvents);
        const state =
          providerStateMap.get(provider.name) ??
          createDefaultProviderState(provider.name);
        updateProviderEwmaState({
          state,
          latencyMs: Date.now() - startedAtMs,
          isError: true,
        });
        state.consecutive_failures += 1;
        state.last_error_class = errorClass;
        state.last_error_message = compactMessage;
        state.last_error_data = errorData;
        state.last_failed_at = nowIso();
        if (
          state.consecutive_failures >=
          input.runtimeFailoverConfig.circuitFailures
        ) {
          state.circuit_open_until_ms =
            Date.now() +
            input.runtimeFailoverConfig.circuitCooldownSecs * 1_000;
        }
        providerStateMap.set(provider.name, state);
      } finally {
        releaseProviderCapacity(providerFlowStateMap, provider.name);
      }
    }

    const providerStates = Array.from(providerStateMap.values());
    input.setProviderRuntimeStates(providerStates);
    input.updateActiveSessionProviderRuntime(
      input.getStickyProvider(),
      providerStates,
    );
    const gaState = input.gaMechanismRuntime.snapshotSession(sessionKey);
    input.setGaState(gaState);
    input.updateActiveSessionGaState(gaState);
    await input.persistSessionRegistryState();
    input.writeStderr(
      renderRuntimeFailureSummary({
        failures,
        orderedProviders,
      }),
    );
    const reflections =
      input.gaMechanismRuntime.pullReflectionTasks(sessionKey);
    if (emitTerminalDiagnostics) {
      for (const task of reflections) {
        input.writeStderr(
          `[reflection] trigger=${task.triggerType} id=${task.id} next_action="${task.nextActionHint}"\n`,
        );
      }
    }
    return 1;
  };
}
