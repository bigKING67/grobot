import { mkdirSync, writeFileSync } from "node:fs";

function writeStatusLineProjectToml(workDir, lines, segmentLines = []) {
  const grobotDir = `${workDir}/.grobot`;
  mkdirSync(grobotDir, { recursive: true });
  const content = [
    "schema_version = 1",
    'mode = "mvp"',
    "",
    "[statusline]",
    ...lines,
    "",
  ];
  if (segmentLines.length > 0) {
    content.push("[statusline.segments]");
    content.push(...segmentLines);
    content.push("");
  }
  writeFileSync(`${grobotDir}/project.toml`, content.join("\n"), "utf8");
}

export function runStartInvalidStatusLineControlsRejectFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    hasStartBannerMarker,
  } = context;

  const makeCase = (suffix, options = {}) => {
    const workDir = createTempDir(`grobot-start-invalid-status-line-${suffix}`);
    writeStatusLineProjectToml(
      workDir,
      options.projectTomlLines ?? [],
      options.segmentLines ?? [],
    );
    const config = writeConfig(buildSmokeConfig(workDir));
    return runCommand(repoRoot, [
      "./grobot",
      "start",
      "--project",
      "grobot",
      "--project-root",
      workDir,
      "--work-dir",
      workDir,
      "--config",
      config.configPath,
      "--gateway-impl",
      "ts",
      "--runtime-impl",
      "rust",
      "--session-subject",
      `start-invalid-status-line-${suffix}-user`,
      "--message",
      "invalid status line config should not reach runtime",
    ]);
  };

  const invalidEnabledResult = makeCase("enabled", {
    projectTomlLines: ["enabled = maybe"],
  });
  const invalidLayoutResult = makeCase("layout", {
    projectTomlLines: ['layout_mode = "wide"'],
  });
  const invalidThemeResult = makeCase("theme", {
    projectTomlLines: ['theme = "rainbow"'],
  });
  const invalidSeparatorResult = makeCase("separator", {
    projectTomlLines: ['separator = ""'],
  });
  const invalidSegmentOrderSyntaxResult = makeCase("segment-order-syntax", {
    projectTomlLines: ['segment_order = ["model", 3]'],
  });
  const invalidSegmentOrderUnknownResult = makeCase("segment-order-unknown", {
    projectTomlLines: ['segment_order = ["model", "unknown"]'],
  });
  const invalidSegmentOrderDuplicateResult = makeCase("segment-order-duplicate", {
    projectTomlLines: ['segment_order = ["model", "model"]'],
  });
  const invalidWarningRatioResult = makeCase("warning-ratio", {
    projectTomlLines: ['warning_threshold_ratio = "bad"'],
  });
  const invalidCriticalRatioResult = makeCase("critical-ratio", {
    projectTomlLines: ["critical_threshold_ratio = 2"],
  });
  const invalidWarningPercentResult = makeCase("warning-percent", {
    projectTomlLines: ["warning_threshold_percent = 101"],
  });
  const invalidThresholdOrderResult = makeCase("threshold-order", {
    projectTomlLines: [
      "warning_threshold_ratio = 0.95",
      "critical_threshold_ratio = 0.90",
    ],
  });
  const invalidBudgetTtlResult = makeCase("budget-ttl", {
    projectTomlLines: ["budget_snapshot_cache_ttl_ms = 249"],
  });
  const invalidSessionTtlResult = makeCase("session-ttl", {
    projectTomlLines: ["session_topic_cache_ttl_ms = 120001"],
  });
  const invalidTopicWidthResult = makeCase("topic-width", {
    projectTomlLines: ["session_topic_max_width = 7"],
  });
  const invalidSegmentBoolResult = makeCase("segment-bool", {
    segmentLines: ["model = maybe"],
  });
  const invalidSegmentKeyResult = makeCase("segment-key", {
    segmentLines: ["unknown = true"],
  });
  const validBoundaryResult = makeCase("valid-boundary", {
    projectTomlLines: [
      "enabled = true",
      'layout_mode = "compact"',
      'theme = "cometix"',
      'separator = " | "',
      'segment_order = ["model", "project", "context", "tokens", "session"]',
      "warning_threshold_ratio = 0",
      "critical_threshold_ratio = 1",
      "budget_snapshot_cache_ttl_ms = 250",
      "session_topic_cache_ttl_ms = 250",
      "session_topic_max_width = 8",
    ],
    segmentLines: [
      "model = true",
      "project = true",
      "context = true",
      "tokens = true",
      "session = true",
    ],
  });

  const combinedOutput = [
    invalidEnabledResult.stdout,
    invalidEnabledResult.stderr,
    invalidLayoutResult.stdout,
    invalidLayoutResult.stderr,
    invalidThemeResult.stdout,
    invalidThemeResult.stderr,
    invalidSeparatorResult.stdout,
    invalidSeparatorResult.stderr,
    invalidSegmentOrderSyntaxResult.stdout,
    invalidSegmentOrderSyntaxResult.stderr,
    invalidSegmentOrderUnknownResult.stdout,
    invalidSegmentOrderUnknownResult.stderr,
    invalidSegmentOrderDuplicateResult.stdout,
    invalidSegmentOrderDuplicateResult.stderr,
    invalidWarningRatioResult.stdout,
    invalidWarningRatioResult.stderr,
    invalidCriticalRatioResult.stdout,
    invalidCriticalRatioResult.stderr,
    invalidWarningPercentResult.stdout,
    invalidWarningPercentResult.stderr,
    invalidThresholdOrderResult.stdout,
    invalidThresholdOrderResult.stderr,
    invalidBudgetTtlResult.stdout,
    invalidBudgetTtlResult.stderr,
    invalidSessionTtlResult.stdout,
    invalidSessionTtlResult.stderr,
    invalidTopicWidthResult.stdout,
    invalidTopicWidthResult.stderr,
    invalidSegmentBoolResult.stdout,
    invalidSegmentBoolResult.stderr,
    invalidSegmentKeyResult.stdout,
    invalidSegmentKeyResult.stderr,
  ].join("\n");

  return {
    invalid_enabled_exit_code: invalidEnabledResult.exit_code,
    invalid_enabled_has_stable_error:
      invalidEnabledResult.stderr.includes("error: invalid_statusline_enabled:")
      && invalidEnabledResult.stderr.includes("statusline-enabled must be boolean")
      && invalidEnabledResult.stderr.includes("source=project_toml"),
    invalid_layout_exit_code: invalidLayoutResult.exit_code,
    invalid_layout_has_stable_error:
      invalidLayoutResult.stderr.includes("error: invalid_statusline_layout_mode:")
      && invalidLayoutResult.stderr.includes("statusline-layout-mode must be adaptive, full, or compact"),
    invalid_theme_exit_code: invalidThemeResult.exit_code,
    invalid_theme_has_stable_error:
      invalidThemeResult.stderr.includes("error: invalid_statusline_theme:")
      && invalidThemeResult.stderr.includes("statusline-theme must be plain, nerd_font, nerd-font, ccline, or cometix"),
    invalid_separator_exit_code: invalidSeparatorResult.exit_code,
    invalid_separator_has_stable_error:
      invalidSeparatorResult.stderr.includes("error: invalid_statusline_separator:")
      && invalidSeparatorResult.stderr.includes("statusline-separator must not be empty"),
    invalid_segment_order_syntax_exit_code: invalidSegmentOrderSyntaxResult.exit_code,
    invalid_segment_order_syntax_has_stable_error:
      invalidSegmentOrderSyntaxResult.stderr.includes("error: invalid_statusline_segment_order:")
      && invalidSegmentOrderSyntaxResult.stderr.includes("statusline-segment-order must be an array of strings"),
    invalid_segment_order_unknown_exit_code: invalidSegmentOrderUnknownResult.exit_code,
    invalid_segment_order_unknown_has_stable_error:
      invalidSegmentOrderUnknownResult.stderr.includes("error: invalid_statusline_segment_order:")
      && invalidSegmentOrderUnknownResult.stderr.includes("statusline-segment-order values must be model, project, context, tokens, or session"),
    invalid_segment_order_duplicate_exit_code: invalidSegmentOrderDuplicateResult.exit_code,
    invalid_segment_order_duplicate_has_stable_error:
      invalidSegmentOrderDuplicateResult.stderr.includes("error: invalid_statusline_segment_order:")
      && invalidSegmentOrderDuplicateResult.stderr.includes("statusline-segment-order values must be unique"),
    invalid_warning_ratio_exit_code: invalidWarningRatioResult.exit_code,
    invalid_warning_ratio_has_stable_error:
      invalidWarningRatioResult.stderr.includes("error: invalid_statusline_warning_threshold_ratio:")
      && invalidWarningRatioResult.stderr.includes("statusline-warning-threshold-ratio must be a number between 0 and 1"),
    invalid_critical_ratio_exit_code: invalidCriticalRatioResult.exit_code,
    invalid_critical_ratio_has_stable_error:
      invalidCriticalRatioResult.stderr.includes("error: invalid_statusline_critical_threshold_ratio:")
      && invalidCriticalRatioResult.stderr.includes("statusline-critical-threshold-ratio must be a number between 0 and 1"),
    invalid_warning_percent_exit_code: invalidWarningPercentResult.exit_code,
    invalid_warning_percent_has_stable_error:
      invalidWarningPercentResult.stderr.includes("error: invalid_statusline_warning_threshold_percent:")
      && invalidWarningPercentResult.stderr.includes("statusline-warning-threshold-percent must be a number between 0 and 100"),
    invalid_threshold_order_exit_code: invalidThresholdOrderResult.exit_code,
    invalid_threshold_order_has_stable_error:
      invalidThresholdOrderResult.stderr.includes("error: invalid_statusline_critical_threshold_ratio:")
      && invalidThresholdOrderResult.stderr.includes("statusline-warning-threshold-ratio must be less than or equal to statusline-critical-threshold-ratio"),
    invalid_budget_ttl_exit_code: invalidBudgetTtlResult.exit_code,
    invalid_budget_ttl_has_stable_error:
      invalidBudgetTtlResult.stderr.includes("error: invalid_statusline_budget_snapshot_cache_ttl_ms:")
      && invalidBudgetTtlResult.stderr.includes("statusline-budget-snapshot-cache-ttl-ms must be an integer between 250 and 120000"),
    invalid_session_ttl_exit_code: invalidSessionTtlResult.exit_code,
    invalid_session_ttl_has_stable_error:
      invalidSessionTtlResult.stderr.includes("error: invalid_statusline_session_topic_cache_ttl_ms:")
      && invalidSessionTtlResult.stderr.includes("statusline-session-topic-cache-ttl-ms must be an integer between 250 and 120000"),
    invalid_topic_width_exit_code: invalidTopicWidthResult.exit_code,
    invalid_topic_width_has_stable_error:
      invalidTopicWidthResult.stderr.includes("error: invalid_statusline_session_topic_max_width:")
      && invalidTopicWidthResult.stderr.includes("statusline-session-topic-max-width must be an integer between 8 and 160"),
    invalid_segment_bool_exit_code: invalidSegmentBoolResult.exit_code,
    invalid_segment_bool_has_stable_error:
      invalidSegmentBoolResult.stderr.includes("error: invalid_statusline_segment_model:")
      && invalidSegmentBoolResult.stderr.includes("statusline-segment-model must be boolean"),
    invalid_segment_key_exit_code: invalidSegmentKeyResult.exit_code,
    invalid_segment_key_has_stable_error:
      invalidSegmentKeyResult.stderr.includes("error: invalid_statusline_segment:")
      && invalidSegmentKeyResult.stderr.includes("statusline-segment key must be model, project, context, tokens, or session"),
    valid_boundary_exit_code: validBoundaryResult.exit_code,
    valid_boundary_reached_runtime:
      validBoundaryResult.stderr.includes("Turn failed")
      || validBoundaryResult.stderr.includes("Upstream connection failed"),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_start_banner: hasStartBannerMarker(combinedOutput),
  };
}
