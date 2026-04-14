import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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
  plan_recovered_stale_approved_count: number;
  plan_apply_started_count: number;
  plan_apply_succeeded_count: number;
  plan_apply_failed_count: number;
  plan_guard_denied_count: number;
  plan_apply_idempotent_hit_count: number;
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
}

interface PlanEventsTotals extends PlanEventCounter {
  files_count: number;
  missing_files_count: number;
  invalid_lines: number;
  sessions_count: number;
  apply_success_rate: number | null;
  guard_denied_rate: number | null;
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
    plan_recovered_stale_approved_count: 0,
    plan_apply_started_count: 0,
    plan_apply_succeeded_count: 0,
    plan_apply_failed_count: 0,
    plan_guard_denied_count: 0,
    plan_apply_idempotent_hit_count: 0,
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
  return {
    event,
    sessionId: rawSessionId.length > 0 ? rawSessionId : "unknown",
  };
}

function applyEvent(counter: PlanEventCounter, event: string): void {
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
    case "plan_recovered_stale_approved":
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
    case "plan_guard_denied":
      counter.plan_guard_denied_count += 1;
      break;
    case "plan_apply_idempotent_hit":
      counter.plan_apply_idempotent_hit_count += 1;
      break;
    default:
      break;
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
      applyEvent(fileCounter, eventRecord.event);
      applyEvent(totalsCounter, eventRecord.event);
      fileSessions.add(eventRecord.sessionId);
      if (!perSessionMap.has(eventRecord.sessionId)) {
        perSessionMap.set(eventRecord.sessionId, createCounter());
      }
      const sessionCounter = perSessionMap.get(eventRecord.sessionId);
      if (sessionCounter) {
        applyEvent(sessionCounter, eventRecord.event);
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
    }));
  const totals: PlanEventsTotals = {
    ...totalsCounter,
    files_count: files.length,
    missing_files_count: missingFilesCount,
    invalid_lines: invalidLinesTotal,
    sessions_count: perSession.length,
    apply_success_rate: roundRate(totalsCounter.plan_apply_succeeded_count, totalsCounter.plan_apply_started_count),
    guard_denied_rate: roundRate(totalsCounter.plan_guard_denied_count, totalsCounter.plan_mode_entered_count),
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
