import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adaptRuntimeToolContextForRecovery } from "../../../tools/runtime/default-enabled-tools";
import {
  applyRuntimeToolRecoveryConsumption,
  applyRuntimeToolSurfaceAdaptationGuard,
  buildRuntimeToolSurfaceAdaptationGuardPrompt,
  readRuntimeToolSurfaceAdaptationState,
  recordRuntimeToolNonRecoverableInterventionPrompt,
  recordRuntimeToolSuccessfulRecoveryConsumption,
  recordRuntimeToolSurfaceAdaptationOutcome,
  recordRuntimeToolSurfaceRecoveryConsumption,
} from "../../../tools/runtime/tool-surface-adaptation-state";
import { buildRuntimeToolRecoveryReadinessGate } from "../../../tools/runtime/tool-recovery-readiness-gate";
import {
  activeRecoveryFeedback,
  build,
  contractWorkDir,
  event,
  expect,
  expectDeepEqual,
  expectEqual,
  inactiveRecoveryFeedback,
  withEnvProfile,
} from "./helpers";

export type RuntimeToolSurfaceRecoveryContractResult = {
  adaptedBrowserProfile: string | undefined;
  adaptedContextProfile: string | undefined;
  adaptedMcpProfile: string | undefined;
  codeSymbolRecoveryAdapted: boolean;
  directBrowserRecoveryProfile: string | undefined;
  staleRecoveryAdapted: boolean;
  nonrecoverableBlocksAutoAdaptation: boolean | undefined;
  gateBlocksSurfaceAdaptation: boolean | undefined;
  gateBlockedSurfaceAdaptationReason: string | undefined;
};

