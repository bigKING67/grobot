import assert from "node:assert/strict";
import { logStep, parseJsonOutput, repoRoot, runContract } from "../../harness.mjs";

export function assertStatusWindowSizeSurface() {
  const statusWindowSizeResult = runContract("start-smoke-contract.mjs", "status-ts-rust-window-size", [
    "--repo-root",
    repoRoot,
    "--window-size",
    "7",
  ], {
    timeoutMs: 240_000,
  });
  const statusWindowSizePayload = parseJsonOutput(
    "start-smoke-contract status-ts-rust-window-size",
    statusWindowSizeResult.stdout,
  );
  assert.equal(statusWindowSizePayload.exit_code, 0);
  assert.equal(statusWindowSizePayload.status_json_parse_ok, true);
  assert.equal(statusWindowSizePayload.status_context_graph_cache_window_configured_size_type, "number");
  assert.equal(statusWindowSizePayload.status_context_graph_cache_window_configured_size_value, 7);
  assert.equal(
    statusWindowSizePayload.status_context_persistent_graph_index_window_configured_size_type,
    "number",
  );
  assert.equal(
    statusWindowSizePayload.status_context_persistent_graph_index_window_configured_size_value,
    7,
  );
  logStep("start-smoke-contract status-ts-rust-window-size");
}
