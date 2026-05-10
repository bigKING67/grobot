import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  repoRoot,
  runContract,
} from "../harness.mjs";

export function runRuntimeProviderRoutingSmoke() {
  const providerConfigResult = runContract(
    "runtime-smoke-contract.mjs",
    "provider-config-passthrough",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const providerConfigPayload = parseJsonOutput(
    "runtime-smoke-contract provider-config-passthrough",
    providerConfigResult.stdout,
  );
  assert.equal(providerConfigPayload.exit_code, 0);
  assert.equal(String(providerConfigPayload.stdout).includes("CONFIG_PROVIDER_OK"), true);
  assert.equal(Number(providerConfigPayload.runtime_call_count) >= 1, true);
  assert.equal(providerConfigPayload.runtime_last_call?.model, "provider-config-model");
  assert.equal(String(providerConfigPayload.runtime_last_call?.authorization), "Bearer provider-config-key");
  logStep("runtime-smoke-contract provider-config-passthrough");

  const providerPoolResult = runContract(
    "runtime-smoke-contract.mjs",
    "provider-pool-load-balance",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const providerPoolPayload = parseJsonOutput(
    "runtime-smoke-contract provider-pool-load-balance",
    providerPoolResult.stdout,
  );
  assert.equal(providerPoolPayload.exit_code, 0);
  assert.equal(Number(providerPoolPayload.runtime_call_count) >= Number(providerPoolPayload.turn_count), true);
  assert.equal(Number(providerPoolPayload.unique_authorization_count) >= 3, true);
  logStep("runtime-smoke-contract provider-pool-load-balance", {
    unique_keys: providerPoolPayload.unique_authorization_count,
    calls: providerPoolPayload.runtime_call_count,
  });
}
