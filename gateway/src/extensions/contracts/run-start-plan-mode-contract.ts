import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createRunStartPlanMode } from "../../orchestration/entrypoints/dev-cli/start/run-start-plan-mode";
import { type RunStartPersistence } from "../../orchestration/entrypoints/dev-cli/start/run-start-persistence";
import { type RunStartRuntimeState } from "../../orchestration/entrypoints/dev-cli/start/run-start-runtime-state";
import {
  type SessionPlanMeta,
  type SessionProviderRuntimeState,
  type SessionRegistryPayload,
} from "../../orchestration/entrypoints/dev-cli/start/session-registry";

interface ScenarioResult {
  code: number;
  failureObserved: boolean;
  stdout: string;
  stderr: string;
  eventsText: string;
  planMode: string;
  hasActivePlan: boolean;
}

function sanitizePlanSessionSegment(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "");
  const fallback = normalized.length > 0 ? normalized : "main";
  return fallback.slice(0, 64);
}

function nowIsoUtc(): string {
  return new Date().toISOString();
}

function readTextSafe(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function createRuntimeState(sessionKey: string): RunStartRuntimeState {
  const now = nowIsoUtc();
  const sessionRegistry: SessionRegistryPayload = {
    version: 1,
    namespace_key: sessionKey,
    active_id: "main",
    sessions: [
      {
        id: "main",
        session_key: sessionKey,
        created_at: now,
        updated_at: now,
        preview: "contract",
      },
    ],
  };
  let planMode: "normal" | "plan_only" = "normal";
  let planMeta: SessionPlanMeta | undefined;
  let providerStates: SessionProviderRuntimeState[] = [];
  return {
    getSessionRegistry: () => sessionRegistry,
    getActiveSessionId: () => "main",
    setActiveSessionId: () => undefined,
    getSessionKey: () => sessionKey,
    setSessionKey: () => undefined,
    getHistoryMessages: () => [],
    setHistoryMessages: () => undefined,
    getRestoreSource: () => "empty",
    markHistoryCompacted: () => undefined,
    hasHistoryCompacted: () => false,
    markFailureObserved: () => undefined,
    hasFailureObserved: () => false,
    getRestoredTurns: () => 0,
    getStickyProvider: () => undefined,
    setStickyProvider: () => undefined,
    getProviderRuntimeStates: () => providerStates,
    setProviderRuntimeStates: (rows: SessionProviderRuntimeState[]) => {
      providerStates = rows;
    },
    getPlanMode: () => planMode,
    setPlanMode: (value: "normal" | "plan_only") => {
      planMode = value;
    },
    getPlanMeta: () => planMeta,
    setPlanMeta: (value: SessionPlanMeta | undefined) => {
      planMeta = value;
    },
    getGaState: () => undefined,
    setGaState: () => undefined,
  };
}

async function runScenario(errorClass: string): Promise<ScenarioResult> {
  const workDir = resolve(
    process.cwd(),
    ".grobot-contract-temp",
    `plan-mode-${Date.now().toString(36)}-${Math.floor(Math.random() * 65_536).toString(16)}`,
  );
  mkdirSync(workDir, { recursive: true });
  const sessionKey = "feishu:grobot:dm:plan-mode-contract";
  const runtimeState = createRuntimeState(sessionKey);
  const persistence: RunStartPersistence = {
    persistHistoryState: async () => undefined,
    persistSessionRegistryState: async () => undefined,
  };
  let failureObserved = false;
  let stdout = "";
  let stderr = "";
  try {
    const planMode = createRunStartPlanMode({
      workDir,
      runtimeState,
      persistence,
      executeTurn: async () => {
        runtimeState.setProviderRuntimeStates([
          {
            provider_name: "mock-provider",
            consecutive_failures: 1,
            circuit_open_until_ms: 0,
            last_error_class: errorClass,
            last_error_message: `mock ${errorClass}`,
            last_failed_at: nowIsoUtc(),
          },
        ]);
        return 1;
      },
      requestRuntimeInterrupt: () => ({
        code: "TURN_INTERRUPT_NOT_RUNNING",
        interrupted: false,
      }),
      markFailureObserved: () => {
        failureObserved = true;
      },
      writeStdout: (message: string) => {
        stdout += message;
      },
      writeStderr: (message: string) => {
        stderr += message;
      },
    });

    const code = await planMode.enterPlan("contract semantic degradation smoke");
    const planDir = `${workDir}/.grobot/plans/${sanitizePlanSessionSegment(sessionKey)}`;
    const eventsPath = `${planDir}/events.jsonl`;
    const eventsText = readTextSafe(eventsPath);
    const meta = runtimeState.getPlanMeta();
    return {
      code,
      failureObserved,
      stdout,
      stderr,
      eventsText,
      planMode: runtimeState.getPlanMode(),
      hasActivePlan: Boolean(meta?.active_plan_id),
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const semantic = await runScenario("semantic_index_config_invalid");
  const nonSemantic = await runScenario("upstream_http_error");

  const payload = {
    semantic_turn_returns_success: semantic.code === 0,
    semantic_failure_not_marked: semantic.failureObserved === false,
    semantic_stdout_has_degrade_hint: semantic.stdout.includes("[plan] semantic context degraded"),
    semantic_events_has_degraded: semantic.eventsText.includes("\"event\":\"plan_turn_degraded\""),
    semantic_events_no_turn_failed: !semantic.eventsText.includes("\"event\":\"plan_turn_failed\""),
    semantic_plan_mode_still_plan_only: semantic.planMode === "plan_only",
    semantic_active_plan_kept: semantic.hasActivePlan,
    non_semantic_turn_returns_failure: nonSemantic.code !== 0,
    non_semantic_failure_marked: nonSemantic.failureObserved === true,
    non_semantic_events_has_turn_failed: nonSemantic.eventsText.includes("\"event\":\"plan_turn_failed\""),
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

void main();
