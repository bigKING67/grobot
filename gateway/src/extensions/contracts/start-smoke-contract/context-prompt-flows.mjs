import { mkdirSync, writeFileSync } from "node:fs";

export function runStartContextPreSendHeadTrimFlow(context) {
  const {
    repoRoot,
    createTempDir,
    writeContextEngineTrimProjectToml,
    writeConfig,
    buildSmokeConfig,
    runCommand,
  } = context;
  const workDir = createTempDir("grobot-start-pretrim-work");
  writeContextEngineTrimProjectToml(workDir);
  const config = writeConfig(buildSmokeConfig(workDir));
  const longMessage = "context engine retry compaction needs deterministic head trim behavior. ".repeat(340);
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
    "pretrim-quality-user",
    "--history-turns",
    "8",
    "--message",
    longMessage,
  ], {
    GROBOT_STARTUP_DIAGNOSTICS: "1",
  });
  const preTrimEvent = result.stderr.match(
    /event=pre_send_head_trim stage=([a-z_]+) retries=(\d+) estimated_tokens=(\d+) effective_window=(\d+)/,
  );
  const recentTrimEvent = result.stderr.match(
    /event=pre_send_recent_trim stage=([a-z_]+) removed_rows=(\d+) estimated_tokens=(\d+) target_limit=(\d+)/,
  );
  const snapshotTrimEvent = result.stderr.match(
    /event=pre_send_snapshot_trim stage=([a-z_]+) removed_sections=(\d+) estimated_tokens=(\d+) target_limit=(\d+)/,
  );
  const snapshotSemanticCompressEvent = result.stderr.match(
    /event=pre_send_snapshot_semantic_compress stage=([a-z_]+) compressed_sections=(\d+) estimated_tokens=(\d+) target_limit=(\d+)/,
  );
  const promptPrepared = result.stderr.match(
    /event=prompt_prepared[^\n]*recent_trim_rows=(\d+)[^\n]*snapshot_trim_sections=(\d+)[^\n]*snapshot_semantic_compress_sections=(\d+)[^\n]*pretrim_retries=(\d+)/,
  );
  return {
    ...result,
    pre_send_head_trim_seen: Boolean(preTrimEvent),
    pre_send_head_trim_stage: preTrimEvent?.[1] ?? "",
    pre_send_head_trim_retries: Number.parseInt(preTrimEvent?.[2] ?? "0", 10),
    pre_send_estimated_tokens: Number.parseInt(preTrimEvent?.[3] ?? "0", 10),
    pre_send_effective_window: Number.parseInt(preTrimEvent?.[4] ?? "0", 10),
    pre_send_recent_trim_seen: Boolean(recentTrimEvent),
    pre_send_recent_trim_stage: recentTrimEvent?.[1] ?? "",
    pre_send_recent_trim_removed_rows: Number.parseInt(recentTrimEvent?.[2] ?? "0", 10),
    pre_send_recent_trim_estimated_tokens: Number.parseInt(recentTrimEvent?.[3] ?? "0", 10),
    pre_send_recent_trim_target_limit: Number.parseInt(recentTrimEvent?.[4] ?? "0", 10),
    pre_send_snapshot_trim_seen: Boolean(snapshotTrimEvent),
    pre_send_snapshot_trim_stage: snapshotTrimEvent?.[1] ?? "",
    pre_send_snapshot_trim_removed_sections: Number.parseInt(snapshotTrimEvent?.[2] ?? "0", 10),
    pre_send_snapshot_trim_estimated_tokens: Number.parseInt(snapshotTrimEvent?.[3] ?? "0", 10),
    pre_send_snapshot_trim_target_limit: Number.parseInt(snapshotTrimEvent?.[4] ?? "0", 10),
    pre_send_snapshot_semantic_compress_seen: Boolean(snapshotSemanticCompressEvent),
    pre_send_snapshot_semantic_compress_stage: snapshotSemanticCompressEvent?.[1] ?? "",
    pre_send_snapshot_semantic_compress_sections: Number.parseInt(snapshotSemanticCompressEvent?.[2] ?? "0", 10),
    pre_send_snapshot_semantic_compress_estimated_tokens: Number.parseInt(
      snapshotSemanticCompressEvent?.[3] ?? "0",
      10,
    ),
    pre_send_snapshot_semantic_compress_target_limit: Number.parseInt(
      snapshotSemanticCompressEvent?.[4] ?? "0",
      10,
    ),
    prompt_prepared_seen: result.stderr.includes("event=prompt_prepared"),
    prompt_prepared_recent_trim_rows: Number.parseInt(promptPrepared?.[1] ?? "0", 10),
    prompt_prepared_snapshot_trim_sections: Number.parseInt(promptPrepared?.[2] ?? "0", 10),
    prompt_prepared_snapshot_semantic_compress_sections: Number.parseInt(promptPrepared?.[3] ?? "0", 10),
    prompt_prepared_pretrim_retries: Number.parseInt(promptPrepared?.[4] ?? "0", 10),
  };
}

