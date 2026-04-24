import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type PlanEventPhase = "drafting" | "awaiting_decision" | "applying" | "unknown";
type PlanPolicyAction = "fail" | "degrade";

interface ParsedCliArgs {
  eventsPaths: string[];
  outputPath: string;
  printJson: boolean;
  allowMissing: boolean;
}

interface PlanEventCounter {
  events_count: number;
  plan_mode_entered_count: number;
  plan_created_count: number;
  plan_progress_appended_count: number;
  plan_status_changed_count: number;
  plan_review_passed_count: number;
  plan_review_failed_count: number;
  plan_recovered_stale_approved_count: number;
  plan_recovered_stale_apply_count: number;
  plan_apply_started_count: number;
  plan_apply_succeeded_count: number;
  plan_apply_failed_count: number;
  plan_turn_degraded_count: number;
  plan_turn_failed_count: number;
  plan_benchmark_run_count: number;
  plan_guard_denied_count: number;
  plan_approval_blocked_count: number;
  plan_apply_blocked_count: number;
  plan_approval_blocked_quality_guard_count: number;
  plan_apply_blocked_quality_guard_count: number;
  plan_apply_idempotent_hit_count: number;
  plan_phase_drafting_count: number;
  plan_phase_awaiting_decision_count: number;
  plan_phase_applying_count: number;
  plan_phase_unknown_count: number;
  policy_action_fail_count: number;
  policy_action_degrade_count: number;
  block_reason_counts: Record<string, number>;
  policy_reason_counts: Record<string, number>;
  diagnostic_code_counts: Record<string, number>;
}

interface PlanEventsFileSummary extends PlanEventCounter {
  events_path: string;
  missing: boolean;
  invalid_lines: number;
  session_count: number;
}

interface PlanEventsSessionSummary extends PlanEventCounter {
  session_id: string;
  apply_success_rate: number | null;
  review_failed_rate: number | null;
}

interface PlanEventsTotals extends PlanEventCounter {
  files_count: number;
  missing_files_count: number;
  invalid_lines: number;
  sessions_count: number;
  apply_success_rate: number | null;
  review_failed_rate: number | null;
  guard_denied_rate: number | null;
  approval_blocked_rate: number | null;
  apply_blocked_rate: number | null;
  quality_guard_blocked_rate: number | null;
  idempotent_hit_rate: number | null;
}

interface PlanEventsReport {
  generated_at: string;
  files: PlanEventsFileSummary[];
  totals: PlanEventsTotals;
  per_session: PlanEventsSessionSummary[];
}

interface ParsedEventLine {
  event: string;
  sessionId: string;
  phase: PlanEventPhase;
  blockReason?: string;
  policyAction?: PlanPolicyAction;
  policyReason?: string;
  diagnosticCode?: string;
}

function nowIsoUtc(): string {
  return new Date().toISOString();
}

function createCounter(): PlanEventCounter {
  return {
    events_count: 0,
    plan_mode_entered_count: 0,
    plan_created_count: 0,
    plan_progress_appended_count: 0,
    plan_status_changed_count: 0,
    plan_review_passed_count: 0,
    plan_review_failed_count: 0,
    plan_recovered_stale_approved_count: 0,
    plan_recovered_stale_apply_count: 0,
    plan_apply_started_count: 0,
    plan_apply_succeeded_count: 0,
    plan_apply_failed_count: 0,
    plan_turn_degraded_count: 0,
    plan_turn_failed_count: 0,
    plan_benchmark_run_count: 0,
    plan_guard_denied_count: 0,
    plan_approval_blocked_count: 0,
    plan_apply_blocked_count: 0,
    plan_approval_blocked_quality_guard_count: 0,
    plan_apply_blocked_quality_guard_count: 0,
    plan_apply_idempotent_hit_count: 0,
    plan_phase_drafting_count: 0,
    plan_phase_awaiting_decision_count: 0,
    plan_phase_applying_count: 0,
    plan_phase_unknown_count: 0,
    policy_action_fail_count: 0,
    policy_action_degrade_count: 0,
    block_reason_counts: {},
    policy_reason_counts: {},
    diagnostic_code_counts: {},
  };
}

