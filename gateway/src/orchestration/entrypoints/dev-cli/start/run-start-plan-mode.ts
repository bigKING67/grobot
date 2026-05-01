import { readFileSync } from "node:fs";
import { relative as relativePath, resolve as resolvePath } from "node:path";
import {
  resolvePlanFailureDecision,
  type PlanFailureDecision,
  type PlanFailurePhase,
} from "./plan-failure-policy";
import { isNaturalPlanExecutionIntent, parsePlanCommand } from "./plan-command";
import {
  appendPlanEvent,
  appendPlanProgressNote,
  approvePlanArtifact,
  buildPlanQualityBenchmarkEventDetail,
  buildPlanQualityRepairActions,
  buildPlanApplyPrompt,
  createPlanArtifact,
  evaluatePlanQualityBenchmark,
  evaluatePlanQualityBenchmarkHealth,
  evaluatePlanQualityBenchmarkSemanticCorrelation,
  evaluatePlanQualityGuard,
  evaluatePlanQuality,
  evaluatePlanQualityTrend,
  extractLatestProposedPlanBlock,
  loadLatestPlanFailureDiagnostic,
  loadPlanQualityBenchmarkHistory,
  loadLatestPlanVerificationDiagnostic,
  loadPlanArtifactIndex,
  loadActivePlanArtifact,
  resolvePlanQualityBenchmarkPreset,
  resolvePlanQualityGuardPolicy,
  resolvePlanQualityGuardMode,
  resolvePlanQualityBenchmarkRecommendation,
  recoverStaleApprovedPlan,
  recordPlanReviewResult,
  replacePlanArtifactContent,
  reviewPlanContent,
  type PlanArtifactEntry,
  type PlanQualityBenchmarkHistorySummary,
  updatePlanArtifactStatus,
} from "./plan-artifact";
import { type RunStartPersistence } from "./run-start-persistence";
import { type RunStartRuntimeState } from "./run-start-runtime-state";
import { type ChatHistoryMessage } from "./session-history";
import {
  derivePlanPhaseFromStatus,
  PLAN_EXECUTION_REPLY,
  resolvePlanStatusRecommendation,
  resolvePlanStatusRecommendationCommand,
  resolvePlanStatusRecommendationLabel,
} from "./plan-state";
import { evaluateLivePlanDecisionSnapshot } from "./plan-live-status";
import {
  setSessionPlanState,
  type SessionPlanMeta,
  type SessionPlanMode,
} from "./session-registry";
import { TURN_INTERRUPTED_EXIT_CODE } from "./run-start-turn";
import {
  compactSpaces,
  measureDisplayWidth,
  padToDisplayWidth,
  truncateDisplayWidth,
} from "../ui/interactive/display-width";
import { terminalStyle } from "../ui/theme/terminal-style";

interface CreateRunStartPlanModeInput {
  workDir: string;
  runtimeState: RunStartRuntimeState;
  persistence: RunStartPersistence;
  executeTurn(
    userInput: string,
    interactiveMode: boolean,
    options?: {
      promptPrelude?: string;
      writeStdout?: (message: string) => void;
      writeStderr?: (message: string) => void;
    },
  ): Promise<number>;
  requestRuntimeInterrupt(
    source: PlanInterruptSource,
  ): {
    code: "TURN_INTERRUPT_OK" | "TURN_INTERRUPT_NOT_RUNNING";
    interrupted: boolean;
  };
  markFailureObserved(): void;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
}

interface PlanMessageHandleResult {
  handled: boolean;
  code: number;
}

function isPlanSlashCommand(message: string): boolean {
  return /^\/plan(?:\s|$)/.test(message);
}

function normalizePlanReadyApprovalDecision(
  decision: PlanReadyApprovalDecision | undefined,
): NormalizedPlanReadyApprovalDecision {
  if (!decision) {
    return { action: "unavailable" };
  }
  if (typeof decision === "string") {
    return { action: decision };
  }
  if (decision.action === "exit_plan_mode") {
    return {
      action: "exit_plan_mode",
      planContent: decision.planContent,
      silent: decision.silent,
    };
  }
  if (decision.action === "approve") {
    return {
      action: "approve",
      feedback: decision.feedback,
      planContent: decision.planContent,
    };
  }
  if (decision.action === "keep_planning") {
    return {
      action: "keep_planning",
      feedback: decision.feedback,
      planContent: decision.planContent,
      silent: decision.silent,
    };
  }
  return { action: "unavailable" };
}

const PLAN_REVIEW_FAILED_CODE = "PLAN_REVIEW_FAILED";
const PLAN_REVIEW_BLOCKED_CODE = "PLAN_REVIEW_BLOCKED";
const PLAN_QUALITY_GUARD_BLOCKED_CODE = "PLAN_QUALITY_GUARD_BLOCKED";
const PLAN_BENCHMARK_ASSERT_BEST_FAILED_CODE = "PLAN_BENCHMARK_ASSERT_BEST_FAILED";
const PLAN_BENCHMARK_CHECK_FAILED_CODE = "PLAN_BENCHMARK_CHECK_FAILED";
const PLAN_INTERRUPT_OK_CODE = "PLAN_INTERRUPT_OK";
const PLAN_INTERRUPT_NOT_RUNNING_CODE = "PLAN_INTERRUPT_NOT_RUNNING";
const PLAN_INTERRUPT_NOT_PLAN_MODE_CODE = "PLAN_INTERRUPT_NOT_PLAN_MODE";
const PLAN_STATUS_PREVIEW_MAX_LINES = 3;
const PLAN_STATUS_PREVIEW_MAX_CHARS = 140;
const PLAN_APPROVAL_FINGERPRINT_CHARS = 12;
const PLAN_APPROVAL_CARD_MIN_INNER_WIDTH = 44;
const PLAN_APPROVAL_CARD_MAX_INNER_WIDTH = 76;
const PLAN_APPROVAL_CARD_MAX_LINES = 4;
const PLAN_APPROVAL_DIALOG_MIN_WIDTH = 48;
const PLAN_APPROVAL_DIALOG_MAX_WIDTH = 88;
const PLAN_STATUS_PATH_MAX_CHARS = 96;
export type PlanInterruptSource = "command" | "cli_esc";

export interface PlanReadyApprovalRequest {
  workDir: string;
  planPath: string;
  planContent: string;
}

export type PlanReadyApprovalDecision =
  | "approve"
  | "keep_planning"
  | "exit_plan_mode"
  | "unavailable"
  | {
    action: "exit_plan_mode";
    planContent?: string;
    silent?: boolean;
  }
  | {
    action: "approve";
    feedback?: string;
    planContent?: string;
  }
  | {
    action: "keep_planning";
    feedback?: string;
    planContent?: string;
    silent?: boolean;
  }
  | {
    action: "unavailable";
  };

interface NormalizedPlanReadyApprovalDecision {
  action: "approve" | "keep_planning" | "exit_plan_mode" | "unavailable";
  feedback?: string;
  planContent?: string;
  silent?: boolean;
}

export interface RunStartPlanTurnOptions {
  writeStdout?: (message: string) => void;
  writeStderr?: (message: string) => void;
  skipExecution?: boolean;
  diagnosticsMode?: "compact" | "verbose" | "trace";
  showWorkingNotice?: boolean;
  suppressOpenPlanEditorNotice?: boolean;
  requestReadyPlanApproval?: (
    request: PlanReadyApprovalRequest,
  ) => Promise<PlanReadyApprovalDecision>;
}

export interface PlanInterruptResult {
  code:
    | typeof PLAN_INTERRUPT_OK_CODE
    | typeof PLAN_INTERRUPT_NOT_RUNNING_CODE
    | typeof PLAN_INTERRUPT_NOT_PLAN_MODE_CODE;
  accepted: boolean;
  phase: "idle" | "planning" | "applying";
}

interface PlanStablePoint {
  planMode: SessionPlanMode;
  planMeta: SessionPlanMeta | undefined;
}

function humanizePlanTurnPhase(phase: "idle" | "planning" | "applying"): string {
  switch (phase) {
    case "planning":
      return "正在规划";
    case "applying":
      return "正在执行";
    case "idle":
    default:
      return "空闲";
  }
}

function humanizePlanInterruptStage(stage: string): string {
  const normalized = stage.trim();
  switch (normalized) {
    case "before_plan_turn":
    case "before_plan_create":
      return "计划回合开始前";
    case "before_plan_progress_append":
      return "写入计划备注前";
    case "after_plan_progress_append":
      return "写入计划备注后";
    case "after_plan_state_persist":
      return "保存计划状态后";
    case "before_apply_start":
      return "执行计划前";
    case "plan_turn_finalize":
      return "计划回合结束时";
    case "apply_finalize":
      return "执行回合结束时";
    default:
      return normalized || "未知阶段";
  }
}

function buildPlanInterruptSurface(input: {
  code: string;
  kind: "applied" | "ignored" | "not_plan_mode" | "not_running" | "requested";
  phase?: "idle" | "planning" | "applying";
  stage?: string;
  reason?: string;
  runtimeInterrupted?: boolean;
}): string {
  const lines: string[] = [];
  switch (input.kind) {
    case "applied":
      lines.push(
        `${terminalStyle.planMode("●")} 已中断 plan mode 回合`,
        `  ${terminalStyle.muted(`已恢复到安全状态 · 阶段: ${humanizePlanInterruptStage(input.stage ?? "")}`)}`,
      );
      break;
    case "ignored":
      lines.push(
        `${terminalStyle.planMode("●")} 中断请求未生效`,
        `  ${terminalStyle.muted(`回合已完成或已过安全中断点 · 阶段: ${humanizePlanInterruptStage(input.stage ?? "")}`)}`,
      );
      if (input.reason) {
        lines.push(`  ${terminalStyle.muted(`原因: ${input.reason}`)}`);
      }
      break;
    case "not_plan_mode":
      lines.push(
        `${terminalStyle.planMode("●")} 当前不在 plan mode`,
        `  ${terminalStyle.muted("没有可中断的计划回合。")}`,
      );
      break;
    case "not_running":
      lines.push(
        `${terminalStyle.planMode("●")} 当前没有运行中的 plan 回合`,
        `  ${terminalStyle.muted("如果想退出 plan mode，可按 Esc 或使用 /exit。")}`,
      );
      break;
    case "requested":
      lines.push(
        `${terminalStyle.planMode("●")} 已请求中断 plan mode 回合`,
        `  ${terminalStyle.muted(`阶段: ${humanizePlanTurnPhase(input.phase ?? "idle")}`)}`,
      );
      if (typeof input.runtimeInterrupted === "boolean") {
        lines.push(`  ${terminalStyle.muted(`运行时中断: ${input.runtimeInterrupted ? "已发送" : "未运行"}`)}`);
      }
      break;
  }
  lines.push(`  ${terminalStyle.muted(`诊断: ${input.code}`)}`, "");
  return lines.join("\n");
}

function buildPlanModeWorkflowPrompt(inputValue: {
  planFilePath?: string;
}): string {
  const planFileInfo = inputValue.planFilePath
    ? `A plan artifact already exists at ${inputValue.planFilePath}. You can read it and make incremental updates by emitting a full <proposed_plan> block; the plan-mode system persists that block to the artifact.`
    : "No plan artifact is visible yet. The plan-mode system will create one before writing any proposed plan.";

  return [
    "[Plan Mode Workflow]",
    "Plan mode is active. The user indicated that they do not want you to execute yet. You MUST NOT make any edits (with the exception of the plan artifact mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supersedes any other instructions you have received.",
    "",
    "## Plan File Info:",
    planFileInfo,
    "Build the plan incrementally. The plan artifact is the ONLY writable surface during plan mode; everything else must be read-only exploration.",
    "",
    "## Iterative Planning Workflow",
    "You are pair-planning with the user. Explore the code to build context, ask the user questions when you hit decisions you cannot make alone, and write findings into the plan artifact as you go. The plan starts rough and gradually becomes the final implementation plan.",
    "",
    "### The Loop",
    "Repeat this cycle until the plan is complete:",
    "1. Explore - read real files, routes, contracts, tests, logs, and existing patterns. Actively search for existing functions, utilities, and patterns to reuse. Never ask what you could find out by reading code.",
    "2. Update the plan artifact - after each important discovery, capture what you learned. When you have a concrete plan, emit exactly one <proposed_plan>...</proposed_plan> block containing the full markdown plan. Do not emit partial plan fragments outside that block.",
    "3. Ask the user - when requirements, preferences, product tradeoffs, or edge-case priorities are unclear, call ask_user with 1-3 concrete questions. Options must be meaningful; do not add an Other option because the client adds one.",
    "",
    "### First Turn",
    "Start by quickly scanning the key files needed to understand the task scope. Then write a skeleton plan with rough notes and ask the first useful round of questions if user-only decisions remain. Do not explore exhaustively before engaging the user when preferences are required.",
    "",
    "### Plan File Structure",
    "The plan must include concrete sections: ## Goal, ## Scope In, ## Scope Out, ## Milestones, ## Validation, ## Risk & Rollback.",
    "Include the paths of critical files to modify, existing functions/utilities to reuse with file paths, and only your recommended approach. Keep it concise enough to scan but detailed enough to execute.",
    "",
    "### When to Converge",
    "Only emit <proposed_plan> when it is decision-complete and covers: what to change, which files to modify, which existing code to reuse with file paths, how to verify end-to-end, and how to roll back if needed.",
    "Validation must include real commands or explicit manual verification steps plus expected results. Risk & Rollback must name concrete failure modes and executable recovery actions.",
    "If any section would contain TODO/TBD/待补充/low-risk filler, keep exploring or call ask_user before presenting the plan.",
    "",
    "### Ending Your Turn",
    "Your turn should only end by either calling ask_user to gather more information or emitting exactly one final <proposed_plan> block when the plan is ready for approval.",
    "Important: do NOT ask about plan approval via normal text or ask_user. Do not write phrases like \"Is this plan okay?\", \"Should I proceed?\", \"How does this plan look?\", or \"Any changes before we start?\". The proposed plan block itself requests approval in the UI.",
  ].join("\n");
}

export interface RunStartPlanMode {
  isPlanMode(): boolean;
  getActivePlanPath(): string | undefined;
  enterPlan(goal: string, options?: RunStartPlanTurnOptions): Promise<number>;
  showPlanStatus(): Promise<number>;
  runPlanTurn(note: string, options?: RunStartPlanTurnOptions): Promise<number>;
  applyPlan(extra: string, options?: RunStartPlanTurnOptions): Promise<number>;
  cancelPlan(): Promise<number>;
  requestPlanInterrupt(source: PlanInterruptSource): Promise<PlanInterruptResult>;
  handleMessageInput(
    message: string,
    options?: {
      messageMode?: boolean;
    },
  ): Promise<PlanMessageHandleResult>;
}

function buildPlanMeta(entry: PlanArtifactEntry, planPath: string): SessionPlanMeta {
  const activePlanPhase = derivePlanPhaseFromStatus(entry.status);
  return {
    active_plan_id: entry.plan_id,
    active_plan_status: entry.status,
    active_plan_path: planPath,
    active_plan_seq: entry.seq,
    active_plan_title: entry.title,
    review_status:
      entry.status === "ready"
      || entry.status === "blocked"
      || entry.status === "review_failed"
        ? entry.status
        : undefined,
    blocked_count: entry.blocked_count,
    review_fail_count: entry.review_fail_count,
    approved_hash: entry.approved_hash,
    approval_ticket_id: entry.approval_ticket_id,
    approved_snapshot_path: entry.approved_snapshot_path,
    active_plan_phase: activePlanPhase,
    updated_at: entry.updated_at,
  };
}

function parseApprovedContent(snapshotPath: string | undefined, fallback: string): string {
  if (!snapshotPath) {
    return fallback;
  }
  try {
    const snapshot = readFileSync(snapshotPath, "utf8");
    if (snapshot.trim().length > 0) {
      return snapshot;
    }
  } catch {
    // keep fallback content when snapshot file is unavailable.
  }
  return fallback;
}