export function runStartContextQualityGuardFlow(context) {
  const {
    repoRoot,
    createTempDir,
    writeContextEngineQualityGuardProjectToml,
    writeConfig,
    buildSmokeConfig,
    runCommand,
  } = context;
  const workDir = createTempDir("grobot-start-quality-guard-work");
  writeContextEngineQualityGuardProjectToml(workDir);
  const contextDir = `${workDir}/.grobot/context`;
  mkdirSync(contextDir, { recursive: true });
  const seedPath = `${contextDir}/prompt-quality-window.jsonl`;
  const seedNowMs = Date.now();
  const seedRows = [
    {
      ts: new Date(seedNowMs - 2_000).toISOString(),
      sessionKey: "seed:quality-guard",
      stage: "normal",
      selectionReason: "seed",
      estimatedTokens: 2100,
      targetTokenLimit: 2000,
      scores: {
        coverage: 0.35,
        recency: 0.30,
        size: 0.20,
        overall: 0.30,
      },
      signals: {
        recentRows: 1,
        snapshotSections: 1,
        recentTrimRows: 0,
        snapshotTrimSections: 0,
        headTrimRetries: 0,
        autoLimitTriggered: false,
        downshiftGuardTriggered: false,
      },
    },
    {
      ts: new Date(seedNowMs - 1_000).toISOString(),
      sessionKey: "seed:quality-guard",
      stage: "normal",
      selectionReason: "seed",
      estimatedTokens: 2300,
      targetTokenLimit: 2000,
      scores: {
        coverage: 0.30,
        recency: 0.20,
        size: 0.10,
        overall: 0.22,
      },
      signals: {
        recentRows: 0,
        snapshotSections: 1,
        recentTrimRows: 0,
        snapshotTrimSections: 0,
        headTrimRetries: 0,
        autoLimitTriggered: false,
        downshiftGuardTriggered: false,
      },
    },
  ];
  writeFileSync(
    seedPath,
    `${seedRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
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
    "quality-guard-user",
    "--history-turns",
    "8",
    "--message",
    "quality guard should proactively escalate compaction when recent prompt quality window is degraded",
  ], {
    GROBOT_STARTUP_DIAGNOSTICS: "1",
  });
  const qualityGuardEvent = result.stderr.match(
    /event=quality_guard_precompact stage=([a-z_]+).* reason=([a-z_]+)/,
  );
  const promptPreparedEvent = result.stderr.match(
    /event=prompt_prepared[^\n]*quality_guard=(true|false)/,
  );
  return {
    ...result,
    quality_guard_seen: Boolean(qualityGuardEvent),
    quality_guard_stage: qualityGuardEvent?.[1] ?? "",
    quality_guard_reason: qualityGuardEvent?.[2] ?? "",
    prompt_prepared_quality_guard: promptPreparedEvent?.[1] ?? "",
    seed_path: seedPath,
  };
}
