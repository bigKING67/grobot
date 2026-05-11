import {
  assertContextEngineControlSmoke,
  assertContextEngineEnvAdaptiveControlSmoke,
  assertContextEngineEnvControlSmoke,
  assertContextEngineEnvCoreControlSmoke,
  assertContextEngineStatusControlSmoke,
  assertContextEngineTomlBasicControlSmoke,
  assertContextEngineTomlControlSmoke,
  assertContextEngineTomlThresholdControlSmoke,
  assertContextEngineTomlWindowControlSmoke,
  assertContextEngineValidatorSmoke,
  assertContextEngineValidBoundarySmoke,
} from "./runtime-smoke/context-engine-controls.mjs";
import {
  assertExperienceRuntimeControlSmoke,
  assertExperienceRuntimeStartConfigControlSmoke,
  assertExperienceRuntimeServeControlSmoke,
  assertExperienceRuntimeStartControlSmoke,
  assertExperienceRuntimeStartTeamControlSmoke,
} from "./runtime-smoke/experience-runtime-controls.mjs";
import {
  assertExperienceSchedulerControlSmoke,
  assertExperienceSchedulerEnvControlSmoke,
  assertExperienceSchedulerTomlControlSmoke,
  assertExperienceSchedulerValidatorSmoke,
  assertExperienceSchedulerValidBoundarySmoke,
} from "./runtime-smoke/experience-scheduler-controls.mjs";
import {
  assertMcpInstructionBasicControlSmoke,
  assertMcpInstructionControlSmoke,
  assertMcpInstructionScopeControlSmoke,
  assertMcpInstructionServerControlSmoke,
  assertMcpInstructionValidatorSmoke,
  assertMcpInstructionValidDisabledBoundarySmoke,
} from "./runtime-smoke/mcp-instruction-controls.mjs";
import { assertRuntimeBinControlSmoke } from "./runtime-smoke/runtime-bin-controls.mjs";
import {
  assertStatusLineBasicControlSmoke,
  assertStatusLineCacheControlSmoke,
  assertStatusLineControlSmoke,
  assertStatusLineSegmentOrderControlSmoke,
  assertStatusLineSegmentToggleControlSmoke,
  assertStatusLineThresholdControlSmoke,
  assertStatusLineValidatorSmoke,
  assertStatusLineValidBoundarySmoke,
} from "./runtime-smoke/status-line-controls.mjs";
import { assertToolSurfaceProfileControlSmoke } from "./runtime-smoke/tool-surface-profile-controls.mjs";

const aggregateOnly = (run) => Object.assign(run, { aggregateOnly: true });

