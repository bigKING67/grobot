import { OptionValue, readOptionString } from "../cli-args";
import { buildInteractiveHelpText } from "./session-interactive";
import { bootstrapRunStartState } from "./run-start-bootstrap";
import { resolveRunStartContext } from "./run-start-context";
import { runStartInteractiveMode } from "./run-start-interactive-mode";
import { runStartMessageMode } from "./run-start-message-mode";
import { createRunStartOutput } from "./run-start-output";
import { createRunStartPersistence } from "./run-start-persistence";
import { createRunStartRuntimeState } from "./run-start-runtime-state";
import { type SessionProviderRuntimeState } from "./session-registry";
import { createRunStartWire } from "./run-start-wire";

function providerHealthStatus(
  state: SessionProviderRuntimeState | undefined,
  failureThreshold: number,
): "CLOSED" | "OPEN" | "HALF_OPEN" {
  if (!state) {
    return "CLOSED";
  }
  const nowMs = Date.now();
  if (state.circuit_open_until_ms > nowMs) {
    return "OPEN";
  }
  if (state.consecutive_failures >= failureThreshold) {
    return "HALF_OPEN";
  }
  return "CLOSED";
}

function formatProviderHealthSnapshot(input: {
  sessionKey: string;
  stickyProvider?: string;
  failureThreshold: number;
  cooldownSecs: number;
  providers: ReadonlyArray<{
    name: string;
    maxInFlight?: number;
    requestsPerMinute?: number;
    burst?: number;
  }>;
  states: readonly SessionProviderRuntimeState[];
}): string {
  const lines: string[] = [];
  lines.push("[provider-health]");
  lines.push(`session: ${input.sessionKey}`);
  lines.push(`sticky_provider: ${input.stickyProvider ?? "<none>"}`);
  lines.push(`circuit: failures=${String(input.failureThreshold)} cooldown_secs=${String(input.cooldownSecs)}`);
  const stateByName = new Map<string, SessionProviderRuntimeState>();
  const providerByName = new Map<string, {
    name: string;
    maxInFlight?: number;
    requestsPerMinute?: number;
    burst?: number;
  }>();
  for (const state of input.states) {
    stateByName.set(state.provider_name, state);
  }
  for (const provider of input.providers) {
    providerByName.set(provider.name, provider);
  }
  const names = input.providers.length > 0
    ? input.providers.map((item) => item.name)
    : Array.from(stateByName.keys());
  if (names.length === 0) {
    lines.push("- <none>");
    return `${lines.join("\n")}\n\n`;
  }
  for (const name of names) {
    const state = stateByName.get(name);
    const provider = providerByName.get(name);
    const status = providerHealthStatus(state, input.failureThreshold);
    const openUntil = state && state.circuit_open_until_ms > 0
      ? new Date(state.circuit_open_until_ms).toISOString()
      : "n/a";
    const errorClass = state?.last_error_class ?? "-";
    const ewmaLatencyMs = typeof state?.ewma_latency_ms === "number"
      ? state.ewma_latency_ms.toFixed(1)
      : "n/a";
    const ewmaErrorRate = typeof state?.ewma_error_rate === "number"
      ? state.ewma_error_rate.toFixed(3)
      : "n/a";
    const maxInFlight = provider?.maxInFlight ?? "n/a";
    const requestsPerMinute = provider?.requestsPerMinute ?? "n/a";
    const burst = provider?.burst ?? "n/a";
    lines.push(
      `- ${name} status=${status} failures=${String(state?.consecutive_failures ?? 0)} open_until=${openUntil} last_error=${errorClass} ewma_latency_ms=${ewmaLatencyMs} ewma_error_rate=${ewmaErrorRate} max_inflight=${String(maxInFlight)} rpm=${String(requestsPerMinute)} burst=${String(burst)}`,
    );
  }
  return `${lines.join("\n")}\n\n`;
}

export async function runStart(options: Record<string, OptionValue>): Promise<number> {
  const context = resolveRunStartContext(options);
  const {
    homeDir,
    projectRoot,
    workDir,
    projectName,
    historyTurns,
    handoffRecentTurns,
    handoffAutoOnExit,
    handoffPath,
    interruptStorePath,
    subject,
    executionPlane,
    runtimeModelConfig,
    runtimeProviderChain,
    runtimeFailoverConfig,
    runtimeModelConfigSource,
    sessionNamespaceKey,
    sessionRegistryFilePathValue,
    sessionStore,
  } = context;
  const output = createRunStartOutput();

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

  const { handoff, sessionOps, executeTurn } = createRunStartWire({
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
    runtimeState,
    persistence,
    writeStoreWarnings: output.writeStoreWarnings,
    writeStdout: output.writeStdout,
    writeStderr: output.writeStderr,
  });

  const message = readOptionString(options, "message");
  if (message) {
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

  await runStartInteractiveMode({
    homeDir,
    projectRoot,
    projectName,
    workDir,
    sessionKey: runtimeState.getSessionKey(),
    sessionNamespaceKey,
    activeSessionId: runtimeState.getActiveSessionId(),
    sessionStoreRuntime: sessionStore.getRuntime(),
    sessionRegistryFilePathValue,
    handoffAutoOnExit,
    handoffRecentTurns,
    handoffPath,
    restoredTurns: runtimeState.getRestoredTurns(),
    restoreSource: runtimeState.getRestoreSource(),
    buildHelpText: buildInteractiveHelpText,
    showHealthStatus: () => {
      output.writeStdout(
          formatProviderHealthSnapshot({
            sessionKey: runtimeState.getSessionKey(),
            stickyProvider: runtimeState.getStickyProvider(),
            failureThreshold: runtimeFailoverConfig.circuitFailures,
            cooldownSecs: runtimeFailoverConfig.circuitCooldownSecs,
            providers: runtimeProviderChain.map((item) => ({
              name: item.name,
              maxInFlight: item.maxInFlight,
              requestsPerMinute: item.requestsPerMinute,
              burst: item.burst,
            })),
            states: runtimeState.getProviderRuntimeStates(),
          }),
        );
      },
    printSessionOverview: () => {
      sessionOps.printSessionOverview();
    },
    createNewSession: sessionOps.createNewSession,
    switchActiveSession: sessionOps.switchActiveSession,
    continueFromSession: sessionOps.continueFromSession,
    writeManualHandoff: () => {
      handoff.writeHandoff("manual-command", false);
    },
    executeTurn,
    markFailureObserved: runtimeState.markFailureObserved,
    getHistoryMessagesCount: () => runtimeState.getHistoryMessages().length,
    writeAutoExitHandoffIfNeeded: () => {
      handoff.writeAutoExitHandoffIfNeeded(false);
    },
  });
  return 0;
}