function resolveBenchmarkPath(workDir: string, rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.startsWith("/")) {
    return resolvePath(trimmed);
  }
  return resolvePath(workDir, trimmed);
}

function formatReviewFindings(findings: readonly { code: string; section?: string; message: string }[]): string {
  if (findings.length === 0) {
    return "none";
  }
  return findings
    .map((item) => `${item.code}:${item.section ?? "global"}:${item.message}`)
    .join(" | ");
}

function isEnvTruthy(raw: string | undefined): boolean {
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return true;
}

function compactPlanStatusLine(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= PLAN_STATUS_PREVIEW_MAX_CHARS) {
    return normalized;
  }
  if (PLAN_STATUS_PREVIEW_MAX_CHARS <= 1) {
    return normalized.slice(0, Math.max(0, PLAN_STATUS_PREVIEW_MAX_CHARS));
  }
  return `${normalized.slice(0, PLAN_STATUS_PREVIEW_MAX_CHARS - 1)}…`;
}

function buildPlanStatusPreviewLines(content: string): string[] {
  if (!content.trim()) {
    return [];
  }
  const lines = content
    .split(/\r?\n/)
    .map((line) => compactPlanStatusLine(line))
    .filter((line) => line.length > 0);
  return lines.slice(0, PLAN_STATUS_PREVIEW_MAX_LINES);
}

function compactPlanApprovalFingerprint(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return "<缺失>";
  }
  return normalized.slice(0, PLAN_APPROVAL_FINGERPRINT_CHARS);
}

