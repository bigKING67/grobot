import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnTsxSync } from "./_shared/run-tsx-script.mjs";

const FIXTURES = Object.freeze([
  {
    name: "enabled",
    lines: ["enabled = maybe"],
    field: "statusline-enabled",
    detail: "statusline-enabled must be boolean",
  },
  {
    name: "layout",
    lines: ['layout_mode = "wide"'],
    field: "statusline-layout-mode",
    detail: "statusline-layout-mode must be adaptive, full, or compact",
  },
  {
    name: "theme",
    lines: ['theme = "rainbow"'],
    field: "statusline-theme",
    detail: "statusline-theme must be plain, nerd_font, nerd-font, ccline, or cometix",
  },
  {
    name: "separator",
    lines: ['separator = ""'],
    field: "statusline-separator",
    detail: "statusline-separator must not be empty",
  },
  {
    name: "segment-order-syntax",
    lines: ['segment_order = ["model", 3]'],
    field: "statusline-segment-order",
    detail: "statusline-segment-order must be an array of strings",
  },
  {
    name: "segment-order-unknown",
    lines: ['segment_order = ["model", "unknown"]'],
    field: "statusline-segment-order",
    detail: "statusline-segment-order values must be model, project, context, tokens, or session",
  },
  {
    name: "segment-order-duplicate",
    lines: ['segment_order = ["model", "model"]'],
    field: "statusline-segment-order",
    detail: "statusline-segment-order values must be unique",
  },
  {
    name: "warning-ratio",
    lines: ['warning_threshold_ratio = "bad"'],
    field: "statusline-warning-threshold-ratio",
    detail: "statusline-warning-threshold-ratio must be a number between 0 and 1",
  },
  {
    name: "critical-ratio",
    lines: ["critical_threshold_ratio = 2"],
    field: "statusline-critical-threshold-ratio",
    detail: "statusline-critical-threshold-ratio must be a number between 0 and 1",
  },
  {
    name: "warning-percent",
    lines: ["warning_threshold_percent = 101"],
    field: "statusline-warning-threshold-percent",
    detail: "statusline-warning-threshold-percent must be a number between 0 and 100",
  },
  {
    name: "threshold-order",
    lines: [
      "warning_threshold_ratio = 0.95",
      "critical_threshold_ratio = 0.90",
    ],
    field: "statusline-critical-threshold-ratio",
    detail: "statusline-warning-threshold-ratio must be less than or equal to statusline-critical-threshold-ratio",
  },
  {
    name: "budget-ttl",
    lines: ["budget_snapshot_cache_ttl_ms = 249"],
    field: "statusline-budget-snapshot-cache-ttl-ms",
    detail: "statusline-budget-snapshot-cache-ttl-ms must be an integer between 250 and 120000",
  },
  {
    name: "session-ttl",
    lines: ["session_topic_cache_ttl_ms = 120001"],
    field: "statusline-session-topic-cache-ttl-ms",
    detail: "statusline-session-topic-cache-ttl-ms must be an integer between 250 and 120000",
  },
  {
    name: "topic-width",
    lines: ["session_topic_max_width = 7"],
    field: "statusline-session-topic-max-width",
    detail: "statusline-session-topic-max-width must be an integer between 8 and 160",
  },
  {
    name: "segment-bool",
    segmentLines: ["model = maybe"],
    field: "statusline-segment-model",
    detail: "statusline-segment-model must be boolean",
  },
  {
    name: "segment-key",
    segmentLines: ["unknown = true"],
    field: "statusline-segment",
    detail: "statusline-segment key must be model, project, context, tokens, or session",
  },
]);

function writeStatusLineProjectToml(root, fixture) {
  const projectTomlPath = resolve(root, `${fixture.name}.toml`);
  const content = [
    "schema_version = 1",
    'mode = "mvp"',
    "",
    "[statusline]",
    ...(fixture.lines ?? []),
    "",
  ];
  if ((fixture.segmentLines ?? []).length > 0) {
    content.push("[statusline.segments]");
    content.push(...(fixture.segmentLines ?? []));
    content.push("");
  }
  writeFileSync(projectTomlPath, content.join("\n"), "utf8");
  return projectTomlPath;
}