function dirname(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function parseArgs(argv: string[]): ParsedCliArgs {
  const eventsPaths: string[] = [];
  let outputPath = "";
  let printJson = false;
  let allowMissing = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--events-path") {
      const value = argv[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error("missing value for --events-path");
      }
      eventsPaths.push(value);
      index += 1;
      continue;
    }
    if (token === "--output") {
      const value = argv[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error("missing value for --output");
      }
      outputPath = value;
      index += 1;
      continue;
    }
    if (token === "--print-json") {
      printJson = true;
      continue;
    }
    if (token === "--allow-missing") {
      allowMissing = true;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (eventsPaths.length === 0) {
    throw new Error("at least one --events-path is required");
  }
  return {
    eventsPaths,
    outputPath,
    printJson,
    allowMissing,
  };
}

function extractDetailToken(
  detail: string,
  key: "policy_action" | "policy_reason" | "diagnostic_code" | "reason",
): string | undefined {
  if (!detail) {
    return undefined;
  }
  const pattern = new RegExp(`(?:^|\\s)${key}=([^\\s]+)`);
  const matched = pattern.exec(detail);
  if (!matched) {
    return undefined;
  }
  const value = String(matched[1] ?? "").trim();
  return value.length > 0 ? value : undefined;
}

function parsePolicyAction(detail: string): PlanPolicyAction | undefined {
  const action = extractDetailToken(detail, "policy_action");
  if (action === "fail" || action === "degrade") {
    return action;
  }
  return undefined;
}

function parsePolicyReason(detail: string): string | undefined {
  return extractDetailToken(detail, "policy_reason");
}

function parseDiagnosticCode(detail: string): string | undefined {
  return extractDetailToken(detail, "diagnostic_code");
}

function parseBlockReason(detail: string): string | undefined {
  return extractDetailToken(detail, "reason");
}

function resolvePhaseFromStatus(statusRaw: string | undefined): PlanEventPhase | undefined {
  if (!statusRaw) {
    return undefined;
  }
  switch (statusRaw) {
    case "draft":
    case "blocked":
    case "review_failed":
    case "discarded":
      return "drafting";
    case "ready":
    case "approved":
    case "apply_failed":
      return "awaiting_decision";
    case "applying":
    case "applied":
      return "applying";
    default:
      return undefined;
  }
}

function resolvePhaseFromEvent(event: string): PlanEventPhase {
  switch (event) {
    case "plan_mode_entered":
    case "plan_created":
    case "plan_progress_appended":
    case "plan_guard_denied":
    case "plan_turn_skipped":
    case "plan_turn_interrupted":
    case "plan_mode_cancelled":
    case "plan_content_replaced":
    case "plan_proposed_plan_ingested":
    case "plan_approval_invalidated":
    case "plan_turn_degraded":
    case "plan_turn_failed":
    case "plan_benchmark_run":
    case "plan_interrupt_requested":
    case "plan_interrupt_applied":
    case "plan_interrupt_ignored":
      return "drafting";
    case "plan_review_passed":
    case "plan_review_failed":
    case "plan_approved":
    case "plan_approval_confirmed":
    case "plan_review_rejected":
    case "plan_verification_pending":
    case "plan_verification_passed":
    case "plan_verification_failed":
    case "plan_apply_blocked":
      return "awaiting_decision";
    case "plan_apply_started":
    case "plan_apply_succeeded":
    case "plan_apply_failed":
    case "plan_apply_interrupted":
    case "plan_apply_idempotent_hit":
    case "plan_recovered_stale_apply":
      return "applying";
    default:
      return "unknown";
  }
}

function resolvePlanEventPhase(event: string, statusTo: string | undefined): PlanEventPhase {
  const fromStatus = resolvePhaseFromStatus(statusTo);
  if (fromStatus) {
    return fromStatus;
  }
  return resolvePhaseFromEvent(event);
}

function parseEventLine(line: string): ParsedEventLine | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  const event = typeof record.event === "string" ? record.event.trim() : "";
  if (event.length === 0) {
    return undefined;
  }
  const rawSessionId = typeof record.session_id === "string" ? record.session_id.trim() : "";
  const detail = typeof record.detail === "string" ? record.detail.trim() : "";
  const statusTo = typeof record.status_to === "string" ? record.status_to.trim() : "";
  return {
    event,
    sessionId: rawSessionId.length > 0 ? rawSessionId : "unknown",
    phase: resolvePlanEventPhase(event, statusTo.length > 0 ? statusTo : undefined),
    blockReason: parseBlockReason(detail),
    policyAction: parsePolicyAction(detail),
    policyReason: parsePolicyReason(detail),
    diagnosticCode: parseDiagnosticCode(detail),
  };
}

