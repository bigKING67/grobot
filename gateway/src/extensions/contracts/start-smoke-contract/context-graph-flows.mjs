import { mkdirSync, writeFileSync } from "node:fs";

function extractGraphAutotuneTelemetry(stderr) {
  const graphAutotuneEvent = stderr.match(
    /event=graph_quality_autotune action=([a-z_]+) reason=([a-z_+]+) suppressed=([a-z_]+) dep_rows=(\d+)->(\d+) symbol_rows=(\d+)->(\d+) entries=(\d+) quality_entries=(\d+)/,
  );
  const graphAutotuneAdaptiveEvent = stderr.match(
    /adaptive_threshold_source=([a-z_]+) adaptive_updated=(true|false) adaptive_alpha=([0-9.]+) adaptive_updates=(\d+) adaptive_thresholds=([0-9.]+)\/([0-9.]+)\/([0-9.]+)\/([0-9.]+)/,
  );
  const graphAutotuneAdaptiveActionEvent = stderr.match(
    /adaptive_action_source=([a-z_]+) adaptive_action_updated=(true|false) adaptive_action_scale=([0-9.]+) adaptive_action_updates=(\d+)/,
  );
  return {
    graph_autotune_seen: Boolean(graphAutotuneEvent),
    graph_autotune_action: graphAutotuneEvent?.[1] ?? "",
    graph_autotune_reason: graphAutotuneEvent?.[2] ?? "",
    graph_autotune_suppressed: graphAutotuneEvent?.[3] ?? "",
    graph_autotune_dep_rows_from: Number.parseInt(graphAutotuneEvent?.[4] ?? "0", 10),
    graph_autotune_dep_rows_to: Number.parseInt(graphAutotuneEvent?.[5] ?? "0", 10),
    graph_autotune_symbol_rows_from: Number.parseInt(graphAutotuneEvent?.[6] ?? "0", 10),
    graph_autotune_symbol_rows_to: Number.parseInt(graphAutotuneEvent?.[7] ?? "0", 10),
    graph_autotune_entries: Number.parseInt(graphAutotuneEvent?.[8] ?? "0", 10),
    graph_autotune_quality_entries: Number.parseInt(graphAutotuneEvent?.[9] ?? "0", 10),
    graph_autotune_adaptive_source: graphAutotuneAdaptiveEvent?.[1] ?? "",
    graph_autotune_adaptive_updated: graphAutotuneAdaptiveEvent?.[2] ?? "",
    graph_autotune_adaptive_alpha: Number.parseFloat(graphAutotuneAdaptiveEvent?.[3] ?? "0"),
    graph_autotune_adaptive_updates: Number.parseInt(graphAutotuneAdaptiveEvent?.[4] ?? "0", 10),
    graph_autotune_adaptive_cache_threshold:
      Number.parseFloat(graphAutotuneAdaptiveEvent?.[5] ?? "0"),
    graph_autotune_adaptive_parsed_max:
      Number.parseFloat(graphAutotuneAdaptiveEvent?.[6] ?? "0"),
    graph_autotune_adaptive_reused_min:
      Number.parseFloat(graphAutotuneAdaptiveEvent?.[7] ?? "0"),
    graph_autotune_adaptive_removed_max:
      Number.parseFloat(graphAutotuneAdaptiveEvent?.[8] ?? "0"),
    graph_autotune_adaptive_action_source: graphAutotuneAdaptiveActionEvent?.[1] ?? "",
    graph_autotune_adaptive_action_updated: graphAutotuneAdaptiveActionEvent?.[2] ?? "",
    graph_autotune_adaptive_action_scale:
      Number.parseFloat(graphAutotuneAdaptiveActionEvent?.[3] ?? "0"),
    graph_autotune_adaptive_action_updates:
      Number.parseInt(graphAutotuneAdaptiveActionEvent?.[4] ?? "0", 10),
  };
}

