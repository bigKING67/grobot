import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  assertSuccess,
  contractsRoot,
  isRecord,
  logStep,
  makeTempDir,
  parseJsonOutput,
  runCommand,
  runCommandAsync,
  runContract,
  runTsContract,
  writeFixtureFile,
} from "../harness.mjs";
export async function runAstHandoffContracts() {
  const symbolAstExtractResult = runTsContract("symbol-ast-contract.ts", "extract", [
    "--payload",
    JSON.stringify({
      file_path: "sample.ts",
      content: [
        "export interface ReportInput {",
        "  id: string;",
        "}",
        "export type ReportMode = \"fast\" | \"safe\";",
        "export enum ReportState { Draft, Done }",
        "export class ReportBuilder {}",
        "export function buildReport(input: ReportInput) {",
        "  return input.id;",
        "}",
        "const runAsync = async () => buildReport({ id: \"1\" });",
      ].join("\n"),
    }),
  ]);
  const symbolAstExtractPayload = parseJsonOutput(
    "symbol-ast-contract extract",
    symbolAstExtractResult.stdout,
  );
  assert.equal(typeof symbolAstExtractPayload.ast_runtime_available, "boolean");
  assert.equal(Array.isArray(symbolAstExtractPayload.symbols), true);
  if (symbolAstExtractPayload.ast_runtime_available === true) {
    const symbolPairs = new Set(
      symbolAstExtractPayload.symbols.map(
        (row) => `${String(row.kind)}:${String(row.symbol)}`,
      ),
    );
    assert.equal(symbolPairs.has("interface:ReportInput"), true);
    assert.equal(symbolPairs.has("type:ReportMode"), true);
    assert.equal(symbolPairs.has("enum:ReportState"), true);
    assert.equal(symbolPairs.has("class:ReportBuilder"), true);
    assert.equal(symbolPairs.has("fn:buildReport"), true);
    assert.equal(symbolPairs.has("const-fn:runAsync"), true);
  }
  logStep("symbol-ast-contract extract");

  const dependencyAstExtractResult = runTsContract("dependency-ast-contract.ts", "extract", [
    "--payload",
    JSON.stringify({
      file_path: "sample.ts",
      content: [
        "import fs from \"node:fs\";",
        "export { run } from \"./runner\";",
        "const pkg = require(\"./pkg\");",
        "async function load() {",
        "  return import(\"./lazy\");",
        "}",
        "void fs;",
        "void pkg;",
        "void load;",
      ].join("\n"),
    }),
  ]);
  const dependencyAstExtractPayload = parseJsonOutput(
    "dependency-ast-contract extract",
    dependencyAstExtractResult.stdout,
  );
  assert.equal(typeof dependencyAstExtractPayload.ast_runtime_available, "boolean");
  assert.equal(Array.isArray(dependencyAstExtractPayload.targets), true);
  if (dependencyAstExtractPayload.ast_runtime_available === true) {
    const targets = new Set(
      dependencyAstExtractPayload.targets.map((row) => String(row)),
    );
    assert.equal(targets.has("node:fs"), true);
    assert.equal(targets.has("./runner"), true);
    assert.equal(targets.has("./pkg"), true);
    assert.equal(targets.has("./lazy"), true);
  }
  logStep("dependency-ast-contract extract");

  const handoffSanitizeResult = runContract("handoff-contract.mjs", "sanitize", [
    "--text",
    "api_key=sk-123 token:abc Bearer xyz password = letmein",
  ]);
  const handoffSanitizePayload = parseJsonOutput("handoff-contract sanitize", handoffSanitizeResult.stdout);
  assert.equal(typeof handoffSanitizePayload.sanitized, "string");
  assert.equal(handoffSanitizePayload.sanitized.includes("<redacted>"), true);
  logStep("handoff-contract sanitize");

  runContract("handoff-contract.mjs", "start-defaults");
  logStep("handoff-contract start-defaults");

  runContract("session-store-contract.mjs", "load-fallback-scenario", ["--root", makeTempDir("session-store")]);
  logStep("session-store-contract load-fallback-scenario");

  runContract("session-store-contract.mjs", "save-fallback-scenario", ["--root", makeTempDir("session-store")]);
  logStep("session-store-contract save-fallback-scenario");
}
