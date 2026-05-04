import {
  expect,
  expectAllIncludes,
  expectIncludes,
} from "./assertions";
import {
  releaseGateQualityRequiredFragments,
  releaseQualityModuleRequiredFragments,
  statusQualityRequiredFragments,
} from "./source-fragments";
import type { RuntimeToolQualityRepoFiles } from "./repo-files";
import type { RuntimeToolQualitySchemaCaseResult } from "./schema-case";

export function runSourceCase(
  files: RuntimeToolQualityRepoFiles,
  schema: RuntimeToolQualitySchemaCaseResult,
): void {
  expectAllIncludes(
    files.releaseGate,
    releaseGateQualityRequiredFragments,
    "release gate runtime_tool_quality module delegation",
  );

  expectAllIncludes(
    files.releaseQualityModule,
    releaseQualityModuleRequiredFragments,
    "release checks.runtime_tool_quality schema",
  );

  expectAllIncludes(
    files.statusQualityModule,
    statusQualityRequiredFragments,
    "status runtime_tools_quality schema",
  );

  expectAllIncludes(
    files.statusQualityRegistry,
    [
      "RUNTIME_TOOL_QUALITY_REGISTRY_RELATIVE_PATH = \"shared/contracts/runtime-tool-quality-v1.json\"",
      "function readRuntimeToolQualityRegistry()",
      "function readRuntimeToolQualityActionRegistryByReason()",
      "defaultNextStepBySurface",
      "priorityBySurface",
      "function readRuntimeToolQualityActionRequiredByReason()",
      "export function resolveRuntimeToolQualityActionRequiredFromRegistry",
      "export function resolveRuntimeToolQualityActionFromRegistry",
      "export function resolveRuntimeToolQualityDefaultNextStepFromRegistry",
      "export function resolveRuntimeToolQualitySignalFromRegistry",
      "runtime_tool_quality_registry_action_required_unmapped",
    ],
    "status runtime-tool quality registry reader",
  );

  for (const reason of schema.statusFailureReasons) {
    expectIncludes(files.statusQualityModule, `"${reason}"`, `status failure reason registry ${reason}`);
  }
  for (const reason of schema.statusWarningReasons) {
    expectIncludes(files.statusQualityModule, `"${reason}"`, `status warning reason registry ${reason}`);
  }
  for (const reason of schema.releaseFailureReasons) {
    expectIncludes(files.releaseQualityModule, `"${reason}"`, `release failure reason registry ${reason}`);
  }
  expect(
    !files.statusQualityModule.includes("runtime_binary_missing: \"build_runtime_binary\"")
      && !files.releaseGate.includes("runtime_binary_missing: \"build_runtime_binary\""),
    "status/release must derive action_required mapping from shared registry instead of inline reason maps",
  );
  expect(
    !files.statusQualityModule.includes("orderedSignals")
      && !files.releaseGate.includes("actionSignals")
      && !files.releaseGate.includes("runtimeToolQualityActionFamilyCatalog")
      && !files.releaseGate.includes("runtimeToolQualityFailureReasonCatalog"),
    "status/release must derive action_family/action_reason decisive signal priority from shared registry",
  );
  expect(
    !files.statusQualityModule.includes("Build or install the Rust runtime binary, then rerun")
      && !files.statusQualityModule.includes("Run `npm run check:gateway:runtime-tools:describe` and reconcile")
      && !files.releaseGate.includes("Fix runtime-tool release report JSON parsing")
      && !files.releaseGate.includes("Build the Rust runtime with `cargo build --manifest-path runtime/Cargo.toml`"),
    "status/release must derive default actionable_next_step text from shared registry instead of inline switch prose",
  );
  expect(
    !files.releaseGate.includes("function readRuntimeToolQualityRegistry()")
      && !files.releaseGate.includes("function runtimeToolQualitySummary(")
      && !files.releaseGate.includes("const runtimeToolQualityRegistry = readRuntimeToolQualityRegistry();"),
    "release gate must delegate runtime_tool_quality report construction to scripts/lib instead of inline heredoc logic",
  );

  expect(
    files.sharedContractsReadme.includes("default_next_step")
      && files.sharedContractsReadme.includes("default `actionable_next_step`"),
    "shared contract README must document registry-owned default next steps",
  );
  expect(
    files.sharedContractsReadme.includes("priority_by_surface")
      && files.sharedContractsReadme.includes("decisive `action_reason`"),
    "shared contract README must document registry-owned action signal priority",
  );

  expect(
    files.releaseQualityModule.includes("schemaBudgetViolations === null")
      && files.releaseQualityModule.includes("? \"unknown\"")
      && files.releaseQualityModule.includes("? \"passed\"")
      && files.releaseQualityModule.includes(": \"failed\""),
    "release runtime_tool_quality must expose explicit schema_budget_status including unknown",
  );

  expect(
    files.statusQualityModule.includes("warnReasons.length > 0")
      && files.statusQualityModule.includes("? \"warn\"")
      && files.statusQualityModule.includes(": \"ok\""),
    "status runtime_tools_quality must distinguish warn from ok/fail",
  );

  expect(
    files.releaseQualityModule.includes("checks: {")
      && files.releaseQualityModule.includes("runtime_tool_quality: runtimeToolQuality"),
    "release report must publish runtime_tool_quality under checks",
  );

  expect(
    files.statusCommand.includes("runtime_tools_quality: runtimeToolQuality")
      && files.statusQualityTextModule.includes("runtime_tool_quality: status=")
      && files.statusQualityTextModule.includes("action=${input.quality.action_required ?? \"<none>\"}"),
    "status JSON/text must publish runtime_tools_quality and text action",
  );
}