function writeGraphAutotuneSeedRows(seedPath, input) {
  const seedNowMs = Date.now();
  const rows = [0, 1].map((index) => ({
    ts: new Date(seedNowMs - (2 - index) * 1_000).toISOString(),
    sessionKey: input.sessionKey,
    stage: "normal",
    selectionReason: "seed",
    delta: {
      symbolQuery: { hit: input.queryHit, miss: input.queryMiss, write: 0, evict: 0 },
      symbolDeclaration: { hit: input.queryHit, miss: input.queryMiss, write: 0, evict: 0 },
      dependencyQuery: { hit: input.queryHit, miss: input.queryMiss, write: 0, evict: 0 },
      dependencyImport: { hit: input.queryHit, miss: input.queryMiss, write: 0, evict: 0 },
    },
    total: {
      symbolQuery: {
        hit: input.queryHit + index,
        miss: input.queryMiss + 1,
        write: 1,
        evict: 0,
      },
      symbolDeclaration: {
        hit: input.queryHit + index,
        miss: input.queryMiss + 1,
        write: 1,
        evict: 0,
      },
      dependencyQuery: {
        hit: input.queryHit + index,
        miss: input.queryMiss + 1,
        write: 1,
        evict: 0,
      },
      dependencyImport: {
        hit: input.queryHit + index,
        miss: input.queryMiss + 1,
        write: 1,
        evict: 0,
      },
    },
    quality: {
      dependency: {
        rows: input.quality.dependency.rows,
        multiHopRows: input.quality.dependency.multiHopRows,
        depth4PlusRows: input.quality.dependency.depth4PlusRows,
        maxChainDepth: input.quality.dependency.maxChainDepth,
      },
      symbol: {
        rows: input.quality.symbol.rows,
        rowsWithBridge: input.quality.symbol.rowsWithBridge,
        rowsWithBreadth: input.quality.symbol.rowsWithBreadth,
        bridgeTotal: input.quality.symbol.bridgeTotal,
        breadthTotal: input.quality.symbol.breadthTotal,
        refsTotal: input.quality.symbol.refsTotal,
        refsCount: input.quality.symbol.refsCount,
        maxRefs: input.quality.symbol.maxRefs,
      },
    },
  }));
  writeFileSync(seedPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

export function runStartContextGraphQualityAutotuneFlow(context) {
  const {
    repoRoot,
    createTempDir,
    writeContextEngineGraphAutotuneProjectToml,
    writeConfig,
    buildSmokeConfig,
    runCommand,
  } = context;
  const workDir = createTempDir("grobot-start-graph-autotune-work");
  writeContextEngineGraphAutotuneProjectToml(workDir);
  const contextDir = `${workDir}/.grobot/context`;
  mkdirSync(contextDir, { recursive: true });
  const seedPath = `${contextDir}/graph-cache-window.jsonl`;
  writeGraphAutotuneSeedRows(seedPath, {
    sessionKey: "seed:graph-autotune",
    queryHit: 1,
    queryMiss: 0,
    quality: {
      dependency: {
        rows: 1,
        multiHopRows: 0,
        depth4PlusRows: 0,
        maxChainDepth: 1,
      },
      symbol: {
        rows: 1,
        rowsWithBridge: 0,
        rowsWithBreadth: 0,
        bridgeTotal: 0,
        breadthTotal: 0,
        refsTotal: 0.2,
        refsCount: 1,
        maxRefs: 1,
      },
    },
  });
  const config = writeConfig(buildSmokeConfig(workDir));
  const result = runCommand(repoRoot, [
    "./grobot",
    "start",
    "--project",
    "grobot",
    "--work-dir",
    workDir,
    "--config",
    config.configPath,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
    "--session-subject",
    "graph-autotune-user",
    "--history-turns",
    "6",
    "--message",
    "graph quality autotune should raise graph hint rows when evidence quality is poor",
  ], {
    GROBOT_STARTUP_DIAGNOSTICS: "1",
  });
  return {
    ...result,
    ...extractGraphAutotuneTelemetry(result.stderr),
    seed_path: seedPath,
  };
}

export function runStartContextGraphQualityAutotuneHysteresisFlow(context) {
  const {
    repoRoot,
    createTempDir,
    writeContextEngineGraphAutotuneProjectToml,
    writeConfig,
    buildSmokeConfig,
    runCommand,
  } = context;
  const workDir = createTempDir("grobot-start-graph-autotune-hysteresis-work");
  writeContextEngineGraphAutotuneProjectToml(workDir);
  const contextDir = `${workDir}/.grobot/context`;
  const memoryContextEngineDir = `${workDir}/.grobot/memory/context-engine`;
  mkdirSync(contextDir, { recursive: true });
  mkdirSync(memoryContextEngineDir, { recursive: true });
  const graphSeedPath = `${contextDir}/graph-cache-window.jsonl`;
  const promptSeedPath = `${contextDir}/prompt-quality-window.jsonl`;
  const stateSeedPath = `${memoryContextEngineDir}/graph-quality-autotune-state.json`;
  const seedNowMs = Date.now();
  writeGraphAutotuneSeedRows(graphSeedPath, {
    sessionKey: "seed:graph-autotune-hysteresis",
    queryHit: 2,
    queryMiss: 0,
    quality: {
      dependency: {
        rows: 4,
        multiHopRows: 3,
        depth4PlusRows: 2,
        maxChainDepth: 4,
      },
      symbol: {
        rows: 4,
        rowsWithBridge: 4,
        rowsWithBreadth: 4,
        bridgeTotal: 16,
        breadthTotal: 14,
        refsTotal: 22,
        refsCount: 4,
        maxRefs: 8,
      },
    },
  });
  const promptRows = [0, 1].map((index) => ({
    ts: new Date(seedNowMs - (2 - index) * 1_000).toISOString(),
    sessionKey: "seed:graph-autotune-hysteresis",
    stage: "minimal",
    selectionReason: "seed",
    estimatedTokens: 7800 + index * 200,
    targetTokenLimit: 5000,
    scores: {
      coverage: 0.60,
      recency: 0.55,
      size: 0.32,
      overall: 0.49,
    },
    signals: {
      recentRows: 1,
      snapshotSections: 2,
      recentTrimRows: 1,
      snapshotTrimSections: 1,
      snapshotSemanticCompressSections: 2,
      headTrimRetries: 0,
      autoLimitTriggered: true,
      downshiftGuardTriggered: false,
      preSendStrategy: "hard_budget",
      preSendOverflowRatio: 0.35,
      preSendPressureScore: 0.82,
    },
  }));
  const stateSeed = {
    lastDirection: "upshift",
    holdTurnsRemaining: 2,
    downshiftWarmupStreak: 0,
    lastReason: "seed",
    updatedAt: new Date(seedNowMs - 3_000).toISOString(),
  };
  writeFileSync(
    promptSeedPath,
    `${promptRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
  writeFileSync(stateSeedPath, `${JSON.stringify(stateSeed, null, 2)}\n`, "utf8");
  const config = writeConfig(buildSmokeConfig(workDir));
  const result = runCommand(repoRoot, [
    "./grobot",
    "start",
    "--project",
    "grobot",
    "--work-dir",
    workDir,
    "--config",
    config.configPath,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
    "--session-subject",
    "graph-autotune-hysteresis-user",
    "--history-turns",
    "6",
    "--message",
    "graph quality autotune hysteresis should suppress instant direction flip",
  ], {
    GROBOT_STARTUP_DIAGNOSTICS: "1",
  });
  return {
    ...result,
    ...extractGraphAutotuneTelemetry(result.stderr),
    graph_seed_path: graphSeedPath,
    prompt_seed_path: promptSeedPath,
    state_seed_path: stateSeedPath,
  };
}

export function runStartContextGraphQualityAutotuneAdaptiveSequenceFlow(context) {
  const {
    repoRoot,
    createTempDir,
    writeContextEngineGraphAutotuneProjectToml,
    writeConfig,
    buildSmokeConfig,
    runCommand,
    readJsonFileSafe,
    isObject,
  } = context;
  const workDir = createTempDir("grobot-start-graph-autotune-adaptive-seq-work");
  writeContextEngineGraphAutotuneProjectToml(workDir);
  const contextDir = `${workDir}/.grobot/context`;
  const memoryContextEngineDir = `${workDir}/.grobot/memory/context-engine`;
  mkdirSync(contextDir, { recursive: true });
  mkdirSync(memoryContextEngineDir, { recursive: true });
  const graphSeedPath = `${contextDir}/graph-cache-window.jsonl`;
  const statePath = `${memoryContextEngineDir}/graph-quality-autotune-state.json`;
  const config = writeConfig(buildSmokeConfig(workDir));
  const runTurn = (message) => runCommand(
    repoRoot,
    [
      "./grobot",
      "start",
      "--project",
      "grobot",
      "--work-dir",
      workDir,
      "--config",
      config.configPath,
      "--gateway-impl",
      "ts",
      "--runtime-impl",
      "rust",
      "--session-subject",
      "graph-autotune-adaptive-seq-user",
      "--history-turns",
      "6",
      "--message",
      message,
    ],
    {
      GROBOT_STARTUP_DIAGNOSTICS: "1",
    },
  );
  const readAdaptiveSnapshot = (raw) => {
    if (!isObject(raw)) {
      return {
        present: false,
        adaptive_updates: 0,
        adaptive_cache_threshold: null,
        adaptive_alpha: null,
        adaptive_source: "",
        adaptive_action_scale: null,
        adaptive_action_updates: 0,
        adaptive_action_source: "",
      };
    }
    return {
      present: true,
      adaptive_updates: Number.isFinite(raw.adaptiveUpdates) ? Number(raw.adaptiveUpdates) : 0,
      adaptive_cache_threshold:
        Number.isFinite(raw.cacheDegradeQueryHitRateThreshold)
          ? Number(raw.cacheDegradeQueryHitRateThreshold)
          : null,
      adaptive_alpha: Number.isFinite(raw.adaptiveLearnAlpha) ? Number(raw.adaptiveLearnAlpha) : null,
      adaptive_source: typeof raw.adaptiveSource === "string" ? raw.adaptiveSource : "",
      adaptive_action_scale: Number.isFinite(raw.adaptiveActionScale)
        ? Number(raw.adaptiveActionScale)
        : null,
      adaptive_action_updates: Number.isFinite(raw.adaptiveActionUpdates)
        ? Number(raw.adaptiveActionUpdates)
        : 0,
      adaptive_action_source: typeof raw.adaptiveActionSource === "string"
        ? raw.adaptiveActionSource
        : "",
    };
  };

  writeGraphAutotuneSeedRows(graphSeedPath, {
    sessionKey: "seed:graph-autotune-adaptive-seq-high",
    queryHit: 18,
    queryMiss: 2,
    quality: {
      dependency: {
        rows: 4,
        multiHopRows: 3,
        depth4PlusRows: 2,
        maxChainDepth: 4,
      },
      symbol: {
        rows: 4,
        rowsWithBridge: 4,
        rowsWithBreadth: 4,
        bridgeTotal: 15,
        breadthTotal: 12,
        refsTotal: 20,
        refsCount: 4,
        maxRefs: 8,
      },
    },
  });
  const firstResult = runTurn(
    "graph autotune adaptive sequence pass 1 should learn from high cache hit rate evidence",
  );
  const firstTelemetry = extractGraphAutotuneTelemetry(firstResult.stderr);
  const firstState = readAdaptiveSnapshot(readJsonFileSafe(statePath));

  writeGraphAutotuneSeedRows(graphSeedPath, {
    sessionKey: "seed:graph-autotune-adaptive-seq-low",
    queryHit: 2,
    queryMiss: 18,
    quality: {
      dependency: {
        rows: 1,
        multiHopRows: 0,
        depth4PlusRows: 0,
        maxChainDepth: 1,
      },
      symbol: {
        rows: 1,
        rowsWithBridge: 0,
        rowsWithBreadth: 0,
        bridgeTotal: 0,
        breadthTotal: 0,
        refsTotal: 0.5,
        refsCount: 1,
        maxRefs: 1,
      },
    },
  });
  const secondResult = runTurn(
    "graph autotune adaptive sequence pass 2 should adjust thresholds downward under low hit evidence",
  );
  const secondTelemetry = extractGraphAutotuneTelemetry(secondResult.stderr);
  const secondState = readAdaptiveSnapshot(readJsonFileSafe(statePath));

  writeGraphAutotuneSeedRows(graphSeedPath, {
    sessionKey: "seed:graph-autotune-adaptive-seq-rebound",
    queryHit: 14,
    queryMiss: 3,
    quality: {
      dependency: {
        rows: 3,
        multiHopRows: 2,
        depth4PlusRows: 1,
        maxChainDepth: 3,
      },
      symbol: {
        rows: 3,
        rowsWithBridge: 2,
        rowsWithBreadth: 3,
        bridgeTotal: 8,
        breadthTotal: 9,
        refsTotal: 11,
        refsCount: 3,
        maxRefs: 5,
      },
    },
  });
  const thirdResult = runTurn(
    "graph autotune adaptive sequence pass 3 should rebound smoothly without oscillation spike",
  );
  const thirdTelemetry = extractGraphAutotuneTelemetry(thirdResult.stderr);
  const thirdState = readAdaptiveSnapshot(readJsonFileSafe(statePath));

  const secondMinusFirstActionScale = (
    Number.isFinite(secondState.adaptive_action_scale)
    && Number.isFinite(firstState.adaptive_action_scale)
  )
    ? Number(secondState.adaptive_action_scale) - Number(firstState.adaptive_action_scale)
    : null;
  const thirdMinusSecondActionScale = (
    Number.isFinite(thirdState.adaptive_action_scale)
    && Number.isFinite(secondState.adaptive_action_scale)
  )
    ? Number(thirdState.adaptive_action_scale) - Number(secondState.adaptive_action_scale)
    : null;

  return {
    first_exit_code: firstResult.exit_code,
    second_exit_code: secondResult.exit_code,
    third_exit_code: thirdResult.exit_code,
    first_graph_autotune_seen: firstTelemetry.graph_autotune_seen,
    second_graph_autotune_seen: secondTelemetry.graph_autotune_seen,
    third_graph_autotune_seen: thirdTelemetry.graph_autotune_seen,
    first_graph_autotune_adaptive_updated: firstTelemetry.graph_autotune_adaptive_updated,
    second_graph_autotune_adaptive_updated: secondTelemetry.graph_autotune_adaptive_updated,
    third_graph_autotune_adaptive_updated: thirdTelemetry.graph_autotune_adaptive_updated,
    first_state_present: firstState.present,
    second_state_present: secondState.present,
    third_state_present: thirdState.present,
    first_state_adaptive_updates: firstState.adaptive_updates,
    second_state_adaptive_updates: secondState.adaptive_updates,
    third_state_adaptive_updates: thirdState.adaptive_updates,
    first_state_adaptive_cache_threshold: firstState.adaptive_cache_threshold,
    second_state_adaptive_cache_threshold: secondState.adaptive_cache_threshold,
    third_state_adaptive_cache_threshold: thirdState.adaptive_cache_threshold,
    first_state_adaptive_alpha: firstState.adaptive_alpha,
    second_state_adaptive_alpha: secondState.adaptive_alpha,
    third_state_adaptive_alpha: thirdState.adaptive_alpha,
    first_state_adaptive_source: firstState.adaptive_source,
    second_state_adaptive_source: secondState.adaptive_source,
    third_state_adaptive_source: thirdState.adaptive_source,
    first_state_adaptive_action_scale: firstState.adaptive_action_scale,
    second_state_adaptive_action_scale: secondState.adaptive_action_scale,
    third_state_adaptive_action_scale: thirdState.adaptive_action_scale,
    first_state_adaptive_action_updates: firstState.adaptive_action_updates,
    second_state_adaptive_action_updates: secondState.adaptive_action_updates,
    third_state_adaptive_action_updates: thirdState.adaptive_action_updates,
    first_state_adaptive_action_source: firstState.adaptive_action_source,
    second_state_adaptive_action_source: secondState.adaptive_action_source,
    third_state_adaptive_action_source: thirdState.adaptive_action_source,
    second_minus_first_action_scale: secondMinusFirstActionScale,
    third_minus_second_action_scale: thirdMinusSecondActionScale,
    state_path: statePath,
    graph_seed_path: graphSeedPath,
  };
}
