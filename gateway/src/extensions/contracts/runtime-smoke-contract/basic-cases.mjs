import { resolve } from "node:path";
import { startMockModelServer } from "../_shared/mock-model-server.mjs";
import { parseFirstJsonLine, parseJsonOutput, runCommandAsync } from "./helpers.mjs";

export async function runProviderConfigPassthrough(repoRoot) {
  const providerConfigModel = await startMockModelServer({ content: "CONFIG_PROVIDER_OK" });
  try {
    const runResult = await runCommandAsync(
      repoRoot,
      [
        "node",
        "gateway/src/extensions/contracts/start-smoke-contract.mjs",
        "start-message-provider-config-ts-rust",
        "--repo-root",
        repoRoot,
        "--provider-base-url",
        providerConfigModel.baseUrl,
        "--provider-api-key",
        "provider-config-key",
        "--provider-model",
        "provider-config-model",
      ],
      null,
      null,
      240_000,
    );
    const payload = parseJsonOutput(
      "runtime-smoke-contract provider-config-passthrough",
      runResult.stdout,
    );
    const calls = providerConfigModel.getCalls();
    const lastCall = calls[calls.length - 1] ?? null;
    return {
      ...payload,
      runtime_call_count: calls.length,
      runtime_last_call: lastCall,
    };
  } finally {
    await providerConfigModel.close();
  }
}

export async function runToolCallFailFast(repoRoot) {
  const model = await startMockModelServer({ mode: "tool_call" });
  try {
    const runResult = await runCommandAsync(
      repoRoot,
      [
        "node",
        "gateway/src/extensions/contracts/start-smoke-contract.mjs",
        "failover-runs-ts-rust",
        "--repo-root",
        repoRoot,
      ],
      {
        ...process.env,
        GROBOT_BASE_URL: model.baseUrl,
        GROBOT_API_KEY: "mock-runtime-key",
        GROBOT_MODEL: "mock-runtime-model",
        GROBOT_RUNTIME_HTTP_TIMEOUT_MS: "8000",
      },
      null,
      240_000,
    );
    const payload = parseJsonOutput(
      "runtime-smoke-contract tool-call-fail-fast",
      runResult.stdout,
    );
    return {
      ...payload,
      runtime_call_count: model.getCalls().length,
    };
  } finally {
    await model.close();
  }
}

export async function runToolCallSuccess(repoRoot) {
  const model = await startMockModelServer({ mode: "tool_loop_success" });
  try {
    const runResult = await runCommandAsync(
      repoRoot,
      [
        "node",
        "gateway/src/extensions/contracts/start-smoke-contract.mjs",
        "failover-runs-ts-rust",
        "--repo-root",
        repoRoot,
      ],
      {
        ...process.env,
        GROBOT_BASE_URL: model.baseUrl,
        GROBOT_API_KEY: "mock-runtime-key",
        GROBOT_MODEL: "mock-runtime-model",
        GROBOT_RUNTIME_HTTP_TIMEOUT_MS: "8000",
      },
      null,
      240_000,
    );
    const payload = parseJsonOutput(
      "runtime-smoke-contract tool-call-success",
      runResult.stdout,
    );
    return {
      ...payload,
      runtime_call_count: model.getCalls().length,
    };
  } finally {
    await model.close();
  }
}

export async function runToolCallDiagnosticEvents(repoRoot) {
  const model = await startMockModelServer({ mode: "tool_call" });
  try {
    const runtimeBinaryPath = resolve(repoRoot, "runtime/target/debug/grobot-runtime");
    const requestId = `req_tool_events_${Date.now()}`;
    const requestLine = JSON.stringify({
      jsonrpc: "2.0",
      id: "tool-event-check",
      method: "runtime.turn.execute",
      params: {
        request_id: requestId,
        session_key: "feishu:grobot:dm:tool-events",
        user_message: "tool event contract check",
        context_lines: [],
      },
    });
    const runResult = await runCommandAsync(
      repoRoot,
      [runtimeBinaryPath],
      {
        ...process.env,
        GROBOT_BASE_URL: model.baseUrl,
        GROBOT_API_KEY: "tool-event-key",
        GROBOT_MODEL: "tool-event-model",
        GROBOT_RUNTIME_HTTP_TIMEOUT_MS: "8000",
      },
      `${requestLine}\n`,
      120_000,
    );
    const rpcPayload = parseFirstJsonLine(
      "runtime-smoke-contract tool-call-diagnostic-events",
      runResult.stdout,
    );
    const errorData = typeof rpcPayload?.error?.data === "object" && rpcPayload.error.data !== null
      ? rpcPayload.error.data
      : {};
    const events = Array.isArray(errorData.events) ? errorData.events : [];
    const eventTypes = events.map((entry) => {
      if (typeof entry !== "object" || entry === null || typeof entry.event_type !== "string") {
        return "";
      }
      return entry.event_type;
    });
    return {
      exit_code: runResult.exit_code,
      stderr: runResult.stderr,
      error_code: rpcPayload?.error?.code,
      error_class: errorData.error_class ?? "",
      event_types: eventTypes,
    };
  } finally {
    await model.close();
  }
}

export async function runProviderPoolLoadBalance(repoRoot) {
  const providerPoolModel = await startMockModelServer({ content: "POOL_RUNTIME_OK" });
  const providerCount = 10;
  const turnCount = 6;
  try {
    const runResult = await runCommandAsync(
      repoRoot,
      [
        "node",
        "gateway/src/extensions/contracts/start-smoke-contract.mjs",
        "provider-pool-multi-turn-ts-rust",
        "--repo-root",
        repoRoot,
        "--provider-base-url",
        providerPoolModel.baseUrl,
        "--provider-count",
        String(providerCount),
        "--turn-count",
        String(turnCount),
      ],
      null,
      null,
      240_000,
    );
    const payload = parseJsonOutput(
      "runtime-smoke-contract provider-pool-load-balance",
      runResult.stdout,
    );
    const calls = providerPoolModel.getCalls();
    const authorizationCounts = new Map();
    for (const call of calls) {
      const authorization = typeof call.authorization === "string" ? call.authorization : "";
      const key = authorization.length > 0 ? authorization : "<empty>";
      authorizationCounts.set(key, (authorizationCounts.get(key) ?? 0) + 1);
    }
    const sortedAuthorizationCounts = Array.from(authorizationCounts.entries())
      .map(([authorization, count]) => ({ authorization, count }))
      .sort((left, right) => right.count - left.count);
    return {
      ...payload,
      provider_count: providerCount,
      turn_count: turnCount,
      runtime_call_count: calls.length,
      unique_authorization_count: authorizationCounts.size,
      authorization_counts: sortedAuthorizationCounts,
    };
  } finally {
    await providerPoolModel.close();
  }
}
