import { type RunStartPersistence } from "../../../cli/start/persistence";
import { type RunStartRuntimeState } from "../../../cli/start/runtime-state";
import { type ChatHistoryMessage } from "../../../cli/start/session-history";
import {
  type SessionPlanMeta,
  type SessionProviderRuntimeState,
  type SessionRegistryPayload,
} from "../../../cli/start/session-registry";

export function sanitizePlanSessionSegment(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "");
  const fallback = normalized.length > 0 ? normalized : "main";
  return fallback.slice(0, 64);
}

export function nowIsoUtc(): string {
  return new Date().toISOString();
}

export function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

export function createRuntimeState(sessionKey: string): RunStartRuntimeState {
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
  let historyMessages: ChatHistoryMessage[] = [];
  let failureObserved = false;
  return {
    getSessionRegistry: () => sessionRegistry,
    getActiveSessionId: () => "main",
    setActiveSessionId: () => undefined,
    getSessionKey: () => sessionKey,
    setSessionKey: () => undefined,
    getHistoryMessages: () => historyMessages,
    setHistoryMessages: (rows: ChatHistoryMessage[]) => {
      historyMessages = rows;
    },
    getRestoreSource: () => "empty",
    markHistoryCompacted: () => undefined,
    hasHistoryCompacted: () => false,
    markFailureObserved: () => {
      failureObserved = true;
    },
    hasFailureObserved: () => failureObserved,
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

export const persistence: RunStartPersistence = {
  persistHistoryState: async () => undefined,
  persistSessionRegistryState: async () => undefined,
};

export const validPlan = [
  "# Contract Plan",
  "",
  "- session_id: feishu:grobot:dm:plan-mode-contract",
  "- plan_id: p_contract",
  "- seq: 1",
  "- status: draft",
  "",
  "## Goal",
  "",
  "验证精简后的 plan 机制流：只保留 /plan、/plan <goal>、/plan open 与自然语言执行。",
  "",
  "## Scope In",
  "",
  "- 校验旧子命令被软失效。",
  "- 校验 /plan open 会回到状态面。",
  "- 校验 Implement the plan. 仍可触发执行。",
  "",
  "## Scope Out",
  "",
  "- 不恢复 approve/reject/verify/benchmark 命令表面。",
  "",
  "## Milestones",
  "",
  "1. [ ] 收敛命令面",
  "   - 完成判据: 只暴露 /plan、/plan <goal>、/plan open。",
  "   - 验证: contract 断言通过。",
  "   - 回退: 恢复旧命令面前重新评估交互复杂度。",
  "",
  "## Validation",
  "",
  "- npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/start-plan-mode-contract.ts；预期: exit 0 且所有断言通过。",
  "",
  "## Risk & Rollback",
  "",
  "- 风险: 旧帮助文案或 contract 未同步。",
  "- 回退: 恢复精简前 surface 并重新整理说明。",
  "",
].join("\n");

export function createProviderFailureState(sessionKey: string): RunStartRuntimeState {
  const runtimeState = createRuntimeState(sessionKey);
  runtimeState.setProviderRuntimeStates([{
    provider_name: "mock",
    consecutive_failures: 1,
    circuit_open_until_ms: 0,
    last_error_class: "upstream_connect_failed",
    last_error_message: "runtime rpc error -32001",
    last_failed_at: nowIsoUtc(),
  }]);
  return runtimeState;
}