function extractTopLevelPlanHeading(content: string): string | undefined {
  for (const line of content.split(/\r?\n/)) {
    const match = line.trim().match(/^#\s+(.+)$/);
    if (match?.[1]?.trim()) {
      return compactSpaces(match[1]);
    }
  }
  return undefined;
}

function extractPlanSectionBody(content: string, heading: string): string | undefined {
  const normalizedHeading = heading.trim().toLowerCase();
  const lines = content.split(/\r?\n/);
  const bodyLines: string[] = [];
  let collecting = false;
  for (const line of lines) {
    const headingMatch = line.trim().match(/^##\s+(.+)$/);
    if (headingMatch) {
      if (collecting) {
        break;
      }
      collecting = headingMatch[1]!.trim().toLowerCase() === normalizedHeading;
      continue;
    }
    if (collecting) {
      bodyLines.push(line);
    }
  }
  return collecting ? bodyLines.join("\n") : undefined;
}

function normalizePlanPreviewLine(line: string): string {
  const withoutMarkdown = line
    .replace(/^\s*[-*]\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/^\s*\[[ xX]\]\s+/, "")
    .replace(/^#+\s+/, "")
    .replace(/\b__REQUIRED__\b\s*[:：]?\s*/gi, "");
  return compactSpaces(withoutMarkdown);
}

function isPlanMetadataPreviewLine(line: string): boolean {
  return /^[-*]\s*(?:session_id|plan_id|seq|status)\s*:/i.test(line.trim());
}

function firstMeaningfulPlanSectionLine(body: string | undefined): string | undefined {
  if (!body) {
    return undefined;
  }
  for (const line of body.split(/\r?\n/)) {
    if (isPlanMetadataPreviewLine(line)) {
      continue;
    }
    const normalized = normalizePlanPreviewLine(line);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function buildHumanPlanPreviewLines(input: {
  title?: string;
  planContent: string;
}): string[] {
  const lines: string[] = [];
  const heading = extractTopLevelPlanHeading(input.planContent);
  const title = heading ?? input.title?.trim();
  if (title) {
    lines.push(compactSpaces(title));
  }

  const goal = firstMeaningfulPlanSectionLine(
    extractPlanSectionBody(input.planContent, "Goal"),
  );
  if (goal) {
    lines.push(`目标: ${goal}`);
  }
  const scope = firstMeaningfulPlanSectionLine(
    extractPlanSectionBody(input.planContent, "Scope In"),
  );
  if (scope) {
    lines.push(`范围: ${scope}`);
  }
  const validation = firstMeaningfulPlanSectionLine(
    extractPlanSectionBody(input.planContent, "Validation"),
  );
  if (validation) {
    lines.push(`验证: ${validation}`);
  }

  if (lines.length <= 1) {
    for (const fallbackLine of buildPlanStatusPreviewLines(input.planContent)) {
      if (!isPlanMetadataPreviewLine(fallbackLine)) {
        lines.push(fallbackLine);
      }
      if (lines.length >= PLAN_APPROVAL_CARD_MAX_LINES) {
        break;
      }
    }
  }

  return [...new Set(lines)].slice(0, PLAN_APPROVAL_CARD_MAX_LINES);
}

function isInternalPlanMetadataLine(line: string): boolean {
  return /^[-*]\s*(?:session_id|plan_id|seq|status|created_at|updated_at)\s*:/i.test(line.trim());
}

function stripInternalPlanMetadata(content: string): string {
  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  let beforeFirstSection = true;
  let previousWasDropped = false;
  for (const line of lines) {
    if (/^##\s+/.test(line.trim())) {
      beforeFirstSection = false;
    }
    if (beforeFirstSection && isInternalPlanMetadataLine(line)) {
      previousWasDropped = true;
      continue;
    }
    if (previousWasDropped && beforeFirstSection && line.trim().length === 0) {
      previousWasDropped = false;
      continue;
    }
    previousWasDropped = false;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

function isUnwrittenPlanSkeleton(content: string): boolean {
  const normalized = content.trim();
  return normalized.length === 0 || normalized.includes("__REQUIRED__");
}

function buildPlanDraftStatusDisplay(input: {
  workDir: string;
  planPath?: string;
}): string {
  const displayPath = input.planPath
    ? formatHumanPlanFilePath({
      workDir: input.workDir,
      planPath: input.planPath,
    })
    : undefined;
  const lines = [
    `${terminalStyle.planMode("●")} 计划草稿`,
  ];
  if (displayPath) {
    lines.push(displayPath);
  }
  lines.push(
    "",
    "Grobot 正在整理实现计划。",
    "确认最终计划前，plan mode 只会读取和规划。",
    '直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。',
    "",
  );
  return lines.join("\n");
}

function buildCurrentPlanDisplay(input: {
  workDir: string;
  planPath: string;
  planContent: string;
  editorName?: string;
}): string {
  const displayPath = formatHumanPlanFilePath({
    workDir: input.workDir,
    planPath: input.planPath,
  });
  const planContent = stripInternalPlanMetadata(input.planContent);
  if (isUnwrittenPlanSkeleton(input.planContent)) {
    return buildPlanDraftStatusDisplay({
      workDir: input.workDir,
      planPath: input.planPath,
    });
  }
  const editorName = compactSpaces(input.editorName ?? "");
  const editHint = editorName.length > 0
    ? `使用 "/plan open" 在 ${editorName} 中编辑此计划`
    : '使用 "/plan open" 编辑此计划';
  return [
    `${terminalStyle.planMode("●")} 当前计划`,
    displayPath,
    "",
    planContent,
    "",
    editHint,
    "",
  ].join("\n");
}

function buildPlanApprovalDivider(planContent: string): string {
  const maxPlanLineWidth = planContent
    .split(/\r?\n/)
    .map((line) => measureDisplayWidth(line.trimEnd()))
    .reduce((max, width) => Math.max(max, width), 0);
  const width = Math.min(
    PLAN_APPROVAL_DIALOG_MAX_WIDTH,
    Math.max(PLAN_APPROVAL_DIALOG_MIN_WIDTH, maxPlanLineWidth),
  );
  return "┄".repeat(width);
}

function buildPlanSavedToHint(input: {
  workDir: string;
  planPath?: string;
}): string | undefined {
  if (!input.planPath) {
    return undefined;
  }
  return `计划已保存: ${formatHumanPlanFilePath({
    workDir: input.workDir,
    planPath: input.planPath,
  })} · /plan open 编辑`;
}

function buildReadyToCodeSurface(input: {
  workDir: string;
  planPath: string;
  planContent: string;
}): string {
  const displayPath = formatHumanPlanFilePath({
    workDir: input.workDir,
    planPath: input.planPath,
  });
  const planContent = stripInternalPlanMetadata(input.planContent);
  if (isUnwrittenPlanSkeleton(input.planContent) || planContent.trim().length === 0) {
    return buildExitPlanModeSurface({
      workDir: input.workDir,
      planPath: input.planPath,
    });
  }
  const divider = buildPlanApprovalDivider(planContent);
  return [
    `${terminalStyle.planMode("●")} 准备开始实现？`,
    `  ${terminalStyle.muted(`计划文件: ${displayPath}`)}`,
    `  ${terminalStyle.muted("执行前请确认计划。")}`,
    "",
    divider,
    "Grobot 的计划：",
    "",
    planContent,
    divider,
    "",
    "─".repeat(Math.max(24, measureDisplayWidth(divider))),
    "是否开始执行？",
    "",
    "❯ 确认，开始实现计划",
    "  继续完善计划",
    "",
    `编辑: /plan open · ${displayPath}`,
    "",
  ].join("\n");
}

function buildExitPlanModeSurface(input: {
  workDir: string;
  planPath: string;
}): string {
  const displayPath = formatHumanPlanFilePath({
    workDir: input.workDir,
    planPath: input.planPath,
  });
  return [
    `${terminalStyle.planMode("●")} 退出 plan mode?`,
    `  ${terminalStyle.muted(`计划文件: ${displayPath}`)}`,
    "",
    "Grobot 将退出 plan mode",
    "",
    "❯ 是，退出",
    "  否，继续规划",
    "",
    `编辑: /plan open · ${displayPath}`,
    "",
  ].join("\n");
}

function buildExitedPlanModeSurface(): string {
  return [
    `${terminalStyle.planMode("●")} 已退出 plan mode`,
    "",
  ].join("\n");
}

function buildPlanCancelSurface(input: {
  kind: "cancelled" | "empty" | "failed";
  workDir?: string;
  planPath?: string;
  detail?: string;
}): string {
  const lines: string[] = [];
  if (input.kind === "cancelled") {
    lines.push(`${terminalStyle.planMode("●")} 已取消计划`);
  } else if (input.kind === "empty") {
    lines.push(`${terminalStyle.planMode("●")} 当前没有可取消的计划`);
  } else {
    lines.push(`${terminalStyle.planMode("●")} 取消计划失败`);
  }
  if (input.workDir && input.planPath) {
    lines.push(
      `  ${terminalStyle.muted(`计划文件: ${formatHumanPlanFilePath({
        workDir: input.workDir,
        planPath: input.planPath,
      })}`)}`,
    );
  }
  if (input.kind === "cancelled") {
    lines.push(`  ${terminalStyle.muted("计划已丢弃，plan mode 已退出。")}`);
  } else if (input.kind === "empty") {
    lines.push(`  ${terminalStyle.muted('plan mode 已退出；使用 "/plan <goal>" 开始新计划。')}`);
  } else {
    lines.push(`  ${terminalStyle.muted(input.detail ?? "计划状态未更新。")}`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildPlanApplyStateSurface(input: {
  kind:
    | "no_active"
    | "lock_recovered"
    | "already_applying"
    | "invalid_status"
    | "internal_failure";
  workDir?: string;
  planPath?: string;
  statusLabel?: string;
  staleMs?: number;
  detail?: string;
  diagnostic?: string;
}): string {
  const lines: string[] = [];
  switch (input.kind) {
    case "no_active":
      lines.push(`${terminalStyle.planMode("●")} 当前没有可执行的计划`);
      break;
    case "lock_recovered":
      lines.push(`${terminalStyle.planMode("●")} 已恢复计划执行锁`);
      break;
    case "already_applying":
      lines.push(`${terminalStyle.planMode("●")} 计划正在执行中`);
      break;
    case "invalid_status":
      lines.push(`${terminalStyle.planMode("●")} 当前计划不能执行`);
      break;
    case "internal_failure":
      lines.push(`${terminalStyle.planMode("●")} 计划执行准备失败`);
      break;
  }
  if (input.workDir && input.planPath) {
    lines.push(
      `  ${terminalStyle.muted(`计划文件: ${formatHumanPlanFilePath({
        workDir: input.workDir,
        planPath: input.planPath,
      })}`)}`,
    );
  }
  if (input.kind === "no_active") {
    lines.push(`  ${terminalStyle.muted('请先使用 "/plan <goal>" 写出计划。')}`);
  } else if (input.kind === "lock_recovered") {
    const staleText = Number.isFinite(input.staleMs) ? ` · stale ${String(input.staleMs)}ms` : "";
    lines.push(`  ${terminalStyle.muted(`上次执行锁已过期，已安全恢复${staleText}。`)}`);
  } else if (input.kind === "already_applying") {
    lines.push(`  ${terminalStyle.muted("请等待当前执行完成；需要停止时按 Esc。")}`);
  } else if (input.kind === "invalid_status") {
    lines.push(`  ${terminalStyle.muted(`状态: ${input.statusLabel ?? "未知"}`)}`);
    lines.push(`  ${terminalStyle.muted('如需重新规划，请使用 "/plan <goal>" 开始新计划。')}`);
  } else {
    lines.push(`  ${terminalStyle.muted(input.detail ?? "计划状态未更新。")}`);
  }
  if (input.diagnostic) {
    lines.push(`  ${terminalStyle.muted(`诊断: ${input.diagnostic}`)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function resolvePlanEditorDisplayName(): string | undefined {
  const rawEditor = String(process.env.VISUAL ?? process.env.EDITOR ?? "").trim();
  if (rawEditor.length === 0) {
    return undefined;
  }
  const command = rawEditor.split(/\s+/)[0] ?? rawEditor;
  const parts = command.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? command;
}

function formatHumanPlanFilePath(input: {
  workDir: string;
  planPath?: string;
}): string {
  const rawPath = input.planPath?.trim();
  if (!rawPath) {
    return "不可用";
  }
  const resolvedPlanPath = resolvePath(rawPath);
  const relativePlanPath = relativePath(input.workDir, resolvedPlanPath);
  const displayPath = relativePlanPath
    && !relativePlanPath.startsWith("..")
    && !relativePlanPath.startsWith("/")
    ? relativePlanPath
    : rawPath;
  if (measureDisplayWidth(displayPath) <= PLAN_STATUS_PATH_MAX_CHARS) {
    return displayPath;
  }
  const parts = displayPath.split(/[\\/]+/).filter((part) => part.length > 0);
  if (parts.length >= 4) {
    const compactPath = [
      parts[0],
      parts[1],
      "...",
      parts[parts.length - 1],
    ].join("/");
    if (measureDisplayWidth(compactPath) <= PLAN_STATUS_PATH_MAX_CHARS) {
      return compactPath;
    }
  }
  return truncateDisplayWidth(displayPath, PLAN_STATUS_PATH_MAX_CHARS, {
    compact: true,
  });
}

function renderPlanCardBorderLine(input: {
  left: string;
  right: string;
  label: string;
  innerWidth: number;
}): string {
  const safeLabel = truncateDisplayWidth(input.label, Math.max(0, input.innerWidth - 4), {
    compact: true,
  });
  const prefix = `─ ${safeLabel} `;
  const fillWidth = Math.max(0, input.innerWidth - measureDisplayWidth(prefix));
  return `${input.left}${prefix}${"─".repeat(fillWidth)}${input.right}`;
}

function renderPlanCardBodyLine(line: string, innerWidth: number): string {
  const bodyWidth = Math.max(0, innerWidth - 2);
  const fitted = padToDisplayWidth(
    truncateDisplayWidth(line, bodyWidth, { compact: true }),
    bodyWidth,
  );
  return `│ ${fitted} │`;
}

function renderApprovedPlanCard(input: {
  title?: string;
  approvedHash: string;
  ticketId: string;
  approvedPlanContent: string;
}): string[] {
  const previewLines = buildHumanPlanPreviewLines({
    title: input.title,
    planContent: input.approvedPlanContent,
  });
  const bodyLines = previewLines.length > 0 ? previewLines : ["已确认计划"];
  const footer = `确认 ${compactPlanApprovalFingerprint(input.ticketId)} · sha256 ${compactPlanApprovalFingerprint(input.approvedHash)}`;
  const titleLabel = "将要实现的计划";
  const innerWidth = Math.min(
    PLAN_APPROVAL_CARD_MAX_INNER_WIDTH,
    Math.max(
      PLAN_APPROVAL_CARD_MIN_INNER_WIDTH,
      measureDisplayWidth(titleLabel) + 4,
      measureDisplayWidth(footer) + 4,
      ...bodyLines.map((line) => measureDisplayWidth(compactSpaces(line)) + 2),
    ),
  );
  return [
    renderPlanCardBorderLine({
      left: "╭",
      right: "╮",
      label: titleLabel,
      innerWidth,
    }),
    ...bodyLines.map((line) => renderPlanCardBodyLine(line, innerWidth)),
    renderPlanCardBorderLine({
      left: "╰",
      right: "╯",
      label: footer,
      innerWidth,
    }),
  ];
}

function buildApprovedPlanExecutionSurface(input: {
  workDir: string;
  planPath?: string;
  title?: string;
  approvedHash: string;
  ticketId: string;
  approvedPlanContent: string;
}): string {
  const savedToHint = buildPlanSavedToHint({
    workDir: input.workDir,
    planPath: input.planPath,
  });
  return [
    `${terminalStyle.planMode("●")} 计划已确认`,
    savedToHint
      ? `  ${terminalStyle.muted(`已确认 · ${savedToHint}`)}`
      : `  ${terminalStyle.muted("已确认")}`,
    ...renderApprovedPlanCard(input),
    "开始按已确认快照实现...",
    "",
  ].join("\n");
}

interface PlanTurnDiagnosticStderr {
  writeStderr(message: string): void;
  flush(): void;
}

function shouldRenderCompactPlanFailureSurface(
  diagnosticsMode?: RunStartPlanTurnOptions["diagnosticsMode"],
): boolean {
  if (isEnvTruthy(process.env.GROBOT_PLAN_STATUS_VERBOSE)
    || isEnvTruthy(process.env.GROBOT_PLAN_FAILURE_VERBOSE)) {
    return false;
  }
  if (diagnosticsMode === "verbose" || diagnosticsMode === "trace") {
    return false;
  }
  return true;
}

function isCompactPlanFailureMachineLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("[runtime-route] failed attempts=")
    || trimmed.startsWith("[runtime-route] all provider circuits are OPEN")
    || trimmed.startsWith("runtime failed:");
}

function createPlanTurnDiagnosticStderr(input: {
  writeStderr: (message: string) => void;
  compactFailureSurface: boolean;
}): PlanTurnDiagnosticStderr {
  if (!input.compactFailureSurface) {
    return {
      writeStderr: input.writeStderr,
      flush: () => undefined,
    };
  }

  let buffered = "";
  const forwardLine = (line: string, suffix: string): void => {
    if (isCompactPlanFailureMachineLine(line)) {
      return;
    }
    input.writeStderr(`${line}${suffix}`);
  };

  return {
    writeStderr: (message: string): void => {
      buffered += message;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
        forwardLine(normalizedLine, "\n");
      }
    },
    flush: (): void => {
      if (!buffered) {
        return;
      }
      const line = buffered.endsWith("\r") ? buffered.slice(0, -1) : buffered;
      buffered = "";
      forwardLine(line, "");
    },
  };
}

function writePlanActivityDiagnostic(
  options: RunStartPlanTurnOptions | undefined,
  event: string,
  detail?: string,
): void {
  if (!options?.showWorkingNotice || !options.writeStderr) {
    return;
  }
  const compactDetail = compactSpaces(detail ?? "");
  options.writeStderr(
    compactDetail
      ? `[plan-mode] event=${event} ${compactDetail}\n`
      : `[plan-mode] event=${event}\n`,
  );
}

function formatCompactPlanFailureReason(input: {
  exitCode: number;
  failureDecision: PlanFailureDecision;
}): string {
  const providerName = input.failureDecision.providerName?.trim();
  const errorClass = input.failureDecision.errorClass?.trim();
  if (input.failureDecision.reason === "provider_runtime_failure" && providerName) {
    return `Provider 不可用: ${providerName}${errorClass ? ` (${errorClass})` : ""}。`;
  }
  if (providerName) {
    return `运行时在 ${providerName} 失败${errorClass ? ` (${errorClass})` : ""}。`;
  }
  return `运行时退出码 ${String(input.exitCode)}（${input.failureDecision.diagnosticCode}）。`;
}

function buildCompactPlanFailureSurface(input: {
  phase: PlanFailurePhase;
  workDir: string;
  planPath?: string;
  exitCode: number;
  failureDecision: PlanFailureDecision;
}): string {
  const isApplying = input.phase === "applying";
  const title = isApplying ? "计划实现失败" : "计划更新失败";
  const savedToHint = buildPlanSavedToHint({
    workDir: input.workDir,
    planPath: input.planPath,
  });
  const stateLine = isApplying
    ? "计划仍可用。修复问题后，再回复“开始实现计划”。"
    : '计划草稿已保留，plan mode 仍处于开启状态。直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。';
  const nextLine = input.failureDecision.reason === "provider_runtime_failure"
    ? "下一步: 修复 provider 配置或切换到可用模型后重试。"
    : "下一步: 先定位运行时失败，再重试计划步骤。";
  const lines = [
    `${terminalStyle.planMode("●")} ${title}`,
  ];
  if (savedToHint) {
    lines.push(`  ${terminalStyle.muted(savedToHint)}`);
  }
  lines.push(
    `  原因: ${formatCompactPlanFailureReason({
      exitCode: input.exitCode,
      failureDecision: input.failureDecision,
    })}`,
    `  ${stateLine}`,
    `  ${nextLine}`,
    `  诊断: ${input.failureDecision.diagnosticCode}; 设置 GROBOT_PLAN_STATUS_VERBOSE=1 或 GROBOT_PLAN_FAILURE_VERBOSE=1 查看完整字段。`,
    "",
  );
  return lines.join("\n");
}

function formatCompactPlanReviewFinding(finding: {
  code: string;
  section?: string;
}): string {
  const section = finding.section ? `${finding.section}: ` : "";
  switch (finding.code) {
    case "placeholder_detected":
      return `${section}将占位符替换为具体细节。`;
    case "validation_missing_command":
      return `${section}增加真实命令或明确的手工验证步骤。`;
    case "validation_missing_expected_result":
      return `${section}写明预期验证结果。`;
    case "risk_missing_item":
      return `${section}写出具体失败模式。`;
    case "risk_too_vague":
      return `${section}把风险写具体，不要只写泛化描述。`;
    case "rollback_missing_item":
      return `${section}增加可执行的回滚或恢复步骤。`;
    case "rollback_too_vague":
      return `${section}把回滚动作写成可执行步骤。`;
    case "goal_too_vague":
      return `${section}把目标写到可验证。`;
    case "scope_in_missing_items":
      return `${section}列出明确纳入范围的文件或模块。`;
    case "scope_out_missing_items":
      return `${section}列出明确不做的边界。`;
    default:
      return `${section}${finding.code.replace(/_/g, " ")}。`;
  }
}

function compactPlanReviewFindingPriority(code: string): number {
  switch (code) {
    case "validation_missing_command":
      return 0;
    case "validation_missing_expected_result":
      return 1;
    case "risk_missing_item":
    case "risk_too_vague":
      return 2;
    case "rollback_missing_item":
    case "rollback_too_vague":
      return 3;
    case "goal_too_vague":
      return 4;
    case "scope_in_missing_items":
    case "scope_out_missing_items":
      return 5;
    case "placeholder_detected":
      return 6;
    default:
      return 9;
  }
}

function buildCompactPlanReviewFailureSurface(input: {
  reviewCode: string;
  blocked: boolean;
  findings: readonly { code: string; section?: string; message: string }[];
}): string {
  const headline = input.blocked ? "计划确认被阻止" : "计划还没准备好";
  const orderedFindings = [...input.findings].sort((left, right) =>
    compactPlanReviewFindingPriority(left.code) - compactPlanReviewFindingPriority(right.code),
  );
  const fixes = orderedFindings
    .slice(0, 4)
    .map((finding) => `修复: ${formatCompactPlanReviewFinding(finding)}`);
  const omitted = input.findings.length > fixes.length
    ? [`还有 ${String(input.findings.length - fixes.length)} 条发现已在精简模式隐藏。`]
    : [];
  return [
    `${terminalStyle.planMode("●")} ${headline}`,
    "  原因: 执行前计划需要更具体的范围、验证和回滚细节。",
    ...fixes.map((line) => `  ${line}`),
    ...omitted.map((line) => `  ${line}`),
    "  下一步: 继续完善计划，然后再回复“开始实现计划”。",
    `  诊断: ${input.reviewCode}; 设置 GROBOT_PLAN_STATUS_VERBOSE=1 或 GROBOT_PLAN_FAILURE_VERBOSE=1 查看完整发现。`,
    "",
  ].join("\n");
}

function writePlanReviewFailureSurface(input: {
  reviewCode: string;
  planId: string;
  compactFailureSurface: boolean;
  review: {
    blocked: boolean;
    findings: readonly { code: string; section?: string; message: string }[];
  };
  writeStderr(message: string): void;
}): void {
  if (input.compactFailureSurface) {
    input.writeStderr(
      buildCompactPlanReviewFailureSurface({
        reviewCode: input.reviewCode,
        blocked: input.review.blocked,
        findings: input.review.findings,
      }),
    );
    return;
  }

  input.writeStderr(
    `[plan-review] code=${input.reviewCode} plan_id=${input.planId} findings=${formatReviewFindings(input.review.findings)}\n\n`,
  );
  input.writeStderr(
    `[plan-review-diagnostics] ${JSON.stringify({
      code: input.reviewCode,
      blocked: input.review.blocked,
      findings_count: input.review.findings.length,
      findings: input.review.findings.map((item) => ({
        code: item.code,
        section: item.section ?? "global",
      })),
    })}\n`,
  );
}

function writePlanQualityGuardBlockedSurface(input: {
  qualityGuardMode: string;
  guardLevel: string;
  guardReason: string;
  compactFailureSurface: boolean;
  writeStderr(message: string): void;
}): void {
  if (input.compactFailureSurface) {
    input.writeStderr(
      [
        `${terminalStyle.planMode("●")} 计划质量门禁阻止执行`,
        `  原因: ${input.guardReason}`,
        "  下一步: 继续完善计划，直到质量门禁不再阻断。",
        `  诊断: ${PLAN_QUALITY_GUARD_BLOCKED_CODE}; 设置 GROBOT_PLAN_STATUS_VERBOSE=1 或 GROBOT_PLAN_FAILURE_VERBOSE=1 查看完整字段。`,
        "",
      ].join("\n"),
    );
    return;
  }
  input.writeStderr(
    `[plan] code=${PLAN_QUALITY_GUARD_BLOCKED_CODE} apply blocked by quality guard (mode=${input.qualityGuardMode}, level=${input.guardLevel}): ${input.guardReason}\n`,
  );
}

function buildPlanModeEnteredSurface(input?: {
  workDir?: string;
  planPath?: string;
  goal?: string;
}): string {
  const displayPath = input?.planPath
    ? formatHumanPlanFilePath({
      workDir: input.workDir ?? "",
      planPath: input.planPath,
    })
    : undefined;
  const compactGoal = compactSpaces(input?.goal ?? "");
  const lines = [
    `${terminalStyle.planMode("●")} 已进入 plan mode`,
  ];
  if (displayPath) {
    lines.push(`  ${terminalStyle.muted(`计划文件: ${displayPath}`)}`);
  }
  if (compactGoal) {
    lines.push(`  ${terminalStyle.muted(`目标: ${truncateDisplayWidth(compactGoal, 88)}`)}`);
  }
  lines.push(
    `  ${terminalStyle.muted("Grobot 正在探索并设计实现方案。")}`,
    `  ${terminalStyle.muted("确认计划前，plan mode 只会读取和规划。")}`,
    "",
    "",
  );
  return lines.join("\n");
}

function buildPlanKeptInPlanningSurface(): string {
  return [
    `${terminalStyle.planMode("●")} 已继续留在 plan mode`,
    `  ${terminalStyle.muted('直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。')}`,
    "",
  ].join("\n");
}

function buildPlanNeedsRefinementSurface(detail: string): string {
  return [
    `${terminalStyle.planMode("●")} 计划需要继续完善`,
    `  ${terminalStyle.muted(detail)}`,
    `  ${terminalStyle.muted('直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。')}`,
    "",
  ].join("\n");
}

function buildPlanUpdatedSurface(input: {
  phase: string;
  nextAction: string;
}): string {
  return [
    `${terminalStyle.planMode("●")} 计划已更新`,
    `  ${terminalStyle.muted(`状态: ${input.phase}`)}`,
    `  ${terminalStyle.muted(`下一步: ${input.nextAction}`)}`,
    "",
  ].join("\n");
}

function writePlanFailureSurface(input: {
  phase: PlanFailurePhase;
  planId: string;
  workDir: string;
  planPath?: string;
  exitCode: number;
  compactFailureSurface: boolean;
  failureDecision: PlanFailureDecision;
  writeStderr(message: string): void;
}): void {
  if (input.compactFailureSurface) {
    input.writeStderr(
      buildCompactPlanFailureSurface({
        phase: input.phase,
        workDir: input.workDir,
        planPath: input.planPath,
        exitCode: input.exitCode,
        failureDecision: input.failureDecision,
      }),
    );
    return;
  }

  const prefix = input.phase === "applying" ? "[plan] apply failed" : "[plan] turn failed";
  input.writeStderr(
    `${prefix} plan_id=${input.planId} exit_code=${String(input.exitCode)} policy_reason=${input.failureDecision.reason} diagnostic=${input.failureDecision.diagnosticCode}${input.failureDecision.errorClass ? ` error_class=${input.failureDecision.errorClass}` : ""}\n`,
  );
}

interface AssistantProposedPlanCandidate {
  content: string;
  historyIndex: number;
}

function extractLatestAssistantProposedPlan(
  historyMessages: readonly ChatHistoryMessage[],
  startIndex: number,
): AssistantProposedPlanCandidate | undefined {
  const safeStartIndex = Math.max(0, Math.floor(startIndex));
  let latest: AssistantProposedPlanCandidate | undefined;
  for (let index = safeStartIndex; index < historyMessages.length; index += 1) {
    const row = historyMessages[index];
    if (!row || row.role !== "assistant") {
      continue;
    }
    const extracted = extractLatestProposedPlanBlock(row.content);
    if (!extracted) {
      continue;
    }
    latest = {
      content: extracted,
      historyIndex: index,
    };
  }
  return latest;
}

export function createRunStartPlanMode(input: CreateRunStartPlanModeInput): RunStartPlanMode {
  const planSessionKey = (): string => input.runtimeState.getSessionKey();
  const resolveQualityGuardRuntime = () => {
    const policyResolved = resolvePlanQualityGuardPolicy({
      workDir: input.workDir,
    });
    const guardMode = resolvePlanQualityGuardMode(
      process.env.GROBOT_PLAN_QUALITY_GUARD_MODE,
      policyResolved.policy.defaults.mode,
    );
    return {
      ...policyResolved,
      guardMode,
    };
  };
  let activeTurnPhase: "idle" | "planning" | "applying" = "idle";
  let pendingInterruptSource: PlanInterruptSource | undefined;

  const clonePlanMeta = (
    planMeta: SessionPlanMeta | undefined,
  ): SessionPlanMeta | undefined => {
    if (!planMeta) {
      return undefined;
    }
    return { ...planMeta };
  };

  const capturePlanStablePoint = (): PlanStablePoint => ({
    planMode: input.runtimeState.getPlanMode(),
    planMeta: clonePlanMeta(input.runtimeState.getPlanMeta()),
  });

  const resolveActivePlanId = (): string | undefined => {
    const active = loadActivePlanArtifact(input.workDir, planSessionKey());
    if (active?.entry.plan_id) {
      return active.entry.plan_id;
    }
    return input.runtimeState.getPlanMeta()?.active_plan_id;
  };

  const evaluateActivePlanLiveSnapshot = (
    active: NonNullable<ReturnType<typeof resolveActivePlan>>,
    latestVerificationStatus?: "pending" | "passed" | "failed",
  ) => {
    const qualityGuardRuntime = resolveQualityGuardRuntime();
    const liveSnapshot = evaluateLivePlanDecisionSnapshot({
      workDir: input.workDir,
      sessionId: planSessionKey(),
      mode: "plan_only",
      entry: active.entry,
      planContent: active.content,
      latestVerificationStatus,
      guardPolicy: qualityGuardRuntime.policy,
      guardMode: qualityGuardRuntime.guardMode,
    });
    return {
      qualityGuardRuntime,
      liveSnapshot,
    };
  };

  const persistPlanState = async (
    planMode: SessionPlanMode,
    planMeta: SessionPlanMeta | undefined,
  ): Promise<void> => {
    input.runtimeState.setPlanMode(planMode);
    input.runtimeState.setPlanMeta(planMeta);
    setSessionPlanState(
      input.runtimeState.getSessionRegistry(),
      input.runtimeState.getActiveSessionId(),
      {
        planMode,
        planMeta,
      },
    );
    await input.persistence.persistSessionRegistryState();
  };

  const consumePendingInterrupt = async (
    snapshot: PlanStablePoint,
    stage: string,
  ): Promise<boolean> => {
    if (!pendingInterruptSource) {
      return false;
    }
    const interruptSource = pendingInterruptSource;
    pendingInterruptSource = undefined;
    const snapshotPlanId = snapshot.planMeta?.active_plan_id?.trim();
    const snapshotPlanStatus = snapshot.planMeta?.active_plan_status;
    if (snapshotPlanId && snapshotPlanStatus) {
      updatePlanArtifactStatus(
        input.workDir,
        planSessionKey(),
        snapshotPlanId,
        snapshotPlanStatus,
      );
    }
    await persistPlanState(snapshot.planMode, clonePlanMeta(snapshot.planMeta));
    appendPlanEvent(input.workDir, planSessionKey(), {
      event: "plan_interrupt_applied",
      plan_id: resolveActivePlanId(),
      source: "cli",
      detail: `source=${interruptSource} stage=${stage} rollback=stable_point`,
    });
    input.writeStdout(
      buildPlanInterruptSurface({
        code: PLAN_INTERRUPT_OK_CODE,
        kind: "applied",
        stage,
      }),
    );
    return true;
  };

  const clearPendingInterruptAsIgnored = (stage: string, reason: string): void => {
    if (!pendingInterruptSource) {
      return;
    }
    const interruptSource = pendingInterruptSource;
    pendingInterruptSource = undefined;
    appendPlanEvent(input.workDir, planSessionKey(), {
      event: "plan_interrupt_ignored",
      plan_id: resolveActivePlanId(),
      source: "cli",
      detail: `source=${interruptSource} stage=${stage} reason=${reason}`,
    });
    input.writeStdout(
      buildPlanInterruptSurface({
        code: PLAN_INTERRUPT_OK_CODE,
        kind: "ignored",
        stage,
        reason,
      }),
    );
  };

  const requestPlanInterrupt = async (
    source: PlanInterruptSource,
  ): Promise<PlanInterruptResult> => {
    if (input.runtimeState.getPlanMode() !== "plan_only") {
      input.writeStdout(
        buildPlanInterruptSurface({
          code: PLAN_INTERRUPT_NOT_PLAN_MODE_CODE,
          kind: "not_plan_mode",
        }),
      );
      return {
        code: PLAN_INTERRUPT_NOT_PLAN_MODE_CODE,
        accepted: false,
        phase: activeTurnPhase,
      };
    }
    if (activeTurnPhase === "idle") {
      input.writeStdout(
        buildPlanInterruptSurface({
          code: PLAN_INTERRUPT_NOT_RUNNING_CODE,
          kind: "not_running",
        }),
      );
      return {
        code: PLAN_INTERRUPT_NOT_RUNNING_CODE,
        accepted: false,
        phase: activeTurnPhase,
      };
    }
    if (!pendingInterruptSource) {
      pendingInterruptSource = source;
      appendPlanEvent(input.workDir, planSessionKey(), {
        event: "plan_interrupt_requested",
        plan_id: resolveActivePlanId(),
        source: "cli",
        detail: `source=${source} phase=${activeTurnPhase}`,
      });
    }
    if (activeTurnPhase === "planning" || activeTurnPhase === "applying") {
      const runtimeInterrupt = input.requestRuntimeInterrupt(source);
      input.writeStdout(
        buildPlanInterruptSurface({
          code: PLAN_INTERRUPT_OK_CODE,
          kind: "requested",
          phase: activeTurnPhase,
          runtimeInterrupted: runtimeInterrupt.interrupted,
        }),
      );
    } else {
      input.writeStdout(
        buildPlanInterruptSurface({
          code: PLAN_INTERRUPT_OK_CODE,
          kind: "requested",
          phase: activeTurnPhase,
        }),
      );
    }
    return {
      code: PLAN_INTERRUPT_OK_CODE,
      accepted: true,
      phase: activeTurnPhase,
    };
  };

  const resolveActivePlan = () => loadActivePlanArtifact(input.workDir, planSessionKey());

  const resolveLatestPlanEntry = (statuses?: readonly string[]) => {
    const index = loadPlanArtifactIndex(input.workDir, planSessionKey());
    const matcher = Array.isArray(statuses) && statuses.length > 0
      ? new Set(statuses)
      : undefined;
    const sorted = [...index.entries].sort((left, right) => {
      if (left.seq !== right.seq) {
        return right.seq - left.seq;
      }
      return right.updated_at.localeCompare(left.updated_at);
    });
    for (const entry of sorted) {
      if (!matcher || matcher.has(entry.status)) {
        return entry;
      }
    }
    return undefined;
  };

  const writeBenchmarkHistoryStatus = (): PlanQualityBenchmarkHistorySummary => {
    const history = loadPlanQualityBenchmarkHistory(input.workDir, planSessionKey(), {
      limit: 3,
    });
    input.writeStdout(`plan_quality_benchmark_total_runs: ${String(history.totalRuns)}\n`);
    if (history.totalRuns <= 0) {
      return history;
    }
    input.writeStdout(`plan_quality_benchmark_recent_count: ${String(history.recentRuns.length)}\n`);
    if (history.latestWinnerLabel) {
      input.writeStdout(`plan_quality_benchmark_latest_winner: ${history.latestWinnerLabel}\n`);
    }
    if (typeof history.latestWinnerScore === "number") {
      input.writeStdout(`plan_quality_benchmark_latest_score: ${String(history.latestWinnerScore)}\n`);
    }
    if (history.latestWinnerGrade) {
      input.writeStdout(`plan_quality_benchmark_latest_grade: ${history.latestWinnerGrade}\n`);
    }
    input.writeStdout(
      `plan_quality_benchmark_latest_top_hint: ${history.latestWinnerTopHint ?? "no_hint_available"}\n`,
    );
    if (history.latestWinnerTopRepairAction) {
      input.writeStdout(`plan_quality_benchmark_latest_top_repair_action: ${history.latestWinnerTopRepairAction}\n`);
    }
    if (typeof history.latestWinnerLeadScore === "number") {
      input.writeStdout(`plan_quality_benchmark_latest_lead_score: ${String(history.latestWinnerLeadScore)}\n`);
    }
    if (history.latestRunAt) {
      input.writeStdout(`plan_quality_benchmark_latest_at: ${history.latestRunAt}\n`);
    }
    input.writeStdout(`plan_quality_benchmark_score_trend: ${history.scoreTrend}\n`);
    if (typeof history.deltaFromPrevious === "number") {
      input.writeStdout(`plan_quality_benchmark_score_delta: ${String(history.deltaFromPrevious)}\n`);
    }
    if (typeof history.winnerChangedFromPrevious === "boolean") {
      input.writeStdout(
        `plan_quality_benchmark_winner_changed: ${history.winnerChangedFromPrevious ? "yes" : "no"}\n`,
      );
    }
    if (history.winnerSequence.length > 0) {
      input.writeStdout(`plan_quality_benchmark_winner_sequence: ${history.winnerSequence.join(" -> ")}\n`);
    }
    if (history.winnerReasonSequence.length > 0) {
      input.writeStdout(`plan_quality_benchmark_winner_reason_sequence: ${history.winnerReasonSequence.join(" -> ")}\n`);
    }
    input.writeStdout(`plan_quality_benchmark_winner_switch_count: ${String(history.winnerSwitchCount)}\n`);
    input.writeStdout(`plan_quality_benchmark_assert_count: ${String(history.assertCount)}\n`);
    input.writeStdout(`plan_quality_benchmark_assert_pass_count: ${String(history.assertPassCount)}\n`);
    input.writeStdout(`plan_quality_benchmark_assert_fail_count: ${String(history.assertFailCount)}\n`);
    if (typeof history.assertPassRate === "number") {
      input.writeStdout(`plan_quality_benchmark_assert_pass_rate: ${String(history.assertPassRate)}\n`);
    }
    const runsPayload = history.recentRuns.map((run) => ({
      at: run.at,
      plan_id: run.planId ?? "",
      compared_count: run.comparedCount,
      winner_label: run.winnerLabel,
      winner_score: run.winnerScore,
      winner_grade: run.winnerGrade,
      preset: run.preset ?? "",
      guard_mode: run.guardMode ?? "",
      guard_policy_profile: run.guardPolicyProfile ?? "",
      winner_top_hint: run.winnerTopHint ?? "",
      winner_top_repair_action: run.winnerTopRepairAction ?? "",
      runner_up_label: run.runnerUpLabel ?? "",
      runner_up_score: typeof run.runnerUpScore === "number" ? run.runnerUpScore : null,
      winner_lead_score: typeof run.winnerLeadScore === "number" ? run.winnerLeadScore : null,
      assert_best: run.assertBest ?? "",
      assert_passed: typeof run.assertPassed === "boolean" ? run.assertPassed : null,
      assert_actual: run.assertActual ?? "",
    }));
    input.writeStdout(`plan_quality_benchmark_recent_runs: ${JSON.stringify(runsPayload)}\n`);
    return history;
  };

  const writeBenchmarkSignals = (
    latestFailure?: ReturnType<typeof loadLatestPlanFailureDiagnostic>,
  ) => {
    const history = writeBenchmarkHistoryStatus();
    const semantic = evaluatePlanQualityBenchmarkSemanticCorrelation({
      latestFailure,
      history,
    });
    const health = evaluatePlanQualityBenchmarkHealth({
      history,
      semanticCorrelation: semantic.level,
    });
    const recommendation = resolvePlanQualityBenchmarkRecommendation({
      history,
      semanticCorrelation: semantic.level,
      health,
    });
    input.writeStdout(`plan_quality_benchmark_semantic_correlation: ${semantic.level}\n`);
    input.writeStdout(`plan_quality_benchmark_semantic_reason: ${semantic.reason}\n`);
    input.writeStdout(`plan_quality_benchmark_health_score: ${String(health.score)}\n`);
    input.writeStdout(`plan_quality_benchmark_health_level: ${health.level}\n`);
    input.writeStdout(`plan_quality_benchmark_health_reason: ${health.reason}\n`);
    input.writeStdout(`plan_quality_benchmark_health_components: ${JSON.stringify(health.components)}\n`);
    input.writeStdout(`plan_quality_benchmark_recommended_next_action: ${recommendation.action}\n`);
    input.writeStdout(`plan_quality_benchmark_recommendation_reason: ${recommendation.reason}\n`);
    return {
      history,
      semantic,
      health,
      recommendation,
    };
  };

  // Default to a human-readable surface everywhere. Machine fields are opt-in via verbose mode.
  const shouldRenderCompactPlanStatus = (): boolean =>
    !isEnvTruthy(process.env.GROBOT_PLAN_STATUS_VERBOSE);

  const shouldRenderCompactPlanBenchmark = (): boolean =>
    Boolean(process.stdin.isTTY) && !isEnvTruthy(process.env.GROBOT_PLAN_BENCHMARK_VERBOSE);

  const writePlanRecommendationLines = (recommendation: { action: string; reason: string }): void => {
    const suggestedCommand = resolvePlanStatusRecommendationCommand(recommendation.action);
    const suggestedLabel = resolvePlanStatusRecommendationLabel(recommendation.action);
    input.writeStdout(`recommended_next_action: ${recommendation.action}\n`);
    input.writeStdout(`recommendation_reason: ${recommendation.reason}\n`);
    input.writeStdout(`suggested_action_label: ${suggestedLabel}\n`);
    input.writeStdout(`suggested_action_command: ${suggestedCommand}\n`);
    input.writeStdout(`suggested_action_reason: ${recommendation.reason}\n`);
  };

  const humanizePlanStatus = (status: string | undefined): string => {
    switch (status) {
      case "draft":
        return "草稿";
      case "ready":
        return "待确认";
      case "blocked":
        return "已阻止";
      case "review_failed":
        return "需完善";
      case "approved":
        return "已确认";
      case "applying":
        return "执行中";
      case "applied":
        return "已执行";
      case "apply_failed":
        return "执行失败";
      case "discarded":
        return "已取消";
      default:
        return status && status.trim().length > 0 ? status : "未知";
    }
  };

  const humanizePlanPhase = (phase: string | undefined): string => {
    switch (phase) {
      case "drafting":
        return "草稿";
      case "awaiting_decision":
        return "待确认";
      case "applying":
        return "执行中";
      default:
        return phase && phase.trim().length > 0 ? phase : "未知";
    }
  };

  const showPlanStatusCompact = async (): Promise<number> => {
    const mode = input.runtimeState.getPlanMode();
    const meta = input.runtimeState.getPlanMeta();
    const active = resolveActivePlan();
    if (active) {
      input.writeStdout(buildCurrentPlanDisplay({
        workDir: input.workDir,
        planPath: active.planPath,
        planContent: active.content,
        editorName: resolvePlanEditorDisplayName(),
      }));
      return 0;
    }
    if (mode === "plan_only" && meta?.active_plan_id) {
      const planPath = typeof meta.active_plan_path === "string" && meta.active_plan_path.length > 0
        ? meta.active_plan_path
        : undefined;
      input.writeStdout(buildPlanDraftStatusDisplay({
        workDir: input.workDir,
        planPath,
      }));
      return 0;
    }
    const latestApplied = resolveLatestPlanEntry(["applied", "apply_failed"]);
    if (latestApplied) {
      input.writeStdout("当前计划\n");
      input.writeStdout("当前没有活跃计划。\n");
      input.writeStdout(`最近计划: ${latestApplied.plan_id} (${humanizePlanStatus(latestApplied.status)})\n`);
      input.writeStdout("使用 \"/plan <goal>\" 开始新计划\n\n");
      return 0;
    }
    input.writeStdout("当前计划\n");
    input.writeStdout("还没有写入计划。\n");
    input.writeStdout("使用 \"/plan <goal>\" 开始规划\n\n");
    return 0;
  };

  const printPlanModeHint = (writeStdout: (message: string) => void = input.writeStdout): void => {
    writeStdout(
      [
        "plan mode 只读；直接输入需求即可继续完善计划。",
        "可执行计划需要明确范围、里程碑、验证命令/预期结果和回滚步骤。",
        "使用 /plan open 查看计划文件。",
        "确认后回复“开始实现计划”即可执行。",
        "",
      ].join("\n"),
    );
  };

  const createPlanModeDraft = async (
    goalForTitleRaw: string,
    options?: {
      printHint?: boolean;
      printModeReadyOnly?: boolean;
      writeStdout?: (message: string) => void;
    },
  ): Promise<number> => {
    const writeStdout = options?.writeStdout ?? input.writeStdout;
    const compactGoal = goalForTitleRaw.trim();
    const draftTitle = compactGoal.length > 0 ? compactGoal : "plan session";
    const created = createPlanArtifact(input.workDir, planSessionKey(), draftTitle);
    await persistPlanState(
      "plan_only",
      buildPlanMeta(created.entry, created.planPath),
    );
    appendPlanEvent(input.workDir, planSessionKey(), {
      event: "plan_mode_entered",
      plan_id: created.entry.plan_id,
      source: "cli",
      detail: "entered plan_only mode",
    });
    void options?.printModeReadyOnly;
    writeStdout(buildPlanModeEnteredSurface({
      workDir: input.workDir,
      planPath: created.planPath,
      goal: compactGoal,
    }));
    if (options?.printHint !== false) {
      printPlanModeHint(writeStdout);
    }
    return 0;
  };

  const enterPlan = async (
    goalRaw: string,
    options?: RunStartPlanTurnOptions,
  ): Promise<number> => {
    const goal = goalRaw.trim();
    writePlanActivityDiagnostic(options, "enter_started");
    if (!goal) {
      const created = await createPlanModeDraft("", {
        printHint: false,
        printModeReadyOnly: true,
        writeStdout: options?.writeStdout,
      });
      writePlanActivityDiagnostic(options, "draft_created");
      return created;
    }
    const entered = await createPlanModeDraft(goal, {
      printHint: false,
      printModeReadyOnly: false,
      writeStdout: options?.writeStdout,
    });
    writePlanActivityDiagnostic(options, "draft_created");
    if (entered !== 0) {
      return entered;
    }
    return runPlanTurn(goal, options);
  };

  const showPlanStatus = async (): Promise<number> => {
    if (shouldRenderCompactPlanStatus()) {
      return showPlanStatusCompact();
    }
    const mode = input.runtimeState.getPlanMode();
    const meta = input.runtimeState.getPlanMeta();
    const active = resolveActivePlan();
    input.writeStdout("[plan-status]\n");
    input.writeStdout("plan_status_output_mode: full\n");
    input.writeStdout(`mode: ${mode}\n`);
    if (active) {
      const activeMeta = buildPlanMeta(active.entry, active.planPath);
      const previewLines = buildPlanStatusPreviewLines(active.content);
      const activeNonEmptyLineCount = active.content
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .length;
      input.writeStdout("[plan-current]\n");
      input.writeStdout(`title: ${activeMeta.active_plan_title ?? "<none>"}\n`);
      const latestFailure = loadLatestPlanFailureDiagnostic(input.workDir, planSessionKey(), {
        planId: activeMeta.active_plan_id,
      });
      const latestVerification = loadLatestPlanVerificationDiagnostic(input.workDir, planSessionKey(), {
        planId: activeMeta.active_plan_id,
      });
      const latestVerificationStatus = latestVerification?.status;
      const { qualityGuardRuntime, liveSnapshot } = evaluateActivePlanLiveSnapshot(
        active,
        latestVerificationStatus,
      );
      input.writeStdout(`status: ${liveSnapshot.liveStatus}\n`);
      input.writeStdout(`path: ${activeMeta.active_plan_path ?? "<none>"}\n`);
      if (previewLines.length > 0) {
        for (let previewIndex = 0; previewIndex < previewLines.length; previewIndex += 1) {
          input.writeStdout(`preview_${String(previewIndex + 1)}: ${previewLines[previewIndex]}\n`);
        }
      }
      if (activeNonEmptyLineCount > previewLines.length) {
        input.writeStdout("preview_more: ...\n");
      }
      input.writeStdout("\n");
      input.writeStdout(`active_plan_id: ${activeMeta.active_plan_id ?? "<none>"}\n`);
      input.writeStdout(`active_plan_status: ${liveSnapshot.liveStatus}\n`);
      input.writeStdout(`active_plan_phase: ${liveSnapshot.livePhase}\n`);
      input.writeStdout(`active_plan_status_source: ${liveSnapshot.statusSource}\n`);
      input.writeStdout(`active_plan_decision_ready: ${liveSnapshot.decisionReady ? "yes" : "no"}\n`);
      input.writeStdout(`active_plan_approval_stale: ${liveSnapshot.approvalStale ? "yes" : "no"}\n`);
      if (liveSnapshot.statusSource === "live_snapshot") {
        input.writeStdout(`active_plan_stored_status: ${liveSnapshot.storedStatus}\n`);
        if (liveSnapshot.storedPhase) {
          input.writeStdout(`active_plan_stored_phase: ${liveSnapshot.storedPhase}\n`);
        }
      }
      input.writeStdout(`active_plan_path: ${activeMeta.active_plan_path ?? "<none>"}\n`);
      if (activeMeta.active_plan_path) {
        input.writeStdout("plan_open_hint: /plan open\n");
      }
      input.writeStdout(`active_plan_seq: ${String(activeMeta.active_plan_seq ?? 0)}\n`);
      input.writeStdout(`active_plan_title: ${activeMeta.active_plan_title ?? "<none>"}\n`);
      if (latestFailure) {
        input.writeStdout(`latest_failure_event: ${latestFailure.event}\n`);
        input.writeStdout(`latest_failure_at: ${latestFailure.at}\n`);
        if (typeof latestFailure.exitCode === "number") {
          input.writeStdout(`latest_failure_exit_code: ${String(latestFailure.exitCode)}\n`);
        }
        if (latestFailure.policyAction) {
          input.writeStdout(`latest_failure_policy_action: ${latestFailure.policyAction}\n`);
        }
        if (latestFailure.policyReason) {
          input.writeStdout(`latest_failure_policy_reason: ${latestFailure.policyReason}\n`);
        }
        if (latestFailure.diagnosticCode) {
          input.writeStdout(`latest_failure_diagnostic_code: ${latestFailure.diagnosticCode}\n`);
        }
        if (latestFailure.providerName) {
          input.writeStdout(`latest_failure_provider: ${latestFailure.providerName}\n`);
        }
        if (latestFailure.errorClass) {
          input.writeStdout(`latest_failure_error_class: ${latestFailure.errorClass}\n`);
        }
        if (typeof latestFailure.reviewBlocked === "boolean") {
          input.writeStdout(`latest_failure_review_blocked: ${latestFailure.reviewBlocked ? "yes" : "no"}\n`);
        }
        if (typeof latestFailure.findingsCount === "number") {
          input.writeStdout(`latest_failure_findings_count: ${String(latestFailure.findingsCount)}\n`);
        }
      } else {
        input.writeStdout("latest_failure_event: <none>\n");
      }
      if (latestVerification) {
        input.writeStdout(`latest_verification_event: ${latestVerification.event}\n`);
        input.writeStdout(`latest_verification_status: ${latestVerification.status}\n`);
        input.writeStdout(`latest_verification_at: ${latestVerification.at}\n`);
      } else {
        input.writeStdout("latest_verification_event: <none>\n");
      }
      input.writeStdout(`plan_quality_score: ${String(liveSnapshot.quality.score)}\n`);
      input.writeStdout(`plan_quality_grade: ${liveSnapshot.quality.grade}\n`);
      input.writeStdout(`plan_quality_findings_count: ${String(liveSnapshot.quality.findingCount)}\n`);
      input.writeStdout(`plan_quality_blocked: ${liveSnapshot.quality.blocked ? "yes" : "no"}\n`);
      input.writeStdout(`plan_quality_recommendation: ${liveSnapshot.quality.recommendation}\n`);
      input.writeStdout(`plan_quality_trend: ${liveSnapshot.qualityTrend.trend}\n`);
      if (typeof liveSnapshot.qualityTrend.previousScore === "number") {
        input.writeStdout(`plan_quality_previous_score: ${String(liveSnapshot.qualityTrend.previousScore)}\n`);
      }
      if (typeof liveSnapshot.qualityTrend.deltaFromPrevious === "number") {
        input.writeStdout(`plan_quality_delta_from_previous: ${String(liveSnapshot.qualityTrend.deltaFromPrevious)}\n`);
      }
      if (liveSnapshot.qualityTrend.previousPlanId) {
        input.writeStdout(`plan_quality_previous_plan_id: ${liveSnapshot.qualityTrend.previousPlanId}\n`);
      }
      input.writeStdout(`plan_quality_guard_mode: ${liveSnapshot.qualityGuardMode}\n`);
      input.writeStdout(`plan_quality_guard_level: ${liveSnapshot.qualityGuard.level}\n`);
      input.writeStdout(`plan_quality_regression_streak: ${String(liveSnapshot.qualityGuard.regressionStreak)}\n`);
      input.writeStdout(`plan_quality_guard_reason: ${liveSnapshot.qualityGuard.reason}\n`);
      input.writeStdout(`plan_quality_guard_policy_profile: ${qualityGuardRuntime.policy.profile}\n`);
      input.writeStdout(`plan_quality_guard_policy_source: ${qualityGuardRuntime.source}\n`);
      if (qualityGuardRuntime.policyPath) {
        input.writeStdout(`plan_quality_guard_policy_path: ${qualityGuardRuntime.policyPath}\n`);
      }
      if (qualityGuardRuntime.warning) {
        input.writeStdout(`plan_quality_guard_policy_warning: ${qualityGuardRuntime.warning}\n`);
      }
      if (liveSnapshot.quality.rewriteHints.length > 0) {
        input.writeStdout(`plan_quality_rewrite_hints: ${liveSnapshot.quality.rewriteHints.join(" | ")}\n`);
      }
      if (liveSnapshot.repairActions.length > 0) {
        const summary = liveSnapshot.repairActions
          .map((item) => `[${item.priority}] ${item.title} => ${item.command}`)
          .join(" || ");
        input.writeStdout(`plan_quality_repair_actions: ${summary}\n`);
      }
      writeBenchmarkSignals(latestFailure);
      writePlanRecommendationLines(liveSnapshot.recommendation);
    } else if (mode === "plan_only" && meta?.active_plan_id) {
      input.writeStdout(`active_plan_id: ${meta.active_plan_id}\n`);
      input.writeStdout(`active_plan_status: ${meta.active_plan_status ?? "draft"}\n`);
      if (meta.active_plan_phase) {
        input.writeStdout(`active_plan_phase: ${meta.active_plan_phase}\n`);
      }
      if (meta.active_plan_path) {
        input.writeStdout(`active_plan_path: ${meta.active_plan_path}\n`);
        input.writeStdout("plan_open_hint: /plan open\n");
      }
      if (typeof meta.active_plan_seq === "number") {
        input.writeStdout(`active_plan_seq: ${String(meta.active_plan_seq)}\n`);
      }
      if (meta.active_plan_title) {
        input.writeStdout(`active_plan_title: ${meta.active_plan_title}\n`);
      }
      if (meta.review_status) {
        input.writeStdout(`review_status: ${meta.review_status}\n`);
      }
      if (typeof meta.blocked_count === "number") {
        input.writeStdout(`blocked_count: ${String(meta.blocked_count)}\n`);
      }
      if (typeof meta.review_fail_count === "number") {
        input.writeStdout(`review_fail_count: ${String(meta.review_fail_count)}\n`);
      }
      if (meta.approved_hash) {
        input.writeStdout(`approved_hash: ${meta.approved_hash}\n`);
      }
      if (meta.approval_ticket_id) {
        input.writeStdout(`approval_ticket_id: ${meta.approval_ticket_id}\n`);
      }
      if (meta.approved_snapshot_path) {
        input.writeStdout(`approved_snapshot_path: ${meta.approved_snapshot_path}\n`);
      }
      const latestFailure = loadLatestPlanFailureDiagnostic(input.workDir, planSessionKey(), {
        planId: meta.active_plan_id,
      });
      if (latestFailure) {
        input.writeStdout(`latest_failure_event: ${latestFailure.event}\n`);
        input.writeStdout(`latest_failure_at: ${latestFailure.at}\n`);
        if (typeof latestFailure.exitCode === "number") {
          input.writeStdout(`latest_failure_exit_code: ${String(latestFailure.exitCode)}\n`);
        }
        if (latestFailure.policyAction) {
          input.writeStdout(`latest_failure_policy_action: ${latestFailure.policyAction}\n`);
        }
        if (latestFailure.policyReason) {
          input.writeStdout(`latest_failure_policy_reason: ${latestFailure.policyReason}\n`);
        }
        if (latestFailure.diagnosticCode) {
          input.writeStdout(`latest_failure_diagnostic_code: ${latestFailure.diagnosticCode}\n`);
        }
        if (latestFailure.providerName) {
          input.writeStdout(`latest_failure_provider: ${latestFailure.providerName}\n`);
        }
        if (latestFailure.errorClass) {
          input.writeStdout(`latest_failure_error_class: ${latestFailure.errorClass}\n`);
        }
        if (typeof latestFailure.reviewBlocked === "boolean") {
          input.writeStdout(`latest_failure_review_blocked: ${latestFailure.reviewBlocked ? "yes" : "no"}\n`);
        }
        if (typeof latestFailure.findingsCount === "number") {
          input.writeStdout(`latest_failure_findings_count: ${String(latestFailure.findingsCount)}\n`);
        }
      } else {
        input.writeStdout("latest_failure_event: <none>\n");
      }
      const latestVerification = loadLatestPlanVerificationDiagnostic(input.workDir, planSessionKey(), {
        planId: meta.active_plan_id,
      });
      const latestVerificationStatus = latestVerification?.status;
      let qualityScore: number | undefined;
      let qualityTopHint: string | undefined;
      let qualityGuardLevel: "healthy" | "watch" | "critical" | undefined;
      let qualityGuardReason: string | undefined;
      let qualityTopRepairActionTitle: string | undefined;
      const qualityGuardRuntime = resolveQualityGuardRuntime();
      if (typeof meta.active_plan_path === "string" && meta.active_plan_path.length > 0) {
        try {
          const fallbackContent = readFileSync(meta.active_plan_path, "utf8");
          const quality = evaluatePlanQuality(fallbackContent);
          const qualityTrend = evaluatePlanQualityTrend({
            workDir: input.workDir,
            sessionId: planSessionKey(),
            currentPlanId: meta.active_plan_id,
            currentScore: quality.score,
          });
          const qualityGuard = evaluatePlanQualityGuard({
            workDir: input.workDir,
            sessionId: planSessionKey(),
            currentPlanId: meta.active_plan_id,
            quality,
            trend: qualityTrend,
            policy: qualityGuardRuntime.policy,
          });
          const repairActions = buildPlanQualityRepairActions({
            planContent: fallbackContent,
            quality,
            trend: qualityTrend,
            guard: qualityGuard,
          });
          qualityScore = quality.score;
          qualityTopHint = quality.rewriteHints[0];
          qualityTopRepairActionTitle = repairActions[0]?.title;
          qualityGuardLevel = qualityGuard.level;
          qualityGuardReason = qualityGuard.reason;
          input.writeStdout(`plan_quality_score: ${String(quality.score)}\n`);
          input.writeStdout(`plan_quality_grade: ${quality.grade}\n`);
          input.writeStdout(`plan_quality_findings_count: ${String(quality.findingCount)}\n`);
          input.writeStdout(`plan_quality_blocked: ${quality.blocked ? "yes" : "no"}\n`);
          input.writeStdout(`plan_quality_recommendation: ${quality.recommendation}\n`);
          input.writeStdout(`plan_quality_trend: ${qualityTrend.trend}\n`);
          if (typeof qualityTrend.previousScore === "number") {
            input.writeStdout(`plan_quality_previous_score: ${String(qualityTrend.previousScore)}\n`);
          }
          if (typeof qualityTrend.deltaFromPrevious === "number") {
            input.writeStdout(`plan_quality_delta_from_previous: ${String(qualityTrend.deltaFromPrevious)}\n`);
          }
          if (qualityTrend.previousPlanId) {
            input.writeStdout(`plan_quality_previous_plan_id: ${qualityTrend.previousPlanId}\n`);
          }
          input.writeStdout(`plan_quality_guard_mode: ${qualityGuardRuntime.guardMode}\n`);
          input.writeStdout(`plan_quality_guard_level: ${qualityGuard.level}\n`);
          input.writeStdout(`plan_quality_regression_streak: ${String(qualityGuard.regressionStreak)}\n`);
          input.writeStdout(`plan_quality_guard_reason: ${qualityGuard.reason}\n`);
          input.writeStdout(`plan_quality_guard_policy_profile: ${qualityGuardRuntime.policy.profile}\n`);
          input.writeStdout(`plan_quality_guard_policy_source: ${qualityGuardRuntime.source}\n`);
          if (qualityGuardRuntime.policyPath) {
            input.writeStdout(`plan_quality_guard_policy_path: ${qualityGuardRuntime.policyPath}\n`);
          }
          if (qualityGuardRuntime.warning) {
            input.writeStdout(`plan_quality_guard_policy_warning: ${qualityGuardRuntime.warning}\n`);
          }
          if (quality.rewriteHints.length > 0) {
            input.writeStdout(`plan_quality_rewrite_hints: ${quality.rewriteHints.join(" | ")}\n`);
          }
          if (repairActions.length > 0) {
            const summary = repairActions
              .map((item) => `[${item.priority}] ${item.title} => ${item.command}`)
              .join(" || ");
            input.writeStdout(`plan_quality_repair_actions: ${summary}\n`);
          }
        } catch {
          input.writeStdout("plan_quality_score: <unavailable>\n");
        }
      } else {
        input.writeStdout("plan_quality_score: <unavailable>\n");
      }
      if (latestVerification) {
        input.writeStdout(`latest_verification_event: ${latestVerification.event}\n`);
        input.writeStdout(`latest_verification_status: ${latestVerification.status}\n`);
        input.writeStdout(`latest_verification_at: ${latestVerification.at}\n`);
      } else {
        input.writeStdout("latest_verification_event: <none>\n");
      }
      writeBenchmarkSignals(latestFailure);
      const recommendation = resolvePlanStatusRecommendation({
        mode: "plan_only",
        status: meta.active_plan_status,
        latestVerificationStatus,
        planQualityScore: qualityScore,
        planQualityTopHint: qualityTopRepairActionTitle ?? qualityTopHint,
        planQualityGuardLevel: qualityGuardLevel,
        planQualityGuardReason: qualityGuardReason,
        interactiveMenuFirst: process.stdin.isTTY,
      });
      writePlanRecommendationLines(recommendation);
    } else {
      const latestApplied = resolveLatestPlanEntry(["applied", "apply_failed"]);
      if (latestApplied) {
        input.writeStdout(`active_plan_id: <none>\n`);
        input.writeStdout(`latest_plan_id: ${latestApplied.plan_id}\n`);
        input.writeStdout(`latest_plan_status: ${latestApplied.status}\n`);
        input.writeStdout(`latest_plan_seq: ${String(latestApplied.seq)}\n`);
        const latestFailure = loadLatestPlanFailureDiagnostic(input.workDir, planSessionKey(), {
          planId: latestApplied.plan_id,
        });
        if (latestFailure) {
          input.writeStdout(`latest_failure_event: ${latestFailure.event}\n`);
          if (latestFailure.diagnosticCode) {
            input.writeStdout(`latest_failure_diagnostic_code: ${latestFailure.diagnosticCode}\n`);
          }
        } else {
          input.writeStdout("latest_failure_event: <none>\n");
        }
        const latestVerification = loadLatestPlanVerificationDiagnostic(input.workDir, planSessionKey(), {
          planId: latestApplied.plan_id,
        });
        const latestVerificationStatus = latestVerification?.status;
        if (latestVerification) {
          input.writeStdout(`latest_verification_event: ${latestVerification.event}\n`);
          input.writeStdout(`latest_verification_status: ${latestVerification.status}\n`);
          input.writeStdout(`latest_verification_at: ${latestVerification.at}\n`);
        } else {
          input.writeStdout("latest_verification_event: <none>\n");
        }
        input.writeStdout("plan_quality_score: <n/a>\n");
        writeBenchmarkSignals(latestFailure);
        const recommendation = resolvePlanStatusRecommendation({
          mode: "normal",
          status: latestApplied.status,
          latestVerificationStatus,
          interactiveMenuFirst: process.stdin.isTTY,
        });
        writePlanRecommendationLines(recommendation);
      } else {
        input.writeStdout("active_plan_id: <none>\n");
        input.writeStdout("latest_failure_event: <none>\n");
        input.writeStdout("latest_verification_event: <none>\n");
        input.writeStdout("plan_quality_score: <none>\n");
        writeBenchmarkSignals();
        const recommendation = resolvePlanStatusRecommendation({
          mode: "normal",
          interactiveMenuFirst: process.stdin.isTTY,
        });
        writePlanRecommendationLines(recommendation);
      }
    }
    input.writeStdout("\n");
    return 0;
  };

  const benchmarkPlan = async (
    candidatesRaw: Array<{ label: string; path: string }>,
    options?: {
      preset?: string;
      assertBest?: string;
      checkOnly?: boolean;
    },
  ): Promise<number> => {
    const sessionId = planSessionKey();
    const checkOnly = options?.checkOnly === true;
    const benchmarkCandidates: Array<{
      label: string;
      content: string;
      sourcePath?: string;
    }> = [];
    const seenLabels = new Set<string>();
    const pushCandidate = (
      labelRaw: string,
      content: string,
      sourcePath?: string,
    ): { ok: true } | { ok: false; reason: string } => {
      const label = labelRaw.trim();
      if (!label) {
        return {
          ok: false,
          reason: "benchmark 候选标签不能为空",
        };
      }
      const labelKey = label.toLowerCase();
      if (seenLabels.has(labelKey)) {
        return {
          ok: false,
          reason: `benchmark 候选标签重复: ${label}`,
        };
      }
      seenLabels.add(labelKey);
      benchmarkCandidates.push({
        label,
        content,
        sourcePath,
      });
      return { ok: true };
    };

    const active = resolveActivePlan();
    if (active) {
      const pushed = pushCandidate("active", active.content, active.planPath);
      if (!pushed.ok) {
        input.writeStderr(`[plan-benchmark] ${pushed.reason}\n\n`);
        return 1;
      }
    }

    const preset = options?.preset?.trim();
    let presetMissingLabels: string[] = [];
    let presetPolicySource: string | undefined;
    let presetPolicyPath: string | undefined;
    let presetPolicyWarning: string | undefined;
    if (preset) {
      const presetResolved = resolvePlanQualityBenchmarkPreset({
        workDir: input.workDir,
        presetRaw: preset,
      });
      if (!presetResolved) {
        input.writeStderr(
          `[plan-benchmark] 未知 preset: ${preset}（支持: generic, core）。可尝试 preset=core 并设置 assert-best=active\n\n`,
        );
        return 1;
      }
      presetMissingLabels = [...presetResolved.missingLabels];
      presetPolicySource = presetResolved.policySource;
      presetPolicyPath = presetResolved.policyPath;
      presetPolicyWarning = presetResolved.policyWarning;
      for (const item of presetResolved.candidates) {
        let content = "";
        try {
          content = readFileSync(item.path, "utf8");
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          input.writeStderr(`[plan-benchmark] 读取 preset 候选失败 label=${item.label} path=${item.path}: ${detail}\n\n`);
          return 1;
        }
        const pushed = pushCandidate(item.label, content, item.path);
        if (!pushed.ok) {
          input.writeStderr(`[plan-benchmark] ${pushed.reason}\n\n`);
          return 1;
        }
      }
      if (presetPolicyWarning) {
        input.writeStderr(`[plan-benchmark] preset policy 警告: ${presetPolicyWarning}\n`);
      }
      if (presetMissingLabels.length > 0) {
        input.writeStdout(`[plan-benchmark] preset=${presetResolved.preset} missing=${presetMissingLabels.join(",")}\n`);
        input.writeStdout(
          "[plan-benchmark] 提示: 设置 GROBOT_PLAN_BENCHMARK_*_PATH 或 GROBOT_PLAN_BENCHMARK_PRESET_POLICY_PATH 来提供缺失基线\n",
        );
      }
      if (checkOnly && presetMissingLabels.length > 0) {
        input.writeStderr(
          `[plan-benchmark] code=${PLAN_BENCHMARK_CHECK_FAILED_CODE} preset_missing=${presetMissingLabels.join(",")}\n\n`,
        );
        return 2;
      }
    }

    for (const item of candidatesRaw) {
      const resolvedPath = resolveBenchmarkPath(input.workDir, item.path);
      let content = "";
      try {
        content = readFileSync(resolvedPath, "utf8");
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        input.writeStderr(`[plan-benchmark] 读取候选失败 label=${item.label} path=${resolvedPath}: ${detail}\n\n`);
        return 1;
      }
      const pushed = pushCandidate(item.label, content, resolvedPath);
      if (!pushed.ok) {
        input.writeStderr(`[plan-benchmark] ${pushed.reason}\n\n`);
        return 1;
      }
    }

    if (benchmarkCandidates.length === 0) {
      if (preset) {
        if (checkOnly) {
          input.writeStderr(
            `[plan-benchmark] code=${PLAN_BENCHMARK_CHECK_FAILED_CODE} no_readable_candidates_after_preset_resolution\n\n`,
          );
          return 2;
        }
        input.writeStderr(
          "[plan-benchmark] preset 解析后没有可比较候选。请检查 preset 路径，或手动提供 label=path。\n\n",
        );
        return 1;
      }
      if (checkOnly) {
        input.writeStderr(
          `[plan-benchmark] code=${PLAN_BENCHMARK_CHECK_FAILED_CODE} no_candidates_to_validate\n\n`,
        );
        return 2;
      }
      input.writeStderr("[plan-benchmark] 没有可比较候选。请用 <label=path> 提供候选，或先创建一个活动计划。\n\n");
      return 1;
    }

    const qualityGuardRuntime = resolveQualityGuardRuntime();
    if (checkOnly) {
      const labels = benchmarkCandidates.map((item) => item.label);
      const benchmarkHistory = loadPlanQualityBenchmarkHistory(input.workDir, sessionId, {
        limit: 3,
      });
      const latestPlanEntry = resolveLatestPlanEntry([
        "applied",
        "apply_failed",
        "discarded",
      ]);
      const latestFailure = latestPlanEntry
        ? loadLatestPlanFailureDiagnostic(input.workDir, sessionId, {
          planId: latestPlanEntry.plan_id,
        })
        : undefined;
      const benchmarkSemantic = evaluatePlanQualityBenchmarkSemanticCorrelation({
        latestFailure,
        history: benchmarkHistory,
      });
      const benchmarkHealth = evaluatePlanQualityBenchmarkHealth({
        history: benchmarkHistory,
        semanticCorrelation: benchmarkSemantic.level,
      });
      const benchmarkRecommendation = resolvePlanQualityBenchmarkRecommendation({
        history: benchmarkHistory,
        semanticCorrelation: benchmarkSemantic.level,
        health: benchmarkHealth,
      });
      const renderCompactOutput = shouldRenderCompactPlanBenchmark();
      input.writeStdout("[plan-benchmark-check]\n");
      input.writeStdout(
        `plan_quality_benchmark_check_output_mode: ${renderCompactOutput ? "compact" : "full"}\n`,
      );
      input.writeStdout("plan_quality_benchmark_check_only: yes\n");
      input.writeStdout(`plan_quality_benchmark_check_candidate_count: ${String(labels.length)}\n`);
      input.writeStdout(`plan_quality_benchmark_check_labels: ${labels.join(",")}\n`);
      if (preset) {
        input.writeStdout(`plan_quality_benchmark_preset: ${preset}\n`);
      }
      input.writeStdout(`plan_quality_benchmark_guard_mode: ${qualityGuardRuntime.guardMode}\n`);
      input.writeStdout(`plan_quality_benchmark_guard_profile: ${qualityGuardRuntime.policy.profile}\n`);
      input.writeStdout(`plan_quality_benchmark_guard_source: ${qualityGuardRuntime.source}\n`);
      if (qualityGuardRuntime.policyPath) {
        input.writeStdout(`plan_quality_benchmark_guard_policy_path: ${qualityGuardRuntime.policyPath}\n`);
      }
      if (qualityGuardRuntime.warning) {
        input.writeStdout(`plan_quality_benchmark_guard_policy_warning: ${qualityGuardRuntime.warning}\n`);
      }
      input.writeStdout(
        `plan_quality_benchmark_check_semantic_correlation: ${benchmarkSemantic.level}\n`,
      );
      input.writeStdout(
        `plan_quality_benchmark_check_health_level: ${benchmarkHealth.level}\n`,
      );
      input.writeStdout(
        `plan_quality_benchmark_check_recommended_next_action: ${benchmarkRecommendation.action}\n`,
      );
      if (renderCompactOutput) {
        input.writeStdout(
          "plan_quality_benchmark_check_detail_hint: 设置 GROBOT_PLAN_BENCHMARK_VERBOSE=1 并重新运行此 benchmark check 可查看完整诊断。\n",
        );
      } else {
        input.writeStdout(
          `plan_quality_benchmark_check_semantic_reason: ${benchmarkSemantic.reason}\n`,
        );
        input.writeStdout(
          `plan_quality_benchmark_check_health_score: ${String(benchmarkHealth.score)}\n`,
        );
        input.writeStdout(
          `plan_quality_benchmark_check_health_reason: ${benchmarkHealth.reason}\n`,
        );
        input.writeStdout(
          `plan_quality_benchmark_check_recommendation_reason: ${benchmarkRecommendation.reason}\n`,
        );
      }
      input.writeStdout("plan_quality_benchmark_check_status: ok\n\n");
      return 0;
    }

    let benchmark: ReturnType<typeof evaluatePlanQualityBenchmark>;
    try {
      benchmark = evaluatePlanQualityBenchmark({
        workDir: input.workDir,
        sessionId,
        candidates: benchmarkCandidates,
        policy: qualityGuardRuntime.policy,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      input.writeStderr(`[plan-benchmark] 评估失败: ${detail}\n\n`);
      return 1;
    }

    const runnerUp = benchmark.rows[1];
    const winnerLeadScore = typeof runnerUp?.score === "number"
      ? benchmark.winner.score - runnerUp.score
      : undefined;
    const rowsPayload = benchmark.rows.map((row) => ({
      rank: row.rank,
      label: row.label,
      path: row.sourcePath ?? "",
      score: row.score,
      grade: row.grade,
      finding_count: row.findingCount,
      blocked: row.blocked,
      guard_level: row.guardLevel,
      guard_reason: row.guardReason,
      repair_action_count: row.repairActionCount,
      top_hint: row.topHint,
      top_repair_action: row.topRepairAction,
    }));
    const renderCompactOutput = shouldRenderCompactPlanBenchmark();
    input.writeStdout("[plan-benchmark]\n");
    input.writeStdout(`plan_quality_benchmark_output_mode: ${renderCompactOutput ? "compact" : "full"}\n`);
    input.writeStdout(`plan_quality_benchmark_compared: ${String(benchmark.rows.length)}\n`);
    input.writeStdout(`plan_quality_benchmark_guard_mode: ${qualityGuardRuntime.guardMode}\n`);
    input.writeStdout(`plan_quality_benchmark_guard_profile: ${qualityGuardRuntime.policy.profile}\n`);
    input.writeStdout(`plan_quality_benchmark_guard_source: ${qualityGuardRuntime.source}\n`);
    if (preset) {
      input.writeStdout(`plan_quality_benchmark_preset: ${preset}\n`);
      if (presetMissingLabels.length > 0) {
        input.writeStdout(`plan_quality_benchmark_preset_missing: ${presetMissingLabels.join(",")}\n`);
      }
      if (presetPolicySource) {
        input.writeStdout(`plan_quality_benchmark_preset_policy_source: ${presetPolicySource}\n`);
      }
      if (presetPolicyPath) {
        input.writeStdout(`plan_quality_benchmark_preset_policy_path: ${presetPolicyPath}\n`);
      }
      if (presetPolicyWarning) {
        input.writeStdout(`plan_quality_benchmark_preset_policy_warning: ${presetPolicyWarning}\n`);
      }
    }
    if (qualityGuardRuntime.policyPath) {
      input.writeStdout(`plan_quality_benchmark_guard_policy_path: ${qualityGuardRuntime.policyPath}\n`);
    }
    if (qualityGuardRuntime.warning) {
      input.writeStdout(`plan_quality_benchmark_guard_policy_warning: ${qualityGuardRuntime.warning}\n`);
    }
    input.writeStdout(`plan_quality_benchmark_winner: ${benchmark.winner.label}\n`);
    input.writeStdout(`plan_quality_benchmark_winner_score: ${String(benchmark.winner.score)}\n`);
    input.writeStdout(`plan_quality_benchmark_winner_grade: ${benchmark.winner.grade}\n`);
    input.writeStdout(`plan_quality_benchmark_winner_top_hint: ${benchmark.winner.topHint}\n`);
    input.writeStdout(`plan_quality_benchmark_winner_top_repair_action: ${benchmark.winner.topRepairAction}\n`);
    if (runnerUp) {
      input.writeStdout(`plan_quality_benchmark_runner_up_label: ${runnerUp.label}\n`);
      input.writeStdout(`plan_quality_benchmark_runner_up_score: ${String(runnerUp.score)}\n`);
    }
    if (typeof winnerLeadScore === "number") {
      input.writeStdout(`plan_quality_benchmark_winner_lead_score: ${String(winnerLeadScore)}\n`);
    }
    if (renderCompactOutput) {
      input.writeStdout(`plan_quality_benchmark_rows_count: ${String(rowsPayload.length)}\n`);
      input.writeStdout(
        "plan_quality_benchmark_detail_hint: 设置 GROBOT_PLAN_BENCHMARK_VERBOSE=1 并重新运行 benchmark 可查看完整行数据。\n",
      );
    } else {
      input.writeStdout(`plan_quality_benchmark_rows: ${JSON.stringify(rowsPayload)}\n`);
    }

    const expectedBest = options?.assertBest?.trim();
    const assertMatched = expectedBest ? benchmark.winner.label === expectedBest : undefined;
    try {
      appendPlanEvent(input.workDir, sessionId, {
        event: "plan_benchmark_run",
        plan_id: active?.entry.plan_id,
        source: "cli",
        detail: buildPlanQualityBenchmarkEventDetail({
          comparedCount: benchmark.rows.length,
          winnerLabel: benchmark.winner.label,
          winnerScore: benchmark.winner.score,
          winnerGrade: benchmark.winner.grade,
          winnerTopHint: benchmark.winner.topHint,
          winnerTopRepairAction: benchmark.winner.topRepairAction,
          runnerUpLabel: runnerUp?.label,
          runnerUpScore: runnerUp?.score,
          winnerLeadScore,
          preset,
          guardMode: qualityGuardRuntime.guardMode,
          guardPolicyProfile: qualityGuardRuntime.policy.profile,
          assertBest: expectedBest,
          assertPassed: assertMatched,
          assertActual: expectedBest ? benchmark.winner.label : undefined,
        }),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      input.writeStderr(`[plan-benchmark] 警告: benchmark 事件持久化失败: ${detail}\n`);
    }
    if (expectedBest && benchmark.winner.label !== expectedBest) {
      input.writeStderr(
        `[plan-benchmark] code=${PLAN_BENCHMARK_ASSERT_BEST_FAILED_CODE} expected=${expectedBest} actual=${benchmark.winner.label}\n\n`,
      );
      return 2;
    }
    input.writeStdout("\n");
    return 0;
  };

  const reviewActivePlanDecisionState = async (
    active: NonNullable<ReturnType<typeof resolveActivePlan>>,
  ): Promise<{
    reviewedEntry: PlanArtifactEntry;
    review: ReturnType<typeof reviewPlanContent>;
    recommendation: ReturnType<typeof resolvePlanStatusRecommendation>;
    repairActions: ReturnType<typeof buildPlanQualityRepairActions>;
  } | undefined> => {
    const review = reviewPlanContent(active.content);
    const reviewedEntry = recordPlanReviewResult(
      input.workDir,
      planSessionKey(),
      active.entry.plan_id,
      review,
      "cli",
    );
    if (!reviewedEntry) {
      return undefined;
    }
    await persistPlanState(
      "plan_only",
      buildPlanMeta(reviewedEntry, active.planPath),
    );
    const quality = evaluatePlanQuality(active.content);
    const qualityTrend = evaluatePlanQualityTrend({
      workDir: input.workDir,
      sessionId: planSessionKey(),
      currentPlanId: reviewedEntry.plan_id,
      currentScore: quality.score,
    });
    const qualityGuardRuntime = resolveQualityGuardRuntime();
    const qualityGuard = evaluatePlanQualityGuard({
      workDir: input.workDir,
      sessionId: planSessionKey(),
      currentPlanId: reviewedEntry.plan_id,
      quality,
      trend: qualityTrend,
      policy: qualityGuardRuntime.policy,
    });
    const repairActions = buildPlanQualityRepairActions({
      planContent: active.content,
      quality,
      trend: qualityTrend,
      guard: qualityGuard,
    });
    const recommendation = resolvePlanStatusRecommendation({
      mode: "plan_only",
      status: reviewedEntry.status,
      planQualityScore: quality.score,
      planQualityTopHint: repairActions[0]?.title ?? quality.rewriteHints[0],
      planQualityGuardLevel: qualityGuard.level,
      planQualityGuardReason: qualityGuard.reason,
      interactiveMenuFirst: true,
    });
    return {
      reviewedEntry,
      review,
      recommendation,
      repairActions,
    };
  };

  const runPlanTurn = async (
    noteRaw: string,
    options?: RunStartPlanTurnOptions,
  ): Promise<number> => {
    const writeStdout = options?.writeStdout ?? input.writeStdout;
    const note = noteRaw.trim();
    if (!note) {
      return 0;
    }
    const stablePoint = capturePlanStablePoint();
    activeTurnPhase = "planning";
    try {
      if (await consumePendingInterrupt(stablePoint, "before_plan_turn")) {
        return 0;
      }
      let meta = input.runtimeState.getPlanMeta();
      if (!meta?.active_plan_id) {
        if (await consumePendingInterrupt(stablePoint, "before_plan_create")) {
          return 0;
        }
        const entered = await createPlanModeDraft(note, {
          printHint: false,
          printModeReadyOnly: false,
          writeStdout,
        });
        if (entered !== 0) {
          return entered;
        }
        meta = input.runtimeState.getPlanMeta();
        if (!meta?.active_plan_id) {
          input.writeStderr("[plan] 进入 plan mode 后未找到活动计划。\n");
          return 1;
        }
      }
      if (await consumePendingInterrupt(stablePoint, "before_plan_progress_append")) {
        return 0;
      }
      const appended = appendPlanProgressNote(
        input.workDir,
        planSessionKey(),
        meta.active_plan_id,
        note,
      );
      if (!appended.updated) {
        input.writeStderr("[plan] 更新活动计划进度失败。\n");
        return 1;
      }
      writePlanActivityDiagnostic(options, "progress_saved");
      if (await consumePendingInterrupt(stablePoint, "after_plan_progress_append")) {
        return 0;
      }
      const active = resolveActivePlan();
      if (active) {
        await persistPlanState(
          "plan_only",
          buildPlanMeta(active.entry, active.planPath),
        );
      }
      if (await consumePendingInterrupt(stablePoint, "after_plan_state_persist")) {
        return 0;
      }
      if (options?.skipExecution) {
        appendPlanEvent(input.workDir, planSessionKey(), {
          event: "plan_turn_skipped",
          plan_id: meta.active_plan_id,
          source: "cli",
          detail: "message_mode_execution_skipped",
        });
        writeStdout("计划备注已保存。\n\n");
        return 0;
      }
      const historyLengthBeforeExecution = input.runtimeState.getHistoryMessages().length;
      const compactFailureSurface = shouldRenderCompactPlanFailureSurface(
        options?.diagnosticsMode,
      );
      const planTurnStderr = createPlanTurnDiagnosticStderr({
        writeStderr: options?.writeStderr ?? input.writeStderr,
        compactFailureSurface,
      });
      if (options?.showWorkingNotice) {
        writeStdout(`${terminalStyle.planMode("●")} 正在规划...\n`);
      }
      writePlanActivityDiagnostic(options, "model_planning", "phase=planning");
      let code: number;
      const activeForPrompt = resolveActivePlan();
      try {
        code = await input.executeTurn(note, true, {
          promptPrelude: buildPlanModeWorkflowPrompt({
            planFilePath: activeForPrompt?.planPath
              ? formatHumanPlanFilePath({
                workDir: input.workDir,
                planPath: activeForPrompt.planPath,
              })
              : undefined,
          }),
          writeStdout,
          writeStderr: planTurnStderr.writeStderr,
        });
      } finally {
        planTurnStderr.flush();
      }
      if (code === TURN_INTERRUPTED_EXIT_CODE) {
        appendPlanEvent(input.workDir, planSessionKey(), {
          event: "plan_turn_interrupted",
          plan_id: meta.active_plan_id,
          source: "cli",
          detail: `exit_code=${String(code)}`,
        });
        return code;
      }
      if (code !== 0) {
        const failureDecision = resolvePlanFailureDecision({
          phase: "planning",
          exitCode: code,
          providerStates: input.runtimeState.getProviderRuntimeStates(),
        });
        if (failureDecision.action === "degrade") {
          const detailParts = [
            `exit_code=${String(code)}`,
            "policy_action=degrade",
            `policy_reason=${failureDecision.reason}`,
            `diagnostic_code=${failureDecision.diagnosticCode}`,
          ];
          if (failureDecision.providerName) {
            detailParts.push(`provider=${failureDecision.providerName}`);
          }
          if (failureDecision.errorClass) {
            detailParts.push(`class=${failureDecision.errorClass}`);
          }
          appendPlanEvent(input.workDir, planSessionKey(), {
            event: "plan_turn_degraded",
            plan_id: meta.active_plan_id,
            source: "cli",
            detail: `${detailParts.join(" ")} degraded=true`,
          });
          const hint = failureDecision.hint ?? "请检查 semantic index 和检索配置。";
          writeStdout(`计划上下文已降级 · 草稿已保留。${hint}\n\n`);
          return 0;
        }
        const detailParts = [
          `exit_code=${String(code)}`,
          "policy_action=fail",
          `policy_reason=${failureDecision.reason}`,
          `diagnostic_code=${failureDecision.diagnosticCode}`,
        ];
        if (failureDecision.providerName) {
          detailParts.push(`provider=${failureDecision.providerName}`);
        }
        if (failureDecision.errorClass) {
          detailParts.push(`class=${failureDecision.errorClass}`);
        }
        appendPlanEvent(input.workDir, planSessionKey(), {
          event: "plan_turn_failed",
          plan_id: meta.active_plan_id,
          source: "cli",
          detail: detailParts.join(" "),
        });
        input.markFailureObserved();
        writePlanFailureSurface({
          phase: "planning",
          planId: meta.active_plan_id,
          workDir: input.workDir,
          planPath: meta.active_plan_path,
          exitCode: code,
          compactFailureSurface,
          failureDecision,
          writeStderr: input.writeStderr,
        });
        return code;
      }
      writePlanActivityDiagnostic(options, "model_returned");
      const assistantProposedPlan = extractLatestAssistantProposedPlan(
        input.runtimeState.getHistoryMessages(),
        historyLengthBeforeExecution,
      );
      if (assistantProposedPlan && meta.active_plan_id) {
        const replaced = replacePlanArtifactContent(
          input.workDir,
          planSessionKey(),
          meta.active_plan_id,
          assistantProposedPlan.content,
          {
            source: "system",
            detail:
              `ingested <proposed_plan> from assistant history_index=${String(assistantProposedPlan.historyIndex)}`,
          },
        );
        if (replaced.updated && replaced.planPath) {
          if (replaced.replaced) {
            const refreshedActive = resolveActivePlan();
            if (refreshedActive) {
              await persistPlanState(
                "plan_only",
                buildPlanMeta(refreshedActive.entry, refreshedActive.planPath),
              );
            }
            appendPlanEvent(input.workDir, planSessionKey(), {
              event: "plan_proposed_plan_ingested",
              plan_id: meta.active_plan_id,
              source: "system",
              detail:
                `history_index=${String(assistantProposedPlan.historyIndex)} chars=${String(assistantProposedPlan.content.length)}`,
            });
            writePlanActivityDiagnostic(options, "proposed_plan_ingested");
          }
        }
      }
      const reviewedActive = resolveActivePlan();
      if (!reviewedActive) {
        input.writeStderr(
          buildPlanApplyStateSurface({
            kind: "internal_failure",
            workDir: input.workDir,
            planPath: meta.active_plan_path,
            detail: "计划更新后活动计划消失，无法继续评审。",
            diagnostic: "PLAN_REVIEW_ACTIVE_PLAN_MISSING",
          }),
        );
        return 1;
      }
      writePlanActivityDiagnostic(options, "review_started");
      const decisionState = await reviewActivePlanDecisionState(reviewedActive);
      if (!decisionState) {
        input.writeStderr(
          buildPlanApplyStateSurface({
            kind: "internal_failure",
            workDir: input.workDir,
            planPath: meta.active_plan_path,
            detail: "未找到计划记录，无法完成评审。",
            diagnostic: "PLAN_REVIEW_ENTRY_MISSING",
          }),
        );
        return 1;
      }
      const planPhase = derivePlanPhaseFromStatus(decisionState.reviewedEntry.status) ?? "drafting";
      if (!decisionState.review.ok) {
        writePlanActivityDiagnostic(options, "review_needs_refinement");
        const topRepairAction = decisionState.repairActions[0];
        writeStdout(
          buildPlanNeedsRefinementSurface(
            topRepairAction?.title ?? decisionState.recommendation.reason,
          ),
        );
        return 0;
      }
      if (decisionState.reviewedEntry.status === "ready") {
        const readyApprovalRequest = {
          workDir: input.workDir,
          planPath: reviewedActive.planPath,
          planContent: reviewedActive.content,
        };
        writePlanActivityDiagnostic(options, "approval_waiting");
        const approvalDecision = normalizePlanReadyApprovalDecision(
          await options?.requestReadyPlanApproval?.(readyApprovalRequest),
        );
        if (approvalDecision.action === "approve") {
          const feedback = approvalDecision.feedback?.trim();
          return applyPlan(
            feedback && feedback.length > 0 ? feedback : PLAN_EXECUTION_REPLY,
            options,
          );
        }
        if (approvalDecision.action === "exit_plan_mode") {
          await persistPlanState("normal", undefined);
          if (approvalDecision.silent !== true) {
            writeStdout(buildExitedPlanModeSurface());
          }
          return code;
        }
        if (approvalDecision.action === "keep_planning") {
          const feedback = approvalDecision.feedback?.trim();
          if (feedback) {
            writeStdout("已添加计划反馈，继续保持 plan mode...\n\n");
            return runPlanTurn(feedback, options);
          }
          if (approvalDecision.silent !== true) {
            writeStdout(buildPlanKeptInPlanningSurface());
          }
          return code;
        }
        writeStdout(buildReadyToCodeSurface(readyApprovalRequest));
      } else {
        writePlanActivityDiagnostic(options, "plan_updated");
        writeStdout(buildPlanUpdatedSurface({
          phase: humanizePlanPhase(planPhase),
          nextAction: decisionState.recommendation.action,
        }));
      }
      return code;
    } finally {
      if (pendingInterruptSource) {
        clearPendingInterruptAsIgnored(
          "plan_turn_finalize",
          "turn_completed_without_safe_cancel_point",
        );
      }
      activeTurnPhase = "idle";
    }
  };

  const cancelPlan = async (): Promise<number> => {
    const active = resolveActivePlan();
    if (!active) {
      input.writeStdout(buildPlanCancelSurface({ kind: "empty" }));
      await persistPlanState("normal", undefined);
      return 0;
    }
    const discarded = updatePlanArtifactStatus(
      input.workDir,
      planSessionKey(),
      active.entry.plan_id,
      "discarded",
    );
    if (!discarded) {
      input.writeStderr(
        buildPlanCancelSurface({
          kind: "failed",
          workDir: input.workDir,
          planPath: active.planPath,
          detail: "未找到计划记录，无法更新为已取消。",
        }),
      );
      return 1;
    }
    await persistPlanState("normal", undefined);
    appendPlanEvent(input.workDir, planSessionKey(), {
      event: "plan_mode_cancelled",
      plan_id: active.entry.plan_id,
      source: "cli",
      detail: "cancel command moved plan to discarded",
    });
    input.writeStdout(buildPlanCancelSurface({
      kind: "cancelled",
      workDir: input.workDir,
      planPath: active.planPath,
    }));
    return 0;
  };

  const applyPlan = async (
    extraRaw: string,
    options?: RunStartPlanTurnOptions,
  ): Promise<number> => {
    const writeStdout = options?.writeStdout ?? input.writeStdout;
    writePlanActivityDiagnostic(options, "apply_review_started");
    const previousPhase = activeTurnPhase;
    activeTurnPhase = "applying";
    const stablePoint = capturePlanStablePoint();
    try {
      if (await consumePendingInterrupt(stablePoint, "before_apply_start")) {
        return 0;
      }
      const recovered = recoverStaleApprovedPlan(input.workDir, planSessionKey(), {
        source: "cli",
      });
      const active = resolveActivePlan();
      if (!active) {
        input.writeStderr(
          buildPlanApplyStateSurface({
            kind: "no_active",
            diagnostic: "PLAN_APPLY_NO_ACTIVE_PLAN",
          }),
        );
        return 1;
      }
      if (recovered.recovered) {
        writeStdout(
          buildPlanApplyStateSurface({
            kind: "lock_recovered",
            workDir: input.workDir,
            planPath: active.planPath,
            staleMs: recovered.stale_ms,
          }),
        );
      }
      if (active.entry.status === "applying") {
        writeStdout(
          buildPlanApplyStateSurface({
            kind: "already_applying",
            workDir: input.workDir,
            planPath: active.planPath,
          }),
        );
        return 0;
      }
      if (active.entry.status === "applied" || active.entry.status === "discarded") {
        input.writeStderr(
          buildPlanApplyStateSurface({
            kind: "invalid_status",
            workDir: input.workDir,
            planPath: active.planPath,
            statusLabel: humanizePlanStatus(active.entry.status),
            diagnostic: "PLAN_APPLY_INVALID_STATUS",
          }),
        );
        return 1;
      }
      const quality = evaluatePlanQuality(active.content);
      const qualityTrend = evaluatePlanQualityTrend({
        workDir: input.workDir,
        sessionId: planSessionKey(),
        currentPlanId: active.entry.plan_id,
        currentScore: quality.score,
      });
      const qualityGuardRuntime = resolveQualityGuardRuntime();
      const qualityGuard = evaluatePlanQualityGuard({
        workDir: input.workDir,
        sessionId: planSessionKey(),
        currentPlanId: active.entry.plan_id,
        quality,
        trend: qualityTrend,
        policy: qualityGuardRuntime.policy,
      });
      const qualityGuardMode = qualityGuardRuntime.guardMode;
      const compactFailureSurface = shouldRenderCompactPlanFailureSurface(
        options?.diagnosticsMode,
      );
      if (qualityGuardMode === "strict" && qualityGuard.level === "critical") {
        appendPlanEvent(input.workDir, planSessionKey(), {
          event: "plan_apply_blocked",
          plan_id: active.entry.plan_id,
          source: "cli",
          detail: [
            "reason=quality_guard_critical",
            `guard_mode=${qualityGuardMode}`,
            `guard_profile=${qualityGuardRuntime.policy.profile}`,
            `guard_source=${qualityGuardRuntime.source}`,
            `guard_level=${qualityGuard.level}`,
            `guard_reason=${qualityGuard.reason.replace(/\s+/g, "_")}`,
          ].join(" "),
        });
        writePlanQualityGuardBlockedSurface({
          qualityGuardMode,
          guardLevel: qualityGuard.level,
          guardReason: qualityGuard.reason,
          compactFailureSurface,
          writeStderr: input.writeStderr,
        });
        return 2;
      }
      let approvedEntry = active.entry;
      let approvedHash = active.entry.approved_hash;
      let approvalTicketId = active.entry.approval_ticket_id;
      let approvedSnapshotPath = active.entry.approved_snapshot_path;

      const shouldReviewAndApprove = active.entry.status !== "approved"
        || !approvedHash
        || !approvalTicketId;
      if (shouldReviewAndApprove) {
        const review = reviewPlanContent(active.content);
        const reviewedEntry = recordPlanReviewResult(
          input.workDir,
          planSessionKey(),
          active.entry.plan_id,
          review,
          "cli",
        );
        if (!reviewedEntry) {
          input.writeStderr(
            buildPlanApplyStateSurface({
              kind: "internal_failure",
              workDir: input.workDir,
              planPath: active.planPath,
              detail: "计划评审记录更新失败。",
              diagnostic: "PLAN_REVIEW_ENTRY_MISSING",
            }),
          );
          return 1;
        }
        await persistPlanState(
          "plan_only",
          buildPlanMeta(reviewedEntry, active.planPath),
        );
        if (!review.ok) {
          const reviewCode = review.blocked
            ? PLAN_REVIEW_BLOCKED_CODE
            : PLAN_REVIEW_FAILED_CODE;
          writePlanReviewFailureSurface({
            reviewCode,
            planId: active.entry.plan_id,
            compactFailureSurface,
            review,
            writeStderr: input.writeStderr,
          });
          return 2;
        }

        const approval = approvePlanArtifact(
          input.workDir,
          planSessionKey(),
          active.entry.plan_id,
          {
            approvedBy: "cli",
            source: "cli",
          },
        );
        if (!approval.approved || !approval.entry || !approval.planHash || !approval.ticketId) {
          input.writeStderr(
            buildPlanApplyStateSurface({
              kind: "internal_failure",
              workDir: input.workDir,
              planPath: active.planPath,
              detail: "计划确认元数据写入失败。",
              diagnostic: "PLAN_APPROVAL_FAILED",
            }),
          );
          return 1;
        }

        approvedEntry = approval.entry;
        approvedHash = approval.planHash;
        approvalTicketId = approval.ticketId;
        approvedSnapshotPath = approval.snapshotPath;
        await persistPlanState(
          "plan_only",
          buildPlanMeta(approval.entry, active.planPath),
        );
      } else {
        await persistPlanState(
          "plan_only",
          buildPlanMeta(active.entry, active.planPath),
        );
      }

      const applying = updatePlanArtifactStatus(
        input.workDir,
        planSessionKey(),
        active.entry.plan_id,
        "applying",
      );
      if (!applying) {
        input.writeStderr(
          buildPlanApplyStateSurface({
            kind: "internal_failure",
            workDir: input.workDir,
            planPath: active.planPath,
            detail: "无法把计划状态切换为执行中。",
            diagnostic: "PLAN_APPLY_STATUS_UPDATE_FAILED",
          }),
        );
        return 1;
      }
      await persistPlanState(
        "plan_only",
        buildPlanMeta(applying, active.planPath),
      );
      if (!approvedHash || !approvalTicketId) {
        input.writeStderr(
          buildPlanApplyStateSurface({
            kind: "internal_failure",
            workDir: input.workDir,
            planPath: active.planPath,
            detail: "缺少确认票据或计划快照，无法执行。",
            diagnostic: "PLAN_APPLY_APPROVAL_METADATA_MISSING",
          }),
        );
        return 1;
      }

      const approvedPlanContent = parseApprovedContent(
        approvedSnapshotPath,
        active.content,
      );
      writeStdout(
        buildApprovedPlanExecutionSurface({
          workDir: input.workDir,
          planPath: active.planPath,
          title: approvedEntry.title,
          approvedHash,
          ticketId: approvalTicketId,
          approvedPlanContent,
        }),
      );
      const extraInstruction = isNaturalPlanExecutionIntent(extraRaw) ? "" : extraRaw.trim();
      const prompt = buildPlanApplyPrompt({
        approvedPlanContent,
        approvedHash,
        ticketId: approvalTicketId,
        extra: extraInstruction,
      });
      const applyStderr = createPlanTurnDiagnosticStderr({
        writeStderr: options?.writeStderr ?? input.writeStderr,
        compactFailureSurface,
      });
      writePlanActivityDiagnostic(options, "apply_model_running");
      let code: number;
      try {
        code = await input.executeTurn(prompt, true, {
          writeStdout,
          writeStderr: applyStderr.writeStderr,
        });
      } finally {
        applyStderr.flush();
      }
      if (code === TURN_INTERRUPTED_EXIT_CODE) {
        const approvedAgain = updatePlanArtifactStatus(
          input.workDir,
          planSessionKey(),
          active.entry.plan_id,
          "approved",
        );
        await persistPlanState(
          "plan_only",
          buildPlanMeta(approvedAgain ?? approvedEntry, active.planPath),
        );
        appendPlanEvent(input.workDir, planSessionKey(), {
          event: "plan_apply_interrupted",
          plan_id: active.entry.plan_id,
          source: "cli",
          detail: `exit_code=${String(code)}`,
        });
        return code;
      }
      if (code !== 0) {
        const failureDecision = resolvePlanFailureDecision({
          phase: "applying",
          exitCode: code,
          providerStates: input.runtimeState.getProviderRuntimeStates(),
        });
        const applyFailed = updatePlanArtifactStatus(
          input.workDir,
          planSessionKey(),
          active.entry.plan_id,
          "apply_failed",
        );
        await persistPlanState(
          "plan_only",
          buildPlanMeta(applyFailed ?? applying, active.planPath),
        );
        appendPlanEvent(input.workDir, planSessionKey(), {
          event: "plan_apply_failed",
          plan_id: active.entry.plan_id,
          source: "cli",
          detail: [
            `exit_code=${String(code)}`,
            "policy_action=fail",
            `policy_reason=${failureDecision.reason}`,
            `diagnostic_code=${failureDecision.diagnosticCode}`,
            failureDecision.providerName ? `provider=${failureDecision.providerName}` : "",
            failureDecision.errorClass ? `class=${failureDecision.errorClass}` : "",
          ]
            .filter((item) => item.length > 0)
            .join(" "),
        });
        input.markFailureObserved();
        writePlanFailureSurface({
          phase: "applying",
          planId: active.entry.plan_id,
          workDir: input.workDir,
          planPath: active.planPath,
          exitCode: code,
          compactFailureSurface,
          failureDecision,
          writeStderr: input.writeStderr,
        });
        return code;
      }

      writePlanActivityDiagnostic(options, "apply_finished");
      const applied = updatePlanArtifactStatus(
        input.workDir,
        planSessionKey(),
        active.entry.plan_id,
        "applied",
      );
      await persistPlanState("normal", undefined);
      appendPlanEvent(input.workDir, planSessionKey(), {
        event: "plan_apply_succeeded",
        plan_id: active.entry.plan_id,
        source: "cli",
        detail: "plan applied and exited plan_only",
      });
      appendPlanEvent(input.workDir, planSessionKey(), {
        event: "plan_verification_pending",
        plan_id: active.entry.plan_id,
        source: "cli",
        detail: "verification_status=pending",
      });
      return code;
    } finally {
      if (pendingInterruptSource) {
        clearPendingInterruptAsIgnored(
          "apply_finalize",
          "apply_phase_completed_or_failed",
        );
      }
      activeTurnPhase = previousPhase;
    }
  };

  const handleMessageInput = async (
    messageRaw: string,
    options?: {
      messageMode?: boolean;
    },
  ): Promise<PlanMessageHandleResult> => {
    const message = messageRaw.trim();
    if (!message) {
      return { handled: false, code: 0 };
    }
    if (message === "/interrupt") {
      await requestPlanInterrupt("command");
      return { handled: true, code: 0 };
    }
    if (isPlanSlashCommand(message)) {
      const parsed = parsePlanCommand(message);
      if (parsed.kind === "invalid") {
        input.writeStdout(`${parsed.reason}\n\n`);
        return { handled: true, code: 0 };
      }
      if (parsed.kind === "enter") {
        if (input.runtimeState.getPlanMode() === "plan_only") {
          return { handled: true, code: await showPlanStatus() };
        }
        if (options?.messageMode) {
          return {
            handled: true,
            code: await createPlanModeDraft(parsed.goal, {
              printHint: false,
              printModeReadyOnly: true,
            }),
          };
        }
        return { handled: true, code: await enterPlan(parsed.goal) };
      }
      if (parsed.kind === "enter_mode") {
        if (input.runtimeState.getPlanMode() === "plan_only") {
          return { handled: true, code: await showPlanStatus() };
        }
        if (options?.messageMode) {
          return {
            handled: true,
            code: await createPlanModeDraft("", {
              printHint: false,
              printModeReadyOnly: true,
            }),
          };
        }
        return { handled: true, code: await enterPlan("") };
      }
      if (parsed.kind === "open") {
        if (input.runtimeState.getPlanMode() !== "plan_only") {
          if (options?.messageMode) {
            return {
              handled: true,
              code: await createPlanModeDraft("", {
                printHint: false,
                printModeReadyOnly: true,
              }),
            };
          }
          return { handled: true, code: await enterPlan("") };
        }
        return { handled: true, code: await showPlanStatus() };
      }
      return { handled: true, code: 0 };
    }
    if (input.runtimeState.getPlanMode() === "plan_only") {
      if (isNaturalPlanExecutionIntent(message)) {
        return {
          handled: true,
          code: await applyPlan(message),
        };
      }
      return {
        handled: true,
        code: await runPlanTurn(message, {
          skipExecution: options?.messageMode,
        }),
      };
    }
    return { handled: false, code: 0 };
  };

  return {
    isPlanMode: (): boolean => input.runtimeState.getPlanMode() === "plan_only",
    getActivePlanPath: (): string | undefined => {
      const active = resolveActivePlan();
      if (active?.planPath) {
        return active.planPath;
      }
      const metaPath = input.runtimeState.getPlanMeta()?.active_plan_path;
      return typeof metaPath === "string" && metaPath.trim().length > 0
        ? metaPath
        : undefined;
    },
    enterPlan,
    showPlanStatus,
    runPlanTurn,
    applyPlan,
    cancelPlan,
    requestPlanInterrupt,
    handleMessageInput,
  };
}
