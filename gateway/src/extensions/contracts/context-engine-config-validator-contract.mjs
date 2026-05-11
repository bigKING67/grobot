import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnTsxSync } from "./_shared/run-tsx-script.mjs";

const ENV_FIXTURES = Object.freeze([
  {
    name: "env-window-syntax",
    env: { GROBOT_CONTEXT_ENGINE_WINDOW: "123abc" },
    code: "invalid_context_engine_window",
    field: "context-engine-window",
    detail: "context-engine-window must be a number",
    source: "env:GROBOT_CONTEXT_ENGINE_WINDOW",
  },
  {
    name: "env-window-range",
    env: { GROBOT_CONTEXT_ENGINE_WINDOW: "0" },
    code: "invalid_context_engine_window",
    field: "context-engine-window",
    detail: "context-engine-window must be an integer between 1024 and 2000000",
    source: "env:GROBOT_CONTEXT_ENGINE_WINDOW",
  },
  {
    name: "env-ratio",
    env: { GROBOT_CONTEXT_ENGINE_PROACTIVE_RATIO: "1.2" },
    code: "invalid_context_engine_proactive_ratio",
    field: "context-engine-proactive-ratio",
    detail: "context-engine-proactive-ratio must be a number between 0.5 and 0.995",
    source: "env:GROBOT_CONTEXT_ENGINE_PROACTIVE_RATIO",
  },
  {
    name: "env-boolean",
    env: { GROBOT_CONTEXT_ENGINE_SEMANTIC_PREFETCH_ENABLED: "maybe" },
    code: "invalid_context_engine_semantic_prefetch_enabled",
    field: "context-engine-semantic-prefetch-enabled",
    detail: "context-engine-semantic-prefetch-enabled must be boolean",
    source: "env:GROBOT_CONTEXT_ENGINE_SEMANTIC_PREFETCH_ENABLED",
  },
  {
    name: "env-adaptive-allowlist",
    env: {
      GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST: "harden,sideways",
    },
    code: "invalid_context_engine_prompt_quality_guard_adaptive_mode_allowlist",
    field: "context-engine-prompt-quality-guard-adaptive-mode-allowlist",
    detail: "context-engine-prompt-quality-guard-adaptive-mode-allowlist must include only harden or relax",
    source: "env:GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST",
  },
]);

const TOML_FIXTURES = Object.freeze([
  {
    name: "toml-number",
    lines: ['reserved_output_tokens = "bad"'],
    code: "invalid_context_engine_reserved_output_tokens",
    field: "context-engine-reserved-output-tokens",
    detail: "context-engine-reserved-output-tokens must be a number",
  },
  {
    name: "toml-range",
    lines: ["hard_ratio = 2"],
    code: "invalid_context_engine_hard_ratio",
    field: "context-engine-hard-ratio",
    detail: "context-engine-hard-ratio must be a number between 0.5 and 0.995",
  },
  {
    name: "toml-enum",
    lines: ['profile = "fast"'],
    code: "invalid_context_engine_profile",
    field: "context-engine-profile",
    detail: "context-engine-profile must be balanced, aggressive, or conservative",
  },
  {
    name: "toml-threshold-order",
    lines: [
      "proactive_ratio = 0.90",
      "forced_ratio = 0.89",
      "hard_ratio = 0.95",
    ],
    code: "invalid_context_engine_forced_ratio",
    field: "context-engine-forced-ratio",
    detail: "context-engine-forced-ratio must be greater than context-engine-proactive-ratio",
  },
  {
    name: "toml-effective-window",
    lines: [
      "context_window_tokens = 2048",
      "reserved_output_tokens = 1024",
      "safety_margin_tokens = 1024",
    ],
    code: "invalid_context_engine_effective_window",
    field: "context-engine-effective-window",
    detail: "context-engine-effective-window must be at least 1024",
  },
  {
    name: "toml-auto-compact-limit",
    lines: [
      "context_window_tokens = 2048",
      "reserved_output_tokens = 1",
      "safety_margin_tokens = 1",
      "auto_compact_token_limit = 2048",
    ],
    code: "invalid_context_engine_auto_compact_token_limit",
    field: "context-engine-auto-compact-token-limit",
    detail: "context-engine-auto-compact-token-limit must be less than or equal to effective context window",
  },
]);

function writeProjectToml(root, name, lines = []) {
  const projectTomlPath = resolve(root, `${name}.toml`);
  writeFileSync(
    projectTomlPath,
    [
      "schema_version = 1",
      'mode = "mvp"',
      "",
      "[context_engine]",
      ...lines,
      "",
    ].join("\n"),
    "utf8",
  );
  return projectTomlPath;
}