function runValidatorBatch(repoRoot, fixtures) {
  const script = [
    "const statusLineModule = await import('./gateway/src/cli/start/context/status-line-config.ts');",
    "const statusLineConfig = statusLineModule.default ?? statusLineModule;",
    "const { isStatusLineConfigInputError, readStatusLineConfigFromProjectToml } = statusLineConfig;",
    "if (typeof isStatusLineConfigInputError !== 'function' || typeof readStatusLineConfigFromProjectToml !== 'function') {",
    "  throw new Error('status-line-config.ts must expose production validator functions');",
    "}",
    `const fixtures = ${JSON.stringify(fixtures)};`,
    "const results = [];",
    "for (const fixture of fixtures) {",
    "  try {",
    "    const config = readStatusLineConfigFromProjectToml(fixture.projectTomlPath);",
    "    results.push({ name: fixture.name, status: 'ok', config });",
    "  } catch (error) {",
    "    if (!isStatusLineConfigInputError(error)) throw error;",
    "    results.push({ name: fixture.name, status: 'error', code: error.code, field: error.field, message: error.message });",
    "  }",
    "}",
    "console.log(JSON.stringify({ status: 'ok', results }));",
  ].join("\n");
  const completed = spawnTsxSync("-", [], {
    cwd: repoRoot,
    input: script,
  });
  assert.equal(completed.status, 0, `validator failed\nstdout:\n${completed.stdout}\nstderr:\n${completed.stderr}`);
  const tail = String(completed.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  assert.equal(typeof tail, "string", "validator stdout must contain JSON");
  const payload = JSON.parse(tail);
  assert.equal(payload.status, "ok", "validator batch must complete");
  assert.equal(Array.isArray(payload.results), true, "validator batch must return result array");
  return new Map(payload.results.map((result) => [result.name, result]));
}

function assertInvalidFixture(results, fixture) {
  const payload = results.get(fixture.name);
  assert.equal(payload.status, "error", fixture.name);
  assert.equal(payload.code, `invalid_${fixture.field.replace(/-/g, "_")}`);
  assert.equal(payload.field, fixture.field);
  assert.equal(String(payload.message).includes(fixture.detail), true);
  assert.equal(String(payload.message).includes("source=project_toml"), true);
  return payload.code;
}

function main() {
  const repoRoot = process.cwd();
  const root = mkdtempSync(resolve(tmpdir(), "status-line-config-validator-"));
  try {
    const validProjectTomlPath = writeStatusLineProjectToml(root, {
      name: "valid-boundary",
      lines: [
        "enabled = true",
        'layout_mode = "compact"',
        'theme = "nerd-font"',
        'separator = " | "',
        'segment_order = ["model", "project", "tokens"]',
        "warning_threshold_ratio = 0.80",
        "critical_threshold_ratio = 0.90",
        "budget_snapshot_cache_ttl_ms = 250",
        "session_topic_cache_ttl_ms = 120000",
        "session_topic_max_width = 42",
      ],
      segmentLines: [
        "model = true",
        "project = true",
        "context = false",
        "tokens = true",
        "session = false",
      ],
    });
    const invalidInputs = FIXTURES.map((fixture) => ({
      name: fixture.name,
      projectTomlPath: writeStatusLineProjectToml(root, fixture),
    }));
    const results = runValidatorBatch(repoRoot, [
      ...invalidInputs,
      { name: "valid-boundary", projectTomlPath: validProjectTomlPath },
    ]);
    const rejectedCodes = FIXTURES.map((fixture) => assertInvalidFixture(results, fixture));
    const validPayload = results.get("valid-boundary");
    assert.equal(validPayload.status, "ok");
    assert.equal(validPayload.config.enabled, true);
    assert.equal(validPayload.config.layoutMode, "compact");
    assert.equal(validPayload.config.theme, "nerd_font");
    assert.deepEqual(validPayload.config.segmentOrder, ["model", "project", "tokens"]);
    assert.deepEqual(validPayload.config.segments, {
      model: true,
      project: true,
      context: false,
      tokens: true,
      session: false,
    });
    process.stdout.write(`${JSON.stringify({
      status: "ok",
      rejected_count: rejectedCodes.length,
      unique_error_count: new Set(rejectedCodes).size,
      valid_boundary: true,
    })}\n`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main();