export function runRecoveryAdaptationContract(): RuntimeToolSurfaceRecoveryContractResult {
  const coding = withEnvProfile(undefined, () => build(undefined));
  const fullDebug = withEnvProfile("full_debug", () => build("普通 coding task"));

  const adaptedBrowser = adaptRuntimeToolContextForRecovery({
    context: coding,
    recoveryFeedback: activeRecoveryFeedback({
      toolName: "web_scan",
      errorClass: "tool_not_visible",
    }),
  });
  expectEqual(adaptedBrowser.adaptation.active, true, "browser recovery adaptation active");
  expectEqual(adaptedBrowser.context?.toolSurfaceProfile, "browser", "browser recovery adapts profile");
  expectEqual(adaptedBrowser.context?.toolSurfaceSource, "metrics_recovery", "browser recovery source");
  expectEqual(adaptedBrowser.adaptation.recoveryRecoverable, true, "browser recovery recoverable is exposed");
  expectEqual(adaptedBrowser.context?.toolSurfaceDecision?.profile, "coding", "recovery keeps original message decision trace");
  expectDeepEqual(adaptedBrowser.context?.modelVisibleTools, ["web_scan", "web_execute_js", "read", "ask_user"], "browser recovery visible tools");

  const nonRecoverableBrowserRecovery = adaptRuntimeToolContextForRecovery({
    context: coding,
    recoveryFeedback: activeRecoveryFeedback({
      toolName: "web_scan",
      errorClass: "config_missing",
      stage: "ask_user",
      recoverable: false,
    }),
  });
  expectEqual(nonRecoverableBrowserRecovery.adaptation.active, false, "nonrecoverable recovery does not adapt");
  expectEqual(
    nonRecoverableBrowserRecovery.adaptation.reason,
    "recovery_requires_user_intervention",
    "nonrecoverable recovery reason",
  );
  expectEqual(
    nonRecoverableBrowserRecovery.adaptation.autoAdaptationBlocked,
    true,
    "nonrecoverable recovery blocks automatic adaptation",
  );
  expectEqual(
    nonRecoverableBrowserRecovery.adaptation.recoveryRecoverable,
    false,
    "nonrecoverable recovery observable",
  );
  expectEqual(
    nonRecoverableBrowserRecovery.context?.toolSurfaceProfile,
    "coding",
    "nonrecoverable recovery keeps coding profile",
  );

  const unknownRecoverabilityBrowserRecovery = adaptRuntimeToolContextForRecovery({
    context: coding,
    recoveryFeedback: activeRecoveryFeedback({
      toolName: "web_scan",
      errorClass: "tool_not_visible",
      recoverable: null,
    }),
  });
  expectEqual(
    unknownRecoverabilityBrowserRecovery.adaptation.active,
    true,
    "unknown recoverability preserves legacy recovery adaptation",
  );
  expectEqual(
    unknownRecoverabilityBrowserRecovery.adaptation.autoAdaptationBlocked,
    false,
    "unknown recoverability does not block automatic adaptation",
  );
  expectEqual(
    unknownRecoverabilityBrowserRecovery.adaptation.recoveryRecoverable,
    null,
    "unknown recoverability remains observable",
  );
  expectEqual(
    unknownRecoverabilityBrowserRecovery.context?.toolSurfaceProfile,
    "browser",
    "unknown recoverability can still adapt browser profile",
  );

  const gateBlockedBrowserRecovery = adaptRuntimeToolContextForRecovery({
    context: coding,
    recoveryFeedback: activeRecoveryFeedback({
      toolName: "web_scan",
      errorClass: "tool_not_visible",
      recoverable: true,
    }),
    recoveryGate: buildRuntimeToolRecoveryReadinessGate({
      readiness: {
        status: "degraded",
        ready: false,
        automaticRecoveryAllowed: false,
        operatorActionRequired: false,
        reason: "health_watch:policy_denied_recovery",
        recommendedNextAction: "inspect_runtime_tool_recovery_policy",
        policyVersion: "v1",
        healthLevel: "watch",
        healthScore: 94,
        riskScoreThreshold: 70,
        watchScoreThreshold: 95,
        attentionRecoveryKey: "strategy_switch:web_scan:tool_not_visible:2026-04-25T00:00:00.000Z",
        attentionSource: "latest",
        attentionStage: "strategy_switch",
        attentionToolName: "web_scan",
        attentionErrorClass: "tool_not_visible",
        attentionRequiresUserIntervention: false,
        attentionRuntimeEnvironmentRecovery: null,
        attentionBrowserEnvironmentRecovery: null,
        attentionMcpEnvironmentRecovery: null,
      },
    }),
  });
  expectEqual(gateBlockedBrowserRecovery.adaptation.active, false, "gate fail blocks surface adaptation");
  expectEqual(
    gateBlockedBrowserRecovery.adaptation.reason,
    "recovery_gate_automatic_recovery_denied",
    "gate fail adaptation reason",
  );
  expectEqual(
    gateBlockedBrowserRecovery.adaptation.autoAdaptationBlocked,
    true,
    "gate fail marks automatic adaptation blocked",
  );
  expectEqual(gateBlockedBrowserRecovery.context?.toolSurfaceProfile, "coding", "gate fail keeps coding profile");

  const adaptedContext = adaptRuntimeToolContextForRecovery({
    context: coding,
    recoveryFeedback: activeRecoveryFeedback({
      toolName: "semantic_search",
      errorClass: "tool_not_visible",
    }),
  });
  expectEqual(adaptedContext.adaptation.active, true, "context recovery adaptation active");
  expectEqual(adaptedContext.context?.toolSurfaceProfile, "context", "context recovery adapts profile");
  expectDeepEqual(adaptedContext.context?.modelVisibleTools, ["semantic_search", "read", "ask_user"], "context recovery visible tools");

  const adaptedMcp = adaptRuntimeToolContextForRecovery({
    context: coding,
    recoveryFeedback: activeRecoveryFeedback({
      toolName: "mcp_call",
      errorClass: "tool_disabled",
    }),
  });
  expectEqual(adaptedMcp.adaptation.active, true, "mcp recovery adaptation active");
  expectEqual(adaptedMcp.context?.toolSurfaceProfile, "mcp", "mcp recovery adapts profile");
  expectDeepEqual(adaptedMcp.context?.modelVisibleTools, ["mcp_servers", "mcp_call", "ask_user"], "mcp recovery visible tools");

  const codeSymbolRecovery = adaptRuntimeToolContextForRecovery({
    context: coding,
    recoveryFeedback: activeRecoveryFeedback({
      toolName: "web_scan",
      errorClass: "tool_not_visible",
    }),
    userMessage: "优化 web_scan schema 和 web_execute_js contract",
  });
  expectEqual(codeSymbolRecovery.adaptation.active, false, "code-symbol recovery should not switch browser profile");
  expectEqual(codeSymbolRecovery.adaptation.reason, "no_safe_profile_for_recovery", "code-symbol recovery reason");
  expectEqual(codeSymbolRecovery.context?.toolSurfaceProfile, "coding", "code-symbol recovery keeps coding profile");

  const directBrowserRecovery = adaptRuntimeToolContextForRecovery({
    context: coding,
    recoveryFeedback: activeRecoveryFeedback({
      toolName: "web_scan",
      errorClass: "tool_not_visible",
    }),
    userMessage: "用 web_scan 扫描当前页面",
  });
  expectEqual(directBrowserRecovery.adaptation.active, true, "direct browser recovery still adapts");
  expectEqual(directBrowserRecovery.context?.toolSurfaceProfile, "browser", "direct browser recovery profile");

  const staleRecovery = adaptRuntimeToolContextForRecovery({
    context: coding,
    recoveryFeedback: inactiveRecoveryFeedback,
  });
  expectEqual(staleRecovery.adaptation.active, false, "stale recovery does not adapt");
  expectEqual(staleRecovery.context?.toolSurfaceProfile, "coding", "stale recovery keeps coding profile");

  const envFullDebugRecovery = adaptRuntimeToolContextForRecovery({
    context: fullDebug,
    recoveryFeedback: activeRecoveryFeedback({
      toolName: "web_scan",
      errorClass: "tool_not_visible",
    }),
  });
  expectEqual(envFullDebugRecovery.adaptation.active, false, "env profile should not adapt");
  expectEqual(envFullDebugRecovery.context?.toolSurfaceProfile, "full_debug", "env profile remains full_debug");

  const adaptationWorkDir = join(contractWorkDir, "adaptation-state");
  mkdirSync(adaptationWorkDir, { recursive: true });
  try {
    const initialAdaptationState = readRuntimeToolSurfaceAdaptationState(adaptationWorkDir);
    expectEqual(initialAdaptationState.latestAdaptation, null, "initial adaptation state has no latest record");

    const invalidConsumptionWorkDir = join(adaptationWorkDir, "invalid-consumption");
    const invalidConsumptionStateDir = join(invalidConsumptionWorkDir, ".grobot/runtime");
    mkdirSync(invalidConsumptionStateDir, { recursive: true });
    writeFileSync(
      join(invalidConsumptionStateDir, "tool-surface-adaptation-state.json"),
      `${JSON.stringify({
        version: 1,
        updatedAt: "2026-04-25T00:00:00.000Z",
        recentAdaptations: [],
        profileOutcomes: {},
        recentRecoveryConsumptions: [
          {
            id: "bad_consumption",
            reason: "not_a_known_reason",
            recoveryStage: "strategy_switch",
            recoveryToolName: "web_scan",
            recoveryErrorClass: "tool_not_visible",
            recoveryObservedAt: "2026-04-25T00:00:00.000Z",
            consumedAt: "not-a-date",
            traceId: null,
          },
        ],
      })}\n`,
      "utf8",
    );
    const invalidConsumptionSnapshot = readRuntimeToolSurfaceAdaptationState(invalidConsumptionWorkDir);
    expectEqual(invalidConsumptionSnapshot.recentRecoveryConsumptions.length, 0, "invalid consumption rows are ignored");

    const nonrecoverableConsumptionWorkDir = join(adaptationWorkDir, "nonrecoverable-consumption");
    mkdirSync(nonrecoverableConsumptionWorkDir, { recursive: true });
    const nonrecoverableObservedAt = "2026-04-25T00:00:10.000Z";
    const nonrecoverableFeedback = activeRecoveryFeedback({
      toolName: "web_scan",
      errorClass: "config_missing",
      stage: "ask_user",
      observedAt: nonrecoverableObservedAt,
      recoverable: false,
    });
    const nonrecoverableConsumption = recordRuntimeToolNonRecoverableInterventionPrompt({
      workDir: nonrecoverableConsumptionWorkDir,
      recoveryFeedback: nonrecoverableFeedback,
      traceId: "trace_nonrecoverable_prompted",
      nowIso: "2026-04-25T00:00:11.000Z",
    });
    expectEqual(nonrecoverableConsumption.recorded, true, "nonrecoverable intervention prompt consumption recorded");
    expectEqual(
      nonrecoverableConsumption.record?.reason,
      "nonrecoverable_intervention_prompted",
      "nonrecoverable intervention consumption reason",
    );
    expectEqual(
      nonrecoverableConsumption.snapshot.latestRecoveryConsumption?.reason,
      "nonrecoverable_intervention_prompted",
      "nonrecoverable intervention latest consumption reason",
    );
    const duplicateNonrecoverableConsumption = recordRuntimeToolNonRecoverableInterventionPrompt({
      workDir: nonrecoverableConsumptionWorkDir,
      recoveryFeedback: nonrecoverableFeedback,
      traceId: "trace_nonrecoverable_prompted_duplicate",
      nowIso: "2026-04-25T00:00:12.000Z",
    });
    expectEqual(duplicateNonrecoverableConsumption.recorded, false, "nonrecoverable intervention prompt is deduped");
    const consumedNonrecoverableFeedback = applyRuntimeToolRecoveryConsumption({
      feedback: {
        ...nonrecoverableFeedback,
        observedAt: "2026-04-25T00:00:10.500Z",
      },
      snapshot: nonrecoverableConsumption.snapshot,
    });
    expectEqual(consumedNonrecoverableFeedback.active, false, "nonrecoverable consumption suppresses same prompt");
    expectEqual(consumedNonrecoverableFeedback.consumed, true, "nonrecoverable consumption marks feedback consumed");
    expectEqual(
      consumedNonrecoverableFeedback.consumedReason,
      "nonrecoverable_intervention_prompted",
      "nonrecoverable consumed feedback reason",
    );
    const newerNonrecoverableFeedback = applyRuntimeToolRecoveryConsumption({
      feedback: {
        ...nonrecoverableFeedback,
        observedAt: "2026-04-25T00:00:12.000Z",
      },
      snapshot: nonrecoverableConsumption.snapshot,
    });
    expectEqual(newerNonrecoverableFeedback.active, true, "newer nonrecoverable recovery remains active");

    const recoveredWrite = recordRuntimeToolSurfaceAdaptationOutcome({
      workDir: adaptationWorkDir,
      adaptation: adaptedBrowser.adaptation,
      events: [
        event("tool_end", {
          tool_name: "web_scan",
          status: "ok",
        }),
      ],
      verificationPass: true,
      traceId: "trace_recovered",
      nowIso: "2026-04-25T00:00:01.000Z",
    });
    expectEqual(recoveredWrite.recorded, true, "recovered adaptation recorded");
    expectEqual(recoveredWrite.record?.outcome, "recovered", "recovered adaptation outcome");
    expectEqual(recoveredWrite.snapshot.profileOutcomes.browser.recoveredTotal, 1, "browser recovered total");
    expectEqual(recoveredWrite.snapshot.profileOutcomes.browser.recoveryRate, 1, "browser recovery rate");
    expectEqual(recoveredWrite.snapshot.recentRecoveryConsumptions.length, 1, "recovered adaptation consumes recovery signal");
    expectEqual(recoveredWrite.snapshot.latestRecoveryConsumption?.reason, "recovered_signal_consumed", "recovered consumption reason");

    const consumedRecoveredFeedback = applyRuntimeToolRecoveryConsumption({
      feedback: {
        ...activeRecoveryFeedback({
          toolName: "web_scan",
          errorClass: "tool_not_visible",
        }),
        observedAt: "2026-04-25T00:00:00.500Z",
      },
      snapshot: recoveredWrite.snapshot,
    });
    expectEqual(consumedRecoveredFeedback.active, false, "recovered consumption suppresses stale recovery feedback");
    expectEqual(consumedRecoveredFeedback.consumed, true, "recovered consumption marks feedback consumed");
    expectEqual(consumedRecoveredFeedback.consumedReason, "recovered_signal_consumed", "recovered feedback consumed reason");

    const successfulConsumptionWorkDir = join(adaptationWorkDir, "successful-tool-consumption");
    mkdirSync(successfulConsumptionWorkDir, { recursive: true });
    const successfulRecoveryFeedback = activeRecoveryFeedback({
      toolName: "read",
      errorClass: "path_not_found",
      stage: "local_fix",
      observedAt: "2026-04-25T00:00:10.000Z",
    });
    const successfulConsumption = recordRuntimeToolSuccessfulRecoveryConsumption({
      workDir: successfulConsumptionWorkDir,
      recoveryFeedback: successfulRecoveryFeedback,
      events: [
        event("tool_end", {
          tool_name: "read",
          status: "ok",
        }),
      ],
      verificationPass: true,
      traceId: "trace_successful_recovery",
      nowIso: "2026-04-25T00:00:11.000Z",
    });
    expectEqual(successfulConsumption.recorded, true, "successful tool call consumption recorded");
    expectEqual(
      successfulConsumption.record?.reason,
      "successful_tool_call_consumed",
      "successful consumption reason",
    );
    const consumedSuccessfulFeedback = applyRuntimeToolRecoveryConsumption({
      feedback: successfulRecoveryFeedback,
      snapshot: successfulConsumption.snapshot,
    });
    expectEqual(consumedSuccessfulFeedback.active, false, "successful tool call suppresses stale recovery feedback");
    expectEqual(consumedSuccessfulFeedback.consumed, true, "successful tool call marks feedback consumed");
    expectEqual(
      consumedSuccessfulFeedback.consumedReason,
      "successful_tool_call_consumed",
      "successful tool call consumed reason",
    );
    const failedVerificationConsumption = recordRuntimeToolSuccessfulRecoveryConsumption({
      workDir: successfulConsumptionWorkDir,
      recoveryFeedback: {
        ...successfulRecoveryFeedback,
        observedAt: "2026-04-25T00:00:12.000Z",
      },
      events: [
        event("tool_end", {
          tool_name: "read",
          status: "ok",
        }),
      ],
      verificationPass: false,
      nowIso: "2026-04-25T00:00:13.000Z",
    });
    expectEqual(failedVerificationConsumption.recorded, false, "failed verification does not consume recovery");

    const newerRecoveredFeedback = applyRuntimeToolRecoveryConsumption({
      feedback: {
        ...activeRecoveryFeedback({
          toolName: "web_scan",
          errorClass: "tool_not_visible",
        }),
        observedAt: "2026-04-25T00:00:02.000Z",
      },
      snapshot: recoveredWrite.snapshot,
    });
    expectEqual(newerRecoveredFeedback.active, true, "newer recovery signal remains active after prior consumption");

    const newerRecoveredAdaptation = adaptRuntimeToolContextForRecovery({
      context: coding,
      recoveryFeedback: newerRecoveredFeedback,
    });
    const newerRecoveredGuard = applyRuntimeToolSurfaceAdaptationGuard({
      baseContext: coding,
      result: newerRecoveredAdaptation,
      snapshot: recoveredWrite.snapshot,
    });
    expectEqual(newerRecoveredGuard.guard.active, false, "newer recovery signal bypasses consumed guard");
    expectEqual(newerRecoveredGuard.adaptation.active, true, "newer recovery signal can adapt after prior recovery");

    const unobservedRecoveredFeedback = applyRuntimeToolRecoveryConsumption({
      feedback: activeRecoveryFeedback({
        toolName: "web_scan",
        errorClass: "tool_not_visible",
        observedAt: null,
      }),
      snapshot: recoveredWrite.snapshot,
    });
    expectEqual(unobservedRecoveredFeedback.active, true, "untimestamped active recovery feedback fails open");
    expectEqual(unobservedRecoveredFeedback.consumed, false, "untimestamped active recovery feedback is not consumed");

    const consumedRecoveryGuard = applyRuntimeToolSurfaceAdaptationGuard({
      baseContext: coding,
      result: adaptedBrowser,
      snapshot: recoveredWrite.snapshot,
    });
    expectEqual(consumedRecoveryGuard.guard.active, true, "recovered signal activates consumed guard");
    expectEqual(consumedRecoveryGuard.guard.reason, "recovered_signal_consumed", "recovered signal consumed guard reason");
    expectEqual(consumedRecoveryGuard.context?.toolSurfaceProfile, "coding", "consumed guard falls back to coding context");
    expectEqual(consumedRecoveryGuard.adaptation.active, false, "consumed guard blocks stale recovered adaptation");
    expectEqual(consumedRecoveryGuard.adaptation.recommendedProfile, "browser", "consumed guard keeps recommended profile observable");
    const consumedRecoveryGuardPrompt = buildRuntimeToolSurfaceAdaptationGuardPrompt({
      guard: consumedRecoveryGuard.guard,
      recoveryFeedback: activeRecoveryFeedback({
        toolName: "web_scan",
        errorClass: "tool_not_visible",
      }),
    });
    expect(consumedRecoveryGuardPrompt.includes("Runtime Tool Surface Guard"), "guard prompt header");
    expect(consumedRecoveryGuardPrompt.includes("recovered_signal_consumed"), "guard prompt reason");
    expect(consumedRecoveryGuardPrompt.includes("Suppressed recovery hint"), "guard prompt suppresses stale recovery hint");
    expect(consumedRecoveryGuardPrompt.includes("Treat that signal as consumed"), "guard prompt gives consumed signal rule");

    for (let index = 0; index < 2; index += 1) {
      recordRuntimeToolSurfaceAdaptationOutcome({
        workDir: adaptationWorkDir,
        adaptation: adaptedBrowser.adaptation,
        events: [
          event("tool_end", {
            tool_name: "web_scan",
            status: "failed",
            error_class: "tool_not_visible",
          }),
          event("tool_recovery", {
            tool_name: "web_scan",
            error_class: "tool_not_visible",
            recovery_stage: "strategy_switch",
            recovery_reason: "tool_not_visible",
            recommended_next_action: "switch_tool_strategy",
          }),
        ],
        verificationPass: false,
        traceId: `trace_failed_${String(index)}`,
        nowIso: `2026-04-25T00:00:0${String(index + 2)}.000Z`,
      });
    }
    const failedSnapshot = readRuntimeToolSurfaceAdaptationState(adaptationWorkDir);
    expectEqual(failedSnapshot.profileOutcomes.browser.failedTotal, 2, "browser failed total");
    expectEqual(failedSnapshot.profileOutcomes.browser.recoveryRate, 0.3333, "browser recovery rate after failures");

    const guardedBrowser = applyRuntimeToolSurfaceAdaptationGuard({
      baseContext: coding,
      result: adaptedBrowser,
      snapshot: failedSnapshot,
    });
    expectEqual(guardedBrowser.guard.active, true, "repeated failed adaptation activates guard");
    expectEqual(guardedBrowser.guard.reason, "repeated_profile_failure", "repeated failure guard reason");
    expectEqual(guardedBrowser.context?.toolSurfaceProfile, "coding", "guard falls back to coding context");
    expectEqual(guardedBrowser.adaptation.active, false, "guard blocks active adaptation");
    expectEqual(guardedBrowser.adaptation.recommendedProfile, "browser", "guard keeps recommended profile observable");
    const guardedConsumption = recordRuntimeToolSurfaceRecoveryConsumption({
      workDir: adaptationWorkDir,
      guard: guardedBrowser.guard,
      recoveryFeedback: {
        ...activeRecoveryFeedback({
          toolName: "web_scan",
          errorClass: "tool_not_visible",
        }),
        observedAt: "2026-04-25T00:00:03.000Z",
      },
      nowIso: "2026-04-25T00:00:04.000Z",
    });
    expectEqual(guardedConsumption.recorded, true, "guarded recovery consumption recorded");
    expectEqual(guardedConsumption.record?.reason, "repeated_profile_failure", "guarded consumption reason");
    const consumedGuardedFeedback = applyRuntimeToolRecoveryConsumption({
      feedback: {
        ...activeRecoveryFeedback({
          toolName: "web_scan",
          errorClass: "tool_not_visible",
        }),
        observedAt: "2026-04-25T00:00:03.500Z",
      },
      snapshot: guardedConsumption.snapshot,
    });
    expectEqual(consumedGuardedFeedback.active, false, "guarded consumption suppresses stale recovery feedback");
    expectEqual(consumedGuardedFeedback.consumedReason, "repeated_profile_failure", "guarded feedback consumed reason");

    const oscillationWorkDir = join(adaptationWorkDir, "oscillation");
    mkdirSync(oscillationWorkDir, { recursive: true });
    const oscillationSequence = [
      { adaptation: adaptedBrowser.adaptation, toolName: "web_scan", errorClass: "tool_not_visible" },
      { adaptation: adaptedContext.adaptation, toolName: "semantic_search", errorClass: "tool_not_visible" },
      { adaptation: adaptedBrowser.adaptation, toolName: "web_scan", errorClass: "tool_not_visible" },
    ];
    for (const [index, item] of oscillationSequence.entries()) {
      recordRuntimeToolSurfaceAdaptationOutcome({
        workDir: oscillationWorkDir,
        adaptation: item.adaptation,
        events: [
          event("tool_end", {
            tool_name: item.toolName,
            status: "failed",
            error_class: item.errorClass,
          }),
        ],
        verificationPass: false,
        traceId: `trace_oscillation_${String(index)}`,
        nowIso: `2026-04-25T00:01:0${String(index)}.000Z`,
      });
    }
    const oscillationGuarded = applyRuntimeToolSurfaceAdaptationGuard({
      baseContext: coding,
      result: adaptedContext,
      snapshot: readRuntimeToolSurfaceAdaptationState(oscillationWorkDir),
    });
    expectEqual(oscillationGuarded.guard.active, true, "failed A/B/A plus candidate B activates oscillation guard");
    expectEqual(oscillationGuarded.guard.reason, "profile_oscillation", "oscillation guard reason");
    expectDeepEqual(oscillationGuarded.guard.recentProfileSequence, ["browser", "context", "browser", "context"], "oscillation profile sequence");

    const recoveredOscillationWorkDir = join(adaptationWorkDir, "recovered-oscillation");
    mkdirSync(recoveredOscillationWorkDir, { recursive: true });
    for (const [index, item] of oscillationSequence.entries()) {
      recordRuntimeToolSurfaceAdaptationOutcome({
        workDir: recoveredOscillationWorkDir,
        adaptation: item.adaptation,
        events: [
          event("tool_end", {
            tool_name: item.toolName,
            status: "ok",
          }),
        ],
        verificationPass: true,
        traceId: `trace_recovered_oscillation_${String(index)}`,
        nowIso: `2026-04-25T00:02:0${String(index)}.000Z`,
      });
    }
    const recoveredOscillationGuarded = applyRuntimeToolSurfaceAdaptationGuard({
      baseContext: coding,
      result: adaptedContext,
      snapshot: readRuntimeToolSurfaceAdaptationState(recoveredOscillationWorkDir),
    });
    expectEqual(recoveredOscillationGuarded.guard.active, false, "recovered A/B/A does not activate oscillation guard");
    expectEqual(recoveredOscillationGuarded.adaptation.active, true, "successful alternation keeps candidate adaptation active");

    const inactiveWrite = recordRuntimeToolSurfaceAdaptationOutcome({
      workDir: adaptationWorkDir,
      adaptation: staleRecovery.adaptation,
      events: [],
      verificationPass: true,
    });
    expectEqual(inactiveWrite.recorded, false, "inactive adaptation not recorded");
  } finally {
    rmSync(adaptationWorkDir, { recursive: true, force: true });
  }

  return {
    adaptedBrowserProfile: adaptedBrowser.context?.toolSurfaceProfile,
    adaptedContextProfile: adaptedContext.context?.toolSurfaceProfile,
    adaptedMcpProfile: adaptedMcp.context?.toolSurfaceProfile,
    codeSymbolRecoveryAdapted: codeSymbolRecovery.adaptation.active,
    directBrowserRecoveryProfile: directBrowserRecovery.context?.toolSurfaceProfile,
    staleRecoveryAdapted: staleRecovery.adaptation.active,
    nonrecoverableBlocksAutoAdaptation: nonRecoverableBrowserRecovery.adaptation.autoAdaptationBlocked,
    gateBlocksSurfaceAdaptation: gateBlockedBrowserRecovery.adaptation.autoAdaptationBlocked,
    gateBlockedSurfaceAdaptationReason: gateBlockedBrowserRecovery.adaptation.reason,
  };
}