export const RUNTIME_CONTROLS_CASES = Object.freeze({
  "runtime:controls:context-engine": {
    suite: "runtime:controls",
    description: "Context engine aggregate control rejection smoke.",
    run: aggregateOnly(assertContextEngineControlSmoke),
  },
  "runtime:controls:context-engine-env": {
    suite: "runtime:controls",
    description: "Context engine aggregate environment control rejection smoke.",
    run: aggregateOnly(assertContextEngineEnvControlSmoke),
  },
  "runtime:controls:context-engine-env-core": {
    suite: "runtime:controls",
    description: "Context engine core environment control rejection smoke.",
    run: aggregateOnly(assertContextEngineEnvCoreControlSmoke),
    seedMs: 1900,
  },
  "runtime:controls:context-engine-env-adaptive": {
    suite: "runtime:controls",
    description: "Context engine adaptive environment control rejection smoke.",
    run: aggregateOnly(assertContextEngineEnvAdaptiveControlSmoke),
    seedMs: 400,
  },
  "runtime:controls:context-engine-toml": {
    suite: "runtime:controls",
    description: "Context engine aggregate project TOML control rejection smoke.",
    run: aggregateOnly(assertContextEngineTomlControlSmoke),
  },
  "runtime:controls:context-engine-toml-basic": {
    suite: "runtime:controls",
    description: "Context engine basic project TOML control rejection smoke.",
    run: aggregateOnly(assertContextEngineTomlBasicControlSmoke),
    seedMs: 1300,
  },
  "runtime:controls:context-engine-toml-thresholds": {
    suite: "runtime:controls",
    description: "Context engine threshold-order project TOML control rejection smoke.",
    run: aggregateOnly(assertContextEngineTomlThresholdControlSmoke),
    seedMs: 500,
  },
  "runtime:controls:context-engine-toml-window": {
    suite: "runtime:controls",
    description: "Context engine window project TOML control rejection smoke.",
    run: aggregateOnly(assertContextEngineTomlWindowControlSmoke),
    seedMs: 900,
  },
  "runtime:controls:context-engine-validator": {
    suite: "runtime:controls",
    description: "Context engine production config validator control rejection smoke.",
    run: assertContextEngineValidatorSmoke,
    seedMs: 450,
  },
  "runtime:controls:context-engine-status": {
    suite: "runtime:controls",
    description: "Context engine status surface control rejection smoke.",
    run: assertContextEngineStatusControlSmoke,
    seedMs: 900,
  },
  "runtime:controls:context-engine-valid-boundary": {
    suite: "runtime:controls",
    description: "Context engine valid boundary reaches runtime.",
    run: assertContextEngineValidBoundarySmoke,
    seedMs: 1700,
  },
  "runtime:controls:experience-scheduler": {
    suite: "runtime:controls",
    description: "Experience scheduler aggregate control rejection smoke.",
    run: aggregateOnly(assertExperienceSchedulerControlSmoke),
  },
  "runtime:controls:experience-scheduler-env": {
    suite: "runtime:controls",
    description: "Experience scheduler environment control rejection smoke.",
    run: aggregateOnly(assertExperienceSchedulerEnvControlSmoke),
    seedMs: 1800,
  },
  "runtime:controls:experience-scheduler-toml": {
    suite: "runtime:controls",
    description: "Experience scheduler project TOML control rejection smoke.",
    run: aggregateOnly(assertExperienceSchedulerTomlControlSmoke),
    seedMs: 1800,
  },
  "runtime:controls:experience-scheduler-validator": {
    suite: "runtime:controls",
    description: "Experience scheduler production config validator control rejection smoke.",
    run: assertExperienceSchedulerValidatorSmoke,
    seedMs: 450,
  },
  "runtime:controls:experience-scheduler-valid-boundary": {
    suite: "runtime:controls",
    description: "Experience scheduler valid boundary reaches runtime.",
    run: assertExperienceSchedulerValidBoundarySmoke,
    seedMs: 900,
  },
  "runtime:controls:experience-runtime": {
    suite: "runtime:controls",
    description: "Experience runtime aggregate control rejection smoke.",
    run: aggregateOnly(assertExperienceRuntimeControlSmoke),
  },
  "runtime:controls:experience-runtime-start": {
    suite: "runtime:controls",
    description: "Experience runtime aggregate start boundary control rejection smoke.",
    run: aggregateOnly(assertExperienceRuntimeStartControlSmoke),
    seedMs: 2300,
  },
  "runtime:controls:experience-runtime-start-team": {
    suite: "runtime:controls",
    description: "Experience runtime start team boundary control rejection smoke.",
    run: assertExperienceRuntimeStartTeamControlSmoke,
    seedMs: 1200,
  },
  "runtime:controls:experience-runtime-start-config": {
    suite: "runtime:controls",
    description: "Experience runtime start config boundary control rejection smoke.",
    run: assertExperienceRuntimeStartConfigControlSmoke,
    seedMs: 1200,
  },
  "runtime:controls:experience-runtime-serve": {
    suite: "runtime:controls",
    description: "Experience runtime serve boundary control rejection smoke.",
    run: assertExperienceRuntimeServeControlSmoke,
    seedMs: 1300,
  },
  "runtime:controls:tool-surface-profile": {
    suite: "runtime:controls",
    description: "Tool surface profile control rejection smoke.",
    run: assertToolSurfaceProfileControlSmoke,
    seedMs: 1700,
  },
  "runtime:controls:runtime-bin": {
    suite: "runtime:controls",
    description: "Runtime binary control rejection smoke.",
    run: assertRuntimeBinControlSmoke,
    seedMs: 900,
  },
  "runtime:controls:mcp-instruction": {
    suite: "runtime:controls",
    description: "MCP instruction aggregate control rejection smoke.",
    run: aggregateOnly(assertMcpInstructionControlSmoke),
  },
  "runtime:controls:mcp-instruction-basic": {
    suite: "runtime:controls",
    description: "MCP instruction basic project TOML control rejection smoke.",
    run: aggregateOnly(assertMcpInstructionBasicControlSmoke),
    seedMs: 800,
  },
  "runtime:controls:mcp-instruction-scope": {
    suite: "runtime:controls",
    description: "MCP instruction scope project TOML control rejection smoke.",
    run: aggregateOnly(assertMcpInstructionScopeControlSmoke),
    seedMs: 800,
  },
  "runtime:controls:mcp-instruction-server": {
    suite: "runtime:controls",
    description: "MCP instruction registry server control rejection smoke.",
    run: aggregateOnly(assertMcpInstructionServerControlSmoke),
    seedMs: 650,
  },
  "runtime:controls:mcp-instruction-validator": {
    suite: "runtime:controls",
    description: "MCP instruction production config validator control rejection smoke.",
    run: assertMcpInstructionValidatorSmoke,
    seedMs: 450,
  },
  "runtime:controls:mcp-instruction-valid-disabled-boundary": {
    suite: "runtime:controls",
    description: "MCP instruction disabled valid boundary reaches runtime.",
    run: assertMcpInstructionValidDisabledBoundarySmoke,
    seedMs: 700,
  },
  "runtime:controls:status-line": {
    suite: "runtime:controls",
    description: "Status line aggregate control rejection smoke.",
    run: aggregateOnly(assertStatusLineControlSmoke),
  },
  "runtime:controls:status-line-validator": {
    suite: "runtime:controls",
    description: "Status line production project TOML validator control rejection smoke.",
    run: assertStatusLineValidatorSmoke,
    seedMs: 400,
  },
  "runtime:controls:status-line-basic": {
    suite: "runtime:controls",
    description: "Status line basic config control rejection smoke.",
    run: aggregateOnly(assertStatusLineBasicControlSmoke),
    seedMs: 1600,
  },
  "runtime:controls:status-line-segment-order": {
    suite: "runtime:controls",
    description: "Status line segment order control rejection smoke.",
    run: aggregateOnly(assertStatusLineSegmentOrderControlSmoke),
    seedMs: 1300,
  },
  "runtime:controls:status-line-thresholds": {
    suite: "runtime:controls",
    description: "Status line threshold control rejection smoke.",
    run: aggregateOnly(assertStatusLineThresholdControlSmoke),
    seedMs: 1900,
  },
  "runtime:controls:status-line-cache": {
    suite: "runtime:controls",
    description: "Status line cache and width control rejection smoke.",
    run: aggregateOnly(assertStatusLineCacheControlSmoke),
    seedMs: 1100,
  },
  "runtime:controls:status-line-segment-toggle": {
    suite: "runtime:controls",
    description: "Status line segment toggle control rejection smoke.",
    run: aggregateOnly(assertStatusLineSegmentToggleControlSmoke),
    seedMs: 900,
  },
  "runtime:controls:status-line-valid-boundary": {
    suite: "runtime:controls",
    description: "Status line valid boundary reaches runtime.",
    run: assertStatusLineValidBoundarySmoke,
    seedMs: 900,
  },
});
