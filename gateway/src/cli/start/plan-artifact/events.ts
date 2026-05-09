import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { resolvePlanArtifactEnvControls } from "./env-controls";
import {
  dirname,
  nowIsoUtc,
  parseOptionalNonNegativeInt,
  readText,
} from "./fs-utils";
import { withSessionPlanLock } from "./lock";
import { planEventsPath } from "./paths";
import {
  extractDetailToken,
  parseDetailBoolean,
} from "./event-detail";
import type {
  PlanArtifactEvent,
  PlanLatestFailureDiagnostic,
  PlanLatestVerificationDiagnostic,
} from "./types";

function rotatePlanEventsIfNeeded(path: string): void {
  const controls = resolvePlanArtifactEnvControls();
  const maxBytes = controls.eventsMaxBytes;
  const rotateKeep = controls.eventsRotateKeep;
  if (!existsSync(path)) {
    return;
  }
  let size = 0;
  try {
    const stats = statSync(path) as unknown as { size?: number };
    size = typeof stats.size === "number" ? stats.size : 0;
  } catch {
    return;
  }
  if (size < maxBytes) {
    return;
  }
  for (let index = rotateKeep - 1; index >= 1; index -= 1) {
    const source = `${path}.${String(index)}`;
    const target = `${path}.${String(index + 1)}`;
    if (!existsSync(source)) {
      continue;
    }
    try {
      renameSync(source, target);
    } catch {
      // Event log rotation is best effort; never block event recording.
    }
  }
  try {
    renameSync(path, `${path}.1`);
  } catch {
    // Ignore rotation failures and continue writing the current file.
  }
}

export function appendPlanEventUnlocked(
  workDir: string,
  sessionId: string,
  event: Omit<PlanArtifactEvent, "at" | "session_id"> & {
    at?: string;
    session_id?: string;
  },
): PlanArtifactEvent {
  const record: PlanArtifactEvent = {
    at: event.at ?? nowIsoUtc(),
    event: event.event,
    session_id: event.session_id ?? sessionId,
    plan_id: event.plan_id,
    source: event.source,
    detail: event.detail,
    status_from: event.status_from,
    status_to: event.status_to,
  };
  const path = planEventsPath(workDir, sessionId);
  const serialized = `${JSON.stringify(record)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  rotatePlanEventsIfNeeded(path);
  const appendWrite = writeFileSync as unknown as (
    path: string,
    data: string,
    options: { encoding: "utf8"; flag: string },
  ) => void;
  appendWrite(path, serialized, { encoding: "utf8", flag: "a" });
  return record;
}

export function appendPlanEvent(
  workDir: string,
  sessionId: string,
  event: Omit<PlanArtifactEvent, "at" | "session_id"> & {
    at?: string;
    session_id?: string;
  },
): PlanArtifactEvent {
  return withSessionPlanLock(workDir, sessionId, () =>
    appendPlanEventUnlocked(workDir, sessionId, event));
}

export function loadLatestPlanFailureDiagnostic(
  workDir: string,
  sessionId: string,
  options?: {
    planId?: string;
  },
): PlanLatestFailureDiagnostic | undefined {
  const path = planEventsPath(workDir, sessionId);
  const raw = readText(path);
  if (!raw) {
    return undefined;
  }
  const lines = raw.split(/\r?\n/);
  const targetPlanId = options?.planId?.trim();
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      continue;
    }
    const record = parsed as Record<string, unknown>;
    const event = typeof record.event === "string" ? record.event.trim() : "";
    if (
      event !== "plan_turn_failed"
      && event !== "plan_turn_degraded"
      && event !== "plan_apply_failed"
      && event !== "plan_review_failed"
    ) {
      continue;
    }
    const planId = typeof record.plan_id === "string" ? record.plan_id.trim() : "";
    if (targetPlanId && planId && planId !== targetPlanId) {
      continue;
    }
    const detail = typeof record.detail === "string" ? record.detail.trim() : "";
    const policyActionRaw = extractDetailToken(detail, "policy_action");
    const policyAction = policyActionRaw === "fail" || policyActionRaw === "degrade"
      ? policyActionRaw
      : undefined;
    const exitCode = parseOptionalNonNegativeInt(extractDetailToken(detail, "exit_code"));
    const findingsCount = parseOptionalNonNegativeInt(extractDetailToken(detail, "findings_count"));
    return {
      at: typeof record.at === "string" ? record.at : nowIsoUtc(),
      event,
      planId: planId || undefined,
      detail: detail || undefined,
      exitCode,
      policyAction,
      policyReason: extractDetailToken(detail, "policy_reason"),
      diagnosticCode: extractDetailToken(detail, "diagnostic_code"),
      providerName: extractDetailToken(detail, "provider"),
      errorClass: extractDetailToken(detail, "class") ?? extractDetailToken(detail, "error_class"),
      reviewBlocked: parseDetailBoolean(extractDetailToken(detail, "review_blocked")),
      findingsCount,
    };
  }
  return undefined;
}

function resolveVerificationStatusFromEvent(
  event: "plan_verification_pending" | "plan_verification_passed" | "plan_verification_failed",
  detail: string,
): "pending" | "passed" | "failed" {
  const token = extractDetailToken(detail, "verification_status");
  if (token === "pending" || token === "passed" || token === "failed") {
    return token;
  }
  if (event === "plan_verification_passed") {
    return "passed";
  }
  if (event === "plan_verification_failed") {
    return "failed";
  }
  return "pending";
}

export function loadLatestPlanVerificationDiagnostic(
  workDir: string,
  sessionId: string,
  options?: {
    planId?: string;
  },
): PlanLatestVerificationDiagnostic | undefined {
  const path = planEventsPath(workDir, sessionId);
  const raw = readText(path);
  if (!raw) {
    return undefined;
  }
  const lines = raw.split(/\r?\n/);
  const targetPlanId = options?.planId?.trim();
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      continue;
    }
    const record = parsed as Record<string, unknown>;
    const eventRaw = typeof record.event === "string" ? record.event.trim() : "";
    if (
      eventRaw !== "plan_verification_pending"
      && eventRaw !== "plan_verification_passed"
      && eventRaw !== "plan_verification_failed"
    ) {
      continue;
    }
    const event = eventRaw;
    const planId = typeof record.plan_id === "string" ? record.plan_id.trim() : "";
    if (targetPlanId && planId && planId !== targetPlanId) {
      continue;
    }
    const detail = typeof record.detail === "string" ? record.detail.trim() : "";
    return {
      at: typeof record.at === "string" ? record.at : nowIsoUtc(),
      event,
      planId: planId || undefined,
      detail: detail || undefined,
      status: resolveVerificationStatusFromEvent(event, detail),
    };
  }
  return undefined;
}
