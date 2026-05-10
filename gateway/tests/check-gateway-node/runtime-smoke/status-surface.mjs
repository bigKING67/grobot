import assert from "node:assert/strict";
import { resolve } from "node:path";
import { assertContextEngineStatusSurface } from "./status-surface/context-engine-assertions.mjs";
import { assertContextGraphStatusSurface } from "./status-surface/context-graph-assertions.mjs";
import { assertRuntimeToolStatusSurface } from "./status-surface/runtime-tool-assertions.mjs";
import { assertStatusWindowSizeSurface } from "./status-surface/window-size.mjs";
import {
  assertSuccess,
  contractsRoot,
  logRetry,
  logStep,
  parseJsonOutput,
  repoRoot,
  runCommand,
  runTsx,
  sleepMs,
} from "../harness.mjs";

export async function runRuntimeStatusSurfaceSmoke() {
  const runtimeBuildResult = runCommand("cargo", ["build", "--manifest-path", "runtime/Cargo.toml"], {
    timeoutMs: 240_000,
  });
  assertSuccess("runtime build for ts-rust smoke", runtimeBuildResult);
  logStep("runtime build for ts-rust smoke");

  const runtimeInterruptContractResult = runTsx("gateway/src/extensions/contracts/runtime-interrupt-contract.ts");
  assertSuccess("runtime-interrupt-contract", runtimeInterruptContractResult);
  const runtimeInterruptContractPayload = parseJsonOutput(
    "runtime-interrupt-contract",
    runtimeInterruptContractResult.stdout,
  );
  assert.equal(runtimeInterruptContractPayload.interrupted, true);
  assert.equal(
    String(runtimeInterruptContractPayload.error).includes("class=turn_interrupted"),
    true,
  );
  assert.equal(Number(runtimeInterruptContractPayload.duration_ms) < 6_000, true);
  logStep("runtime-interrupt-contract", {
    duration_ms: runtimeInterruptContractPayload.duration_ms,
    call_count: runtimeInterruptContractPayload.call_count,
  });

  const runtimeStdioEventStreamContractResult = runTsx("gateway/src/extensions/contracts/runtime-stdio-event-stream-contract.ts");
  assertSuccess("runtime-stdio-event-stream-contract", runtimeStdioEventStreamContractResult);
  const runtimeStdioEventStreamContractPayload = parseJsonOutput(
    "runtime-stdio-event-stream-contract",
    runtimeStdioEventStreamContractResult.stdout,
  );
  assert.equal(runtimeStdioEventStreamContractPayload.stream_enabled_sets_stderr_jsonl, true);
  assert.equal(runtimeStdioEventStreamContractPayload.no_consumer_disables_event_stream, true);
  assert.equal(runtimeStdioEventStreamContractPayload.callback_without_stream_flag_disables_event_stream, true);
  assert.equal(runtimeStdioEventStreamContractPayload.stderr_events_are_observed, true);
  assert.equal(runtimeStdioEventStreamContractPayload.stderr_event_payload_is_normalized, true);
  assert.equal(runtimeStdioEventStreamContractPayload.stderr_event_lines_are_stripped_from_nonzero_error, true);
  logStep("runtime-stdio-event-stream-contract");

  let statusPayload = null;
  let statusAttempts = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    statusAttempts = attempt;
    const statusResult = runCommand("node", [
      resolve(contractsRoot, "start-smoke-contract.mjs"),
      "status-ts-rust",
      "--repo-root",
      repoRoot,
    ], {
      timeoutMs: 240_000,
    });
    const isTransientRuntimeDescribeMissing =
      statusResult.code !== 0
      && statusResult.stderr.includes("runtime tool schema projection should be sourced from runtime.tools.describe: missing");
    if (isTransientRuntimeDescribeMissing && attempt < 3) {
      logRetry("start-smoke-contract status-ts-rust", attempt, 3, "transient runtime.tools.describe bootstrap gap");
      await sleepMs(500);
      continue;
    }
    assertSuccess("start-smoke-contract.mjs status-ts-rust", statusResult);
    statusPayload = parseJsonOutput("start-smoke-contract status-ts-rust", statusResult.stdout);
    if (statusPayload.exit_code === 0) {
      break;
    }
    const isTransientTsBootstrap =
      statusPayload.exit_code === 86 &&
      String(statusPayload.stderr).includes("ts-dev-cli bootstrap failed");
    if (!isTransientTsBootstrap || attempt === 3) {
      break;
    }
    logRetry("start-smoke-contract status-ts-rust", attempt, 3, "transient ts-dev-cli bootstrap flake");
    await sleepMs(500);
  }
  assert.equal(statusPayload !== null, true);
  assertRuntimeToolStatusSurface(statusPayload);
  assertContextGraphStatusSurface(statusPayload);
  assertContextEngineStatusSurface(statusPayload);
  logStep("start-smoke-contract status-ts-rust", { attempts: statusAttempts });

  assertStatusWindowSizeSurface();
}