function runValidatorBatch(repoRoot, fixtures) {
  const script = [
    "const contextModule = await import('./gateway/src/tools/context/policy/context-engine-config.ts');",
    "const contextConfig = contextModule.default ?? contextModule;",
    "const { isContextEngineConfigInputError, resolveContextEngineConfig } = contextConfig;",
    "if (typeof isContextEngineConfigInputError !== 'function' || typeof resolveContextEngineConfig !== 'function') {",
    "  throw new Error('context-engine-config.ts must expose production validator functions');",
    "}",
    `const fixtures = ${JSON.stringify(fixtures)};`,
    "const originalEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('GROBOT_CONTEXT_ENGINE_')));",
    "const results = [];",
    "for (const fixture of fixtures) {",
    "  for (const key of Object.keys(process.env)) {",
    "    if (key.startsWith('GROBOT_CONTEXT_ENGINE_')) delete process.env[key];",
    "  }",
    "  for (const [key, value] of Object.entries(fixture.env ?? {})) process.env[key] = String(value);",
    "  try {",
    "    const config = resolveContextEngineConfig({ projectTomlPath: fixture.projectTomlPath });",
    "    results.push({ name: fixture.name, status: 'ok', config });",
    "  } catch (error) {",
    "    if (!isContextEngineConfigInputError(error)) throw error;",
    "    results.push({ name: fixture.name, status: 'error', code: error.code, field: error.field, message: error.message });",
    "  }",
    "}",
    "for (const key of Object.keys(process.env)) {",
    "  if (key.startsWith('GROBOT_CONTEXT_ENGINE_')) delete process.env[key];",
    "}",
    "for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;",
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

function assertInvalid(results, fixture, source = "project_toml") {
  const payload = results.get(fixture.name);
  assert.equal(payload.status, "error", fixture.name);
  assert.equal(payload.code, fixture.code, fixture.name);
  assert.equal(payload.field, fixture.field, fixture.name);
  assert.equal(String(payload.message).includes(fixture.detail), true, fixture.name);
  assert.equal(String(payload.message).includes(`source=${source}`), true, fixture.name);
  return payload.code;
}

function main() {
  const repoRoot = process.cwd();
  const root = mkdtempSync(resolve(tmpdir(), "context-engine-config-validator-"));
  try {
    const fixtures = [
      ...ENV_FIXTURES.map((fixture) => ({
        name: fixture.name,
        env: fixture.env,
      })),
      ...TOML_FIXTURES.map((fixture) => ({
        name: fixture.name,
        projectTomlPath: writeProjectToml(root, fixture.name, fixture.lines),
      })),
      {
        name: "valid-boundary",
        env: {
          GROBOT_CONTEXT_ENGINE_ENABLED: "yes",
          GROBOT_CONTEXT_ENGINE_WINDOW: "1026",
          GROBOT_CONTEXT_ENGINE_RESERVED_OUTPUT_TOKENS: "1",
          GROBOT_CONTEXT_ENGINE_SAFETY_MARGIN_TOKENS: "1",
          GROBOT_CONTEXT_ENGINE_AUTO_COMPACT_TOKEN_LIMIT: "1",
          GROBOT_CONTEXT_ENGINE_PROACTIVE_RATIO: "0.5",
          GROBOT_CONTEXT_ENGINE_FORCED_RATIO: "0.51",
          GROBOT_CONTEXT_ENGINE_HARD_RATIO: "0.995",
          GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_HOLD_TURNS: "0",
          GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_MAX_FLOOR_STAGE: "minimal",
          GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST: "harden,relax",
        },
      },
    ];
    const results = runValidatorBatch(repoRoot, fixtures);
    const rejectedCodes = [
      ...ENV_FIXTURES.map((fixture) => assertInvalid(results, fixture, fixture.source)),
      ...TOML_FIXTURES.map((fixture) => assertInvalid(results, fixture)),
    ];
    const validPayload = results.get("valid-boundary");
    assert.equal(validPayload.status, "ok");
    assert.equal(validPayload.config.enabled, true);
    assert.equal(validPayload.config.contextWindowTokens, 1026);
    assert.equal(validPayload.config.reservedOutputTokens, 1);
    assert.equal(validPayload.config.safetyMarginTokens, 1);
    assert.equal(validPayload.config.autoCompactTokenLimit, 1);
    assert.equal(validPayload.config.thresholds.proactiveRatio, 0.5);
    assert.equal(validPayload.config.thresholds.forcedRatio, 0.51);
    assert.equal(validPayload.config.thresholds.hardRatio, 0.995);
    assert.equal(validPayload.config.promptQuality.guardHoldTurns, 0);
    assert.equal(validPayload.config.promptQuality.guardMaxFloorStage, "minimal");
    assert.deepEqual(validPayload.config.promptQuality.guardAdaptiveModeAllowlist, ["harden", "relax"]);
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