function applyEvent(counter: PlanEventCounter, eventLine: ParsedEventLine): void {
  const { event, phase, blockReason, policyAction, policyReason, diagnosticCode } = eventLine;
  counter.events_count += 1;
  switch (event) {
    case "plan_mode_entered":
      counter.plan_mode_entered_count += 1;
      break;
    case "plan_created":
      counter.plan_created_count += 1;
      break;
    case "plan_progress_appended":
      counter.plan_progress_appended_count += 1;
      break;
    case "plan_status_changed":
      counter.plan_status_changed_count += 1;
      break;
    case "plan_review_passed":
      counter.plan_review_passed_count += 1;
      break;
    case "plan_review_failed":
      counter.plan_review_failed_count += 1;
      break;
    case "plan_recovered_stale_approved":
      counter.plan_recovered_stale_approved_count += 1;
      break;
    case "plan_recovered_stale_apply":
      counter.plan_recovered_stale_apply_count += 1;
      counter.plan_recovered_stale_approved_count += 1;
      break;
    case "plan_apply_started":
      counter.plan_apply_started_count += 1;
      break;
    case "plan_apply_succeeded":
      counter.plan_apply_succeeded_count += 1;
      break;
    case "plan_apply_failed":
      counter.plan_apply_failed_count += 1;
      break;
    case "plan_turn_degraded":
      counter.plan_turn_degraded_count += 1;
      break;
    case "plan_turn_failed":
      counter.plan_turn_failed_count += 1;
      break;
    case "plan_benchmark_run":
      counter.plan_benchmark_run_count += 1;
      break;
    case "plan_guard_denied":
      counter.plan_guard_denied_count += 1;
      break;
    case "plan_approval_blocked":
      counter.plan_approval_blocked_count += 1;
      if (blockReason === "quality_guard_critical") {
        counter.plan_approval_blocked_quality_guard_count += 1;
      }
      break;
    case "plan_apply_blocked":
      counter.plan_apply_blocked_count += 1;
      if (blockReason === "quality_guard_critical") {
        counter.plan_apply_blocked_quality_guard_count += 1;
      }
      break;
    case "plan_apply_idempotent_hit":
      counter.plan_apply_idempotent_hit_count += 1;
      break;
    default:
      break;
  }
  switch (phase) {
    case "drafting":
      counter.plan_phase_drafting_count += 1;
      break;
    case "awaiting_decision":
      counter.plan_phase_awaiting_decision_count += 1;
      break;
    case "applying":
      counter.plan_phase_applying_count += 1;
      break;
    default:
      counter.plan_phase_unknown_count += 1;
      break;
  }
  if (policyAction === "fail") {
    counter.policy_action_fail_count += 1;
  } else if (policyAction === "degrade") {
    counter.policy_action_degrade_count += 1;
  }
  if (policyReason) {
    const current = counter.policy_reason_counts[policyReason] ?? 0;
    counter.policy_reason_counts[policyReason] = current + 1;
  }
  if (diagnosticCode) {
    const current = counter.diagnostic_code_counts[diagnosticCode] ?? 0;
    counter.diagnostic_code_counts[diagnosticCode] = current + 1;
  }
  if (blockReason) {
    const current = counter.block_reason_counts[blockReason] ?? 0;
    counter.block_reason_counts[blockReason] = current + 1;
  }
}

function roundRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return Number((numerator / denominator).toFixed(4));
}

function buildReport(input: ParsedCliArgs): PlanEventsReport {
  const totalsCounter = createCounter();
  const perSessionMap = new Map<string, PlanEventCounter>();
  const files: PlanEventsFileSummary[] = [];
  let invalidLinesTotal = 0;
  let missingFilesCount = 0;
  for (const rawPath of input.eventsPaths) {
    const eventsPath = resolve(rawPath);
    const fileCounter = createCounter();
    const fileSessions = new Set<string>();
    let invalidLines = 0;
    if (!existsSync(eventsPath)) {
      if (!input.allowMissing) {
        throw new Error(`events file not found: ${eventsPath}`);
      }
      missingFilesCount += 1;
      files.push({
        ...fileCounter,
        events_path: eventsPath,
        missing: true,
        invalid_lines: 0,
        session_count: 0,
      });
      continue;
    }
    const raw = readFileSync(eventsPath, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const eventRecord = parseEventLine(trimmed);
      if (!eventRecord) {
        invalidLines += 1;
        continue;
      }
      applyEvent(fileCounter, eventRecord);
      applyEvent(totalsCounter, eventRecord);
      fileSessions.add(eventRecord.sessionId);
      if (!perSessionMap.has(eventRecord.sessionId)) {
        perSessionMap.set(eventRecord.sessionId, createCounter());
      }
      const sessionCounter = perSessionMap.get(eventRecord.sessionId);
      if (sessionCounter) {
        applyEvent(sessionCounter, eventRecord);
      }
    }
    invalidLinesTotal += invalidLines;
    files.push({
      ...fileCounter,
      events_path: eventsPath,
      missing: false,
      invalid_lines: invalidLines,
      session_count: fileSessions.size,
    });
  }
  const perSession = Array.from(perSessionMap.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([sessionId, counter]) => ({
      session_id: sessionId,
      ...counter,
      apply_success_rate: roundRate(counter.plan_apply_succeeded_count, counter.plan_apply_started_count),
      review_failed_rate: roundRate(counter.plan_review_failed_count, counter.plan_mode_entered_count),
    }));
  const totals: PlanEventsTotals = {
    ...totalsCounter,
    files_count: files.length,
    missing_files_count: missingFilesCount,
    invalid_lines: invalidLinesTotal,
    sessions_count: perSession.length,
    apply_success_rate: roundRate(totalsCounter.plan_apply_succeeded_count, totalsCounter.plan_apply_started_count),
    review_failed_rate: roundRate(totalsCounter.plan_review_failed_count, totalsCounter.plan_mode_entered_count),
    guard_denied_rate: roundRate(totalsCounter.plan_guard_denied_count, totalsCounter.plan_mode_entered_count),
    approval_blocked_rate: roundRate(
      totalsCounter.plan_approval_blocked_count,
      totalsCounter.plan_mode_entered_count,
    ),
    apply_blocked_rate: roundRate(
      totalsCounter.plan_apply_blocked_count,
      totalsCounter.plan_mode_entered_count,
    ),
    quality_guard_blocked_rate: roundRate(
      totalsCounter.plan_approval_blocked_quality_guard_count + totalsCounter.plan_apply_blocked_quality_guard_count,
      totalsCounter.plan_mode_entered_count,
    ),
    idempotent_hit_rate: roundRate(
      totalsCounter.plan_apply_idempotent_hit_count,
      totalsCounter.plan_apply_started_count + totalsCounter.plan_apply_idempotent_hit_count,
    ),
  };
  return {
    generated_at: nowIsoUtc(),
    files,
    totals,
    per_session: perSession,
  };
}

function writeReportFile(outputPath: string, report: PlanEventsReport): void {
  const resolvedPath = resolve(outputPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function main(argv: string[]): number {
  const args = parseArgs(argv);
  const report = buildReport(args);
  if (args.outputPath) {
    writeReportFile(args.outputPath, report);
  }
  if (args.printJson || !args.outputPath) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`plan-events-report failed: ${message}\n`);
  process.exitCode = 1;
}
