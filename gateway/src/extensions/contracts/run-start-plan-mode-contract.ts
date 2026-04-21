import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { reviewPlanContent } from "../../orchestration/entrypoints/dev-cli/start/plan-artifact";
import { createRunStartPlanMode } from "../../orchestration/entrypoints/dev-cli/start/run-start-plan-mode";
import { type RunStartPersistence } from "../../orchestration/entrypoints/dev-cli/start/run-start-persistence";
import { type RunStartRuntimeState } from "../../orchestration/entrypoints/dev-cli/start/run-start-runtime-state";
import { type ChatHistoryMessage } from "../../orchestration/entrypoints/dev-cli/start/session-history";
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
  planMeta: SessionPlanMeta | undefined;
  activePlanPath: string;
}

interface ProposedPlanScenarioResult {
  code: number;
  planMode: string;
  activePlanStatus: string;
  activePlanPhase: string;
  activePlanContent: string;
  eventsText: string;
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
  let historyMessages: ChatHistoryMessage[] = [];
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
      planMeta: meta,
      activePlanPath: typeof meta?.active_plan_path === "string" ? meta.active_plan_path : "",
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function runProposedPlanIngestScenario(): Promise<ProposedPlanScenarioResult> {
  const workDir = resolve(
    process.cwd(),
    ".grobot-contract-temp",
    `plan-mode-proposed-${Date.now().toString(36)}-${Math.floor(Math.random() * 65_536).toString(16)}`,
  );
  mkdirSync(workDir, { recursive: true });
  const sessionKey = "feishu:grobot:dm:plan-mode-proposed-contract";
  const runtimeState = createRuntimeState(sessionKey);
  const persistence: RunStartPersistence = {
    persistHistoryState: async () => undefined,
    persistSessionRegistryState: async () => undefined,
  };
  const proposedPlanBlock = [
    "<proposed_plan>",
    "# Runtime Plan Contract",
    "## Summary",
    "- Keep plan mode resilient when semantic index is unavailable.",
    "## Key Changes",
    "- Add policy-driven downgrade for planning phase semantic failures.",
    "- Keep apply phase fail-fast to avoid silent divergence.",
    "## Test Plan",
    "- node gateway/tests/check-gateway-node.mjs",
    "## Assumptions",
    "- semantic fallback only applies during planning turns.",
    "</proposed_plan>",
  ].join("\n");
  try {
    const planMode = createRunStartPlanMode({
      workDir,
      runtimeState,
      persistence,
      executeTurn: async () => {
        const current = runtimeState.getHistoryMessages();
        runtimeState.setHistoryMessages([
          ...current,
          {
            role: "assistant",
            content: [
              "I prepared a complete plan.",
              proposedPlanBlock,
            ].join("\n\n"),
          },
        ]);
        return 0;
      },
      requestRuntimeInterrupt: () => ({
        code: "TURN_INTERRUPT_NOT_RUNNING",
        interrupted: false,
      }),
      markFailureObserved: () => undefined,
      writeStdout: () => undefined,
      writeStderr: () => undefined,
    });

    const code = await planMode.enterPlan("structured plan ingest contract smoke");
    const meta = runtimeState.getPlanMeta();
    const activePlanPath = typeof meta?.active_plan_path === "string" ? meta.active_plan_path : "";
    const activePlanContent = activePlanPath ? readTextSafe(activePlanPath) : "";
    const planDir = `${workDir}/.grobot/plans/${sanitizePlanSessionSegment(sessionKey)}`;
    const eventsPath = `${planDir}/events.jsonl`;
    const eventsText = readTextSafe(eventsPath);
    return {
      code,
      planMode: runtimeState.getPlanMode(),
      activePlanStatus: String(meta?.active_plan_status ?? ""),
      activePlanPhase: String(meta?.active_plan_phase ?? ""),
      activePlanContent,
      eventsText,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const semantic = await runScenario("semantic_index_config_invalid");
  const nonSemantic = await runScenario("upstream_http_error");
  const proposed = await runProposedPlanIngestScenario();
  const proposedReview = reviewPlanContent([
    "<proposed_plan>",
    "# Contract Review",
    "## Summary",
    "- Summary for plan review contract.",
    "## Key Changes",
    "- Add structured plan checks.",
    "## Test Plan",
    "- npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/run-start-plan-mode-contract.ts",
    "## Assumptions",
    "- Reviewer accepts markdown sections as canonical.",
    "</proposed_plan>",
  ].join("\n"));
  const proposedMissingAssumptions = reviewPlanContent([
    "<proposed_plan>",
    "# Contract Review Missing Assumptions",
    "## Summary",
    "- Summary for plan review contract.",
    "## Key Changes",
    "- Add structured plan checks.",
    "## Test Plan",
    "- node gateway/tests/check-gateway-node.mjs",
    "</proposed_plan>",
  ].join("\n"));

  const payload = {
    semantic_turn_returns_success: semantic.code === 0,
    semantic_failure_not_marked: semantic.failureObserved === false,
    semantic_stdout_has_degrade_hint: semantic.stdout.includes("[plan] semantic context degraded"),
    semantic_events_has_degraded: semantic.eventsText.includes("\"event\":\"plan_turn_degraded\""),
    semantic_events_has_policy_degrade: semantic.eventsText.includes("policy_action=degrade"),
    semantic_events_has_policy_reason: semantic.eventsText.includes(
      "policy_reason=planning_semantic_context_unavailable",
    ),
    semantic_events_no_turn_failed: !semantic.eventsText.includes("\"event\":\"plan_turn_failed\""),
    semantic_plan_mode_still_plan_only: semantic.planMode === "plan_only",
    semantic_active_plan_kept: semantic.hasActivePlan,
    semantic_phase_kept_drafting: semantic.planMeta?.active_plan_phase === "drafting",
    non_semantic_turn_returns_failure: nonSemantic.code !== 0,
    non_semantic_failure_marked: nonSemantic.failureObserved === true,
    non_semantic_events_has_turn_failed: nonSemantic.eventsText.includes("\"event\":\"plan_turn_failed\""),
    non_semantic_events_has_policy_fail: nonSemantic.eventsText.includes("policy_action=fail"),
    proposed_turn_returns_success: proposed.code === 0,
    proposed_plan_mode_kept: proposed.planMode === "plan_only",
    proposed_plan_ingested: proposed.activePlanContent.includes("## Key Changes"),
    proposed_plan_strips_tags: !proposed.activePlanContent.includes("<proposed_plan>"),
    proposed_plan_status_is_draft: proposed.activePlanStatus === "draft",
    proposed_plan_phase_is_drafting: proposed.activePlanPhase === "drafting",
    proposed_events_has_content_replaced: proposed.eventsText.includes("\"event\":\"plan_content_replaced\""),
    proposed_events_has_ingested_marker: proposed.eventsText.includes("\"event\":\"plan_proposed_plan_ingested\""),
    proposed_review_passes: proposedReview.ok && proposedReview.blocked === false,
    proposed_review_missing_assumptions_detected:
      proposedMissingAssumptions.findings.some(
        (item) => item.code === "proposed_plan_missing_section" && item.section === "Assumptions",
      ),
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

void main();
