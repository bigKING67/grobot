import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnTsxSync } from "./_shared/run-tsx-script.mjs";

const FIXTURES = Object.freeze([
  {
    name: "enabled",
    projectTomlLines: ["enabled = maybe"],
    code: "invalid_mcp_instructions_enabled",
    field: "mcp-instructions-enabled",
    detail: "mcp-instructions-enabled must be boolean",
    source: "project_toml",
  },
  {
    name: "strict",
    projectTomlLines: ["strict = yes"],
    code: "invalid_mcp_instructions_strict",
    field: "mcp-instructions-strict",
    detail: "mcp-instructions-strict must be boolean",
    source: "project_toml",
  },
  {
    name: "scope",
    projectTomlLines: ['scope = "workspace"'],
    code: "invalid_mcp_instructions_scope",
    field: "mcp-instructions-scope",
    detail: "mcp-instructions-scope must be project_first, project_only, or global_only",
    source: "project_toml",
  },
  {
    name: "scope-syntax",
    projectTomlLines: ['scope = "project_first" trailing'],
    code: "invalid_mcp_instructions_scope",
    field: "mcp-instructions-scope",
    detail: "mcp-instructions-scope must be project_first, project_only, or global_only",
    source: "project_toml",
  },
  {
    name: "server-name",
    projectTomlLines: ["enabled = true"],
    registryLines: ['name = ""', 'command = "uvx"', "enabled = true"],
    code: "invalid_mcp_server_name",
    field: "mcp-server-name",
    detail: "mcp-server-name must be a non-empty string",
    source: "mcp_registry:",
  },
  {
    name: "server-enabled",
    projectTomlLines: ["enabled = true"],
    registryLines: ['name = "grok-search"', 'command = "uvx"', "enabled = maybe"],
    code: "invalid_mcp_server_enabled",
    field: "mcp-server-enabled",
    detail: "mcp-server-enabled must be boolean",
    source: "mcp_registry:",
  },
]);

function writeMcpInstructionProjectToml(workDir, lines = []) {
  const grobotDir = resolve(workDir, ".grobot");
  const projectTomlPath = resolve(grobotDir, "project.toml");
  mkdirSync(grobotDir, { recursive: true });
  writeFileSync(
    projectTomlPath,
    [
      "schema_version = 1",
      'mode = "mvp"',
      "",
      "[mcp.instructions]",
      ...lines,
      "",
    ].join("\n"),
    "utf8",
  );
  return projectTomlPath;
}

function writeProjectMcpRegistry(workDir, lines = []) {
  writeFileSync(
    resolve(workDir, ".grobot", "mcp.toml"),
    [
      "[[servers]]",
      ...lines,
      "",
    ].join("\n"),
    "utf8",
  );
}

function runValidatorBatch(repoRoot, fixtures) {
  const script = [
    "const mcpModule = await import('./gateway/src/cli/services/mcp-instruction-pack.ts');",
    "const mcpInstructions = mcpModule.default ?? mcpModule;",
    "const { isMcpInstructionConfigInputError, resolveMcpInstructionRuntime } = mcpInstructions;",
    "if (typeof isMcpInstructionConfigInputError !== 'function' || typeof resolveMcpInstructionRuntime !== 'function') {",
    "  throw new Error('mcp-instruction-pack.ts must expose production validator functions');",
    "}",
    `const fixtures = ${JSON.stringify(fixtures)};`,
    "const results = [];",
    "for (const fixture of fixtures) {",
    "  try {",
    "    const runtime = resolveMcpInstructionRuntime({",
    "      homeDir: fixture.homeDir,",
    "      workDir: fixture.workDir,",
    "      projectTomlPath: fixture.projectTomlPath,",
    "    });",
    "    results.push({ name: fixture.name, status: 'ok', runtime });",
    "  } catch (error) {",
    "    if (!isMcpInstructionConfigInputError(error)) throw error;",
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

function assertInvalid(results, fixture) {
  const payload = results.get(fixture.name);
  assert.equal(payload.status, "error", fixture.name);
  assert.equal(payload.code, fixture.code, fixture.name);
  assert.equal(payload.field, fixture.field, fixture.name);
  assert.equal(String(payload.message).includes(fixture.detail), true, fixture.name);
  assert.equal(String(payload.message).includes(`source=${fixture.source}`), true, fixture.name);
  return payload.code;
}

function main() {
  const repoRoot = process.cwd();
  const root = mkdtempSync(resolve(tmpdir(), "mcp-instruction-config-validator-"));
  try {
    const fixtures = FIXTURES.map((fixture) => {
      const workDir = resolve(root, fixture.name);
      const homeDir = resolve(root, `${fixture.name}-home`);
      const projectTomlPath = writeMcpInstructionProjectToml(workDir, fixture.projectTomlLines);
      if (Array.isArray(fixture.registryLines)) {
        writeProjectMcpRegistry(workDir, fixture.registryLines);
      }
      return {
        name: fixture.name,
        homeDir,
        workDir,
        projectTomlPath,
      };
    });
    const validDisabledWorkDir = resolve(root, "valid-disabled-boundary");
    const validDisabledHomeDir = resolve(root, "valid-disabled-boundary-home");
    const validDisabledProjectTomlPath = writeMcpInstructionProjectToml(validDisabledWorkDir, [
      "enabled = false",
      'scope = "global_only"',
      "strict = false",
    ]);
    writeProjectMcpRegistry(validDisabledWorkDir, [
      'name = "grok-search"',
      'command = "uvx"',
      "enabled = false",
    ]);
    fixtures.push({
      name: "valid-disabled-boundary",
      homeDir: validDisabledHomeDir,
      workDir: validDisabledWorkDir,
      projectTomlPath: validDisabledProjectTomlPath,
    });

    const results = runValidatorBatch(repoRoot, fixtures);
    const rejectedCodes = FIXTURES.map((fixture) => assertInvalid(results, fixture));
    const validPayload = results.get("valid-disabled-boundary");
    assert.equal(validPayload.status, "ok");
    assert.deepEqual(validPayload.runtime.loadedServerNames, []);
    assert.deepEqual(validPayload.runtime.events, ["event=pack_disabled"]);
    process.stdout.write(`${JSON.stringify({
      status: "ok",
      rejected_count: rejectedCodes.length,
      unique_error_count: new Set(rejectedCodes).size,
      valid_disabled_boundary: true,
    })}\n`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main();
