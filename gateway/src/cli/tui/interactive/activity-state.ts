import type { RuntimeEvent } from "../../../models/types";
import { resolveRuntimeEventActivity } from "./activity-runtime-events";

export interface ActivityUpdate {
  stageId: string;
  text: string;
  detail?: string;
  status?: ActivityStatus;
}

export type ActivityKind = "context" | "runtime" | "plan" | "route" | "ask-user" | "tool" | "memory" | "governance";

export type ActivityStatus = "running" | "done" | "warning" | "error";

export interface ActivitySnapshot extends ActivityUpdate {
  kind: ActivityKind;
  title: string;
  detail?: string;
  status: ActivityStatus;
  updatedAtMs: number;
}

export interface InteractiveActivityTracker {
  markTurnStart(input?: {
    stageId?: string;
    text?: string;
    detail?: string;
    planMode?: boolean;
  }): void;
  markTurnFinished(status: "ok" | "error" | "interrupted"): void;
  consumeStderrChunk(chunk: string): string;
  observeStderrChunk(chunk: string): void;
  observeRuntimeEvent(event: RuntimeEvent): void;
  flushBufferedStderr(): string;
  readPromptActivitySnapshot(): { stageId: string; text: string } | undefined;
  readActivitySnapshot(): ActivitySnapshot | undefined;
  readPromptActivity(): string | undefined;
}

export interface CreateInteractiveActivityTrackerInput {
  writeProgressLine?(line: string): void;
  minEmitIntervalMs?: number;
  promptRetentionMs?: number;
}

const DEFAULT_MIN_EMIT_INTERVAL_MS = 400;
const DEFAULT_PROMPT_RETENTION_MS = 20_000;
const ACTIVITY_PROGRESS_PREFIX = "›";

const DIAGNOSTIC_TAGS = new Set<string>([
  "ask-user",
  "context-engine",
  "execution",
  "experience-pool",
  "experience-scheduler",
  "experience",
  "governance",
  "governance:mcp-instruction",
  "governance:search-route",
  "interrupt",
  "memory-orchestrator",
  "plan-mode",
  "reflection",
  "runtime-model",
  "runtime-route",
]);

function resolveActivityKind(stageId: string): ActivityKind {
  if (stageId.startsWith("context_")) {
    return "context";
  }
  if (stageId.startsWith("runtime_route")) {
    return "route";
  }
  if (stageId.startsWith("plan_")) {
    return "plan";
  }
  if (stageId.startsWith("runtime_") || stageId.startsWith("execution") || stageId.startsWith("turn_")) {
    return "runtime";
  }
  if (stageId.startsWith("ask_user")) {
    return "ask-user";
  }
  if (stageId.startsWith("tool_")) {
    return "tool";
  }
  if (stageId.startsWith("memory_") || stageId.startsWith("experience_") || stageId === "reflection") {
    return "memory";
  }
  if (stageId.startsWith("governance")) {
    return "governance";
  }
  return "runtime";
}

function resolveActivityStatus(input: ActivityUpdate): ActivityStatus {
  if (input.status) {
    return input.status;
  }
  if (
    input.stageId.includes("warning")
    || input.stageId.includes("degraded")
    || input.stageId.includes("retry")
    || input.stageId.includes("recovery")
  ) {
    return "warning";
  }
  if (input.stageId.includes("error") || input.stageId.includes("failed")) {
    return "error";
  }
  if (input.stageId.includes("done") || input.stageId.includes("finished_ok")) {
    return "done";
  }
  return "running";
}

function toActivitySnapshot(next: ActivityUpdate, updatedAtMs: number): ActivitySnapshot {
  const title = next.text.trim();
  return {
    ...next,
    kind: resolveActivityKind(next.stageId),
    title,
    status: resolveActivityStatus(next),
    updatedAtMs,
  };
}

function extractField(line: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matched = line.match(new RegExp(`\\b${escapedKey}=([^\\s]+)`));
  if (!matched || typeof matched[1] !== "string") {
    return undefined;
  }
  return matched[1];
}

function detailFromParts(parts: string[]): string | undefined {
  const detail = parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "<none>")
    .join(" · ");
  return detail || undefined;
}

function humanFieldLabel(label: string): string {
  switch (label) {
    case "provider":
      return "provider";
    case "timeout":
      return "timeout";
    case "reason":
      return "reason";
    case "retry":
      return "retry";
    case "selected":
      return "route";
    case "strategy":
      return "strategy";
    case "stage":
      return "stage";
    case "util":
      return "usage";
    case "overall":
      return "quality";
    case "coverage":
      return "coverage";
    case "symbol":
      return "symbols";
    case "deps":
      return "deps";
    case "event":
      return "event";
    case "phase":
      return "phase";
    case "status":
      return "status";
    default:
      return label;
  }
}

function humanFieldValue(label: string, value: string): string {
  const normalized = value.trim();
  const key = normalized.toLowerCase();
  if (label === "strategy") {
    switch (key) {
      case "sticky+score":
        return "session first + score";
      case "quality_first":
        return "quality first";
      case "hard_budget":
        return "hard budget";
      default:
        break;
    }
  }
  if (label === "stage" || label === "phase") {
    switch (key) {
      case "normal":
        return "normal";
      case "proactive":
        return "proactive compact";
      case "forced":
        return "forced compact";
      case "minimal":
        return "minimal context";
      case "planning":
        return "planning";
      default:
        break;
    }
  }
  if (label === "status") {
    switch (key) {
      case "applied":
        return "applied";
      case "warning":
        return "warning";
      case "degraded":
        return "degraded";
      case "empty":
        return "empty";
      case "success":
        return "success";
      case "failed":
        return "failed";
      default:
        break;
    }
  }
  if (label === "event") {
    switch (key) {
      case "maintenance_skipped":
        return "maintenance skipped";
      case "maintenance":
        return "maintenance";
      case "maintenance_failed":
        return "maintenance failed";
      case "task_skipped":
        return "task skipped";
      case "task_triggered":
        return "task triggered";
      case "task_finished":
        return "task finished";
      case "task_failed":
        return "task failed";
      case "context_injected":
        return "memory context injected";
      case "context_skipped":
        return "memory context skipped";
      case "prompt_injected":
        return "prompt injected";
      case "prompt_skipped":
        return "prompt skipped";
      case "strict_failure":
        return "instruction check failed";
      case "policy_injected":
        return "policy injected";
      case "requested":
        return "requested";
      case "applied":
        return "applied";
      case "ignored":
        return "ignored";
      case "rejected":
        return "rejected";
      default:
        break;
    }
  }
  if (label === "reason") {
    switch (key) {
      case "no_active_turn":
        return "no active turn";
      case "turn_completed_before_abort":
        return "turn already completed";
      case "active_turn":
        return "active turn";
      case "pending_ask":
      case "ask_user_interrupt":
      case "ask_user_pending_followup":
        return "waiting for confirmation";
      case "plan_mode":
        return "plan mode";
      case "budget_or_no_signal":
        return "budget or signal insufficient";
      case "circuit_open":
        return "circuit open";
      default:
        break;
    }
  }
  if (/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(normalized)) {
    return normalized.replace(/[_-]+/g, " ");
  }
  return normalized;
}

function humanDiagnosticTopic(tag: string): string | undefined {
  const colonIndex = tag.indexOf(":");
  if (colonIndex < 0) {
    return undefined;
  }
  const topic = tag.slice(colonIndex + 1);
  switch (topic) {
    case "mcp-instruction":
      return "MCP instructions";
    case "search-route":
      return "search route";
    default:
      return topic.replace(/[-_]+/g, " ");
  }
}

function fieldDetail(label: string, value: string | undefined): string {
  if (!value || value === "<none>") {
    return "";
  }
  return `${humanFieldLabel(label)} ${humanFieldValue(label, value)}`;
}

function promptBudgetDetail(body: string): string | undefined {
  const stage = extractField(body, "stage");
  const estimatedTokens = extractField(body, "estimated_tokens");
  const targetLimit = extractField(body, "target_limit");
  const selectedUtilization = extractField(body, "selected_utilization");
  const utilization = selectedUtilization ?? extractField(body, "utilization");
  return detailFromParts([
    fieldDetail("stage", stage),
    estimatedTokens && targetLimit ? `budget ${estimatedTokens}/${targetLimit}` : "",
    fieldDetail("util", utilization),
  ]);
}

function resolveProgressTextFromDiagnostic(tag: string, body: string): ActivityUpdate | undefined {
  const event = extractField(body, "event");
  if (tag === "runtime-model") {
    const provider = extractField(body, "provider");
    const timeoutMs = extractField(body, "timeout_ms");
    return {
      stageId: "runtime_model",
      text: "Preparing model request",
      detail: detailFromParts([
        fieldDetail("provider", provider),
        fieldDetail("timeout", timeoutMs ? `${timeoutMs}ms` : undefined),
      ]),
    };
  }
  if (tag === "execution") {
    return {
      stageId: "execution_done",
      text: "Model response received; formatting output",
      detail: "formatting final reply",
    };
  }
  if (tag === "governance" || tag.startsWith("governance:")) {
    return {
      stageId: "governance",
      text: "Checking governance and routing policy",
      detail: humanDiagnosticTopic(tag),
    };
  }
  if (tag === "runtime-route") {
    if (body.includes("all provider circuits are OPEN")) {
      return {
        stageId: "runtime_route_open_circuit",
        text: "All model providers unavailable",
        status: "warning",
      };
    }
    if (body.includes("provider_retry")) {
      const backoffMs = extractField(body, "backoff_ms");
      const provider = extractField(body, "provider");
      const reason = extractField(body, "reason");
      const retry = extractField(body, "retry");
      return {
        stageId: "runtime_retry",
        text: backoffMs
          ? `Upstream rate limited; retrying in ${backoffMs}ms`
          : "Upstream rate limited; retrying request",
        detail: detailFromParts([
          fieldDetail("provider", provider),
          fieldDetail("reason", reason),
          fieldDetail("retry", retry),
        ]),
      };
    }
    if (event === "decision") {
      const selected = extractField(body, "selected");
      const strategy = extractField(body, "strategy");
      const stickyHit = extractField(body, "sticky_hit");
      return {
        stageId: "runtime_route_decision",
        text: "Choosing model route",
        detail: detailFromParts([
          fieldDetail("selected", selected),
          stickyHit === "true" ? "reuse session provider" : "",
          fieldDetail("strategy", strategy),
        ]),
      };
    }
    return {
      stageId: "runtime_route",
      text: "Running model route",
    };
  }
  if (tag === "context-engine") {
    if (event === "semantic_prefetch") {
      const status = extractField(body, "status");
      if (status === "applied") {
        return {
          stageId: "context_prefetch_applied",
          text: "Adding semantic evidence",
          detail: fieldDetail("status", status),
        };
      }
      if (status === "warning" || status === "degraded") {
        return {
          stageId: "context_prefetch_degraded",
          text: "Semantic evidence partially available; continuing",
          detail: fieldDetail("status", status),
          status: "warning",
        };
      }
      return {
        stageId: "context_prefetch",
        text: "Trying semantic evidence prefetch",
      };
    }
    if (event === "prompt_quality") {
      return {
        stageId: "context_quality",
        text: "Evaluating prompt quality",
        detail: detailFromParts([
          fieldDetail("overall", extractField(body, "overall")),
          fieldDetail("coverage", extractField(body, "coverage")),
        ]),
      };
    }
    if (event === "graph_cache_stats") {
      return {
        stageId: "context_graph_cache",
        text: "Calibrating context evidence",
        detail: detailFromParts([
          fieldDetail("symbol", extractField(body, "quality_symbol_rows")),
          fieldDetail("deps", extractField(body, "quality_dependency_rows")),
        ]),
      };
    }
    if (event === "prompt_prepared" || event === "quality_guard_precompact" || event === "downshift_precompact") {
      return {
        stageId: "context_prepare",
        text: "Preparing context window",
        detail: promptBudgetDetail(body),
      };
    }
    if (event?.startsWith("pre_send_")) {
      return {
        stageId: "context_pre_send",
        text: "Compacting context to fit budget",
        detail: detailFromParts([
          fieldDetail("stage", extractField(body, "stage")),
          fieldDetail("strategy", extractField(body, "strategy")),
          fieldDetail("retry", extractField(body, "retry")),
        ]),
      };
    }
    if (
      event === "reactive_compact_retry"
      || event === "reactive_compact_failed"
      || event === "ptl_retry"
      || event === "reactive_compact_skipped"
    ) {
      return {
        stageId: "context_recovery",
        text: "Running context recovery strategy",
        detail: detailFromParts([
          fieldDetail("provider", extractField(body, "provider")),
          fieldDetail("reason", extractField(body, "reason")),
          fieldDetail("retry", extractField(body, "retry")),
        ]),
      };
    }
    return {
      stageId: "context_engine",
      text: "Building context",
    };
  }
  if (tag === "ask-user") {
    if (event === "interrupt_received") {
      return {
        stageId: "ask_user_waiting",
        text: "Waiting for confirmation",
        detail: "reply in input",
      };
    }
    if (event === "clarification_hint_injected") {
      return {
        stageId: "ask_user_clarify",
        text: "Adding clarification prompt",
        detail: "clarification context",
      };
    }
    return {
      stageId: "ask_user",
      text: "Processing confirmation flow",
    };
  }
  if (tag === "plan-mode") {
    if (event === "enter_started") {
      return {
        stageId: "plan_enter_started",
        text: "Entering plan mode",
      };
    }
    if (event === "draft_created") {
      return {
        stageId: "plan_draft_created",
        text: "Plan draft created; adding goal context",
      };
    }
    if (event === "progress_saved") {
      return {
        stageId: "plan_progress_saved",
        text: "Recording your additional requirements",
      };
    }
    if (event === "model_planning") {
      return {
        stageId: "plan_model_planning",
        text: "Grobot is planning the implementation",
        detail: fieldDetail("phase", extractField(body, "phase")),
      };
    }
    if (event === "model_returned") {
      return {
        stageId: "plan_model_returned",
        text: "Plan draft returned; saving",
      };
    }
    if (event === "proposed_plan_ingested") {
      return {
        stageId: "plan_file_updated",
        text: "Updating plan file",
      };
    }
    if (event === "review_started") {
      return {
        stageId: "plan_review_started",
        text: "Checking whether the plan is executable",
      };
    }
    if (event === "review_needs_refinement") {
      return {
        stageId: "plan_review_refinement",
        text: "Plan needs more detail",
        status: "warning",
      };
    }
    if (event === "plan_updated") {
      return {
        stageId: "plan_updated",
        text: "Plan updated; waiting for refinement",
        status: "done",
      };
    }
    if (event === "approval_waiting") {
      return {
        stageId: "plan_approval_waiting",
        text: "Waiting for plan confirmation",
        detail: "confirm execution or keep planning",
      };
    }
    if (event === "apply_review_started") {
      return {
        stageId: "plan_apply_review_started",
        text: "Reviewing approved plan",
      };
    }
    if (event === "apply_model_running") {
      return {
        stageId: "plan_apply_model_running",
        text: "Executing approved plan",
      };
    }
    if (event === "apply_finished") {
      return {
        stageId: "plan_apply_finished",
        text: "Plan execution finished; wrapping up",
        status: "done",
      };
    }
    return {
      stageId: "plan_mode",
      text: "Processing plan-mode flow",
      detail: fieldDetail("event", event),
    };
  }
  if (tag === "experience" && event === "publish_skipped") {
    return {
      stageId: "experience_skip",
      text: "Confirmation requested; skipping experience capture",
      detail: "waiting for confirmation",
    };
  }
  if (tag === "experience-pool" || tag === "experience-scheduler") {
    return {
      stageId: "experience_maintenance",
      text: "Maintaining experience pool and scheduled tasks",
      detail: fieldDetail("event", event),
    };
  }
  if (tag === "memory-orchestrator") {
    return {
      stageId: "memory_maintenance",
      text: "Maintaining memory policy and quality window",
      detail: fieldDetail("event", event),
    };
  }
  if (tag === "interrupt") {
    return {
      stageId: "interrupt",
      text: "Processing interrupt request",
      detail: fieldDetail("event", event),
    };
  }
  if (tag === "reflection") {
    return {
      stageId: "reflection",
      text: "Generating reflection suggestions",
    };
  }
  return undefined;
}

function parseDiagnosticLine(rawLine: string): {
  isDiagnostic: boolean;
  update?: ActivityUpdate;
} {
  const trimmed = rawLine.trim();
  const matched = trimmed.match(/^\[([a-z0-9:-]+)\]\s*(.*)$/i);
  if (!matched || typeof matched[1] !== "string") {
    return { isDiagnostic: false };
  }
  const tag = matched[1].toLowerCase();
  const body = typeof matched[2] === "string" ? matched[2] : "";
  const treatAsGenericDiagnostic = /\bevent=/.test(body) && !tag.startsWith("plan");
  if (!DIAGNOSTIC_TAGS.has(tag) && !treatAsGenericDiagnostic) {
    return { isDiagnostic: false };
  }
  return {
    isDiagnostic: true,
    update: resolveProgressTextFromDiagnostic(tag, body),
  };
}

export function createInteractiveActivityTracker(
  input: CreateInteractiveActivityTrackerInput = {},
): InteractiveActivityTracker {
  const writeProgressLine = input.writeProgressLine;
  const minEmitIntervalMs =
    typeof input.minEmitIntervalMs === "number" && input.minEmitIntervalMs > 0
      ? Math.floor(input.minEmitIntervalMs)
      : DEFAULT_MIN_EMIT_INTERVAL_MS;
  const promptRetentionMs =
    typeof input.promptRetentionMs === "number" && input.promptRetentionMs > 0
      ? Math.floor(input.promptRetentionMs)
      : DEFAULT_PROMPT_RETENTION_MS;
  let snapshot: ActivitySnapshot | undefined;
  let lastEmittedSignature = "";
  let lastEmittedAtMs = 0;
  let bufferedStderr = "";

  const setActivity = (next: ActivityUpdate): void => {
    const now = Date.now();
    const nextSignature = `${next.stageId}:${next.text}:${next.detail ?? ""}`;
    snapshot = toActivitySnapshot(next, now);
    if (!writeProgressLine) {
      return;
    }
    if (nextSignature === lastEmittedSignature && now - lastEmittedAtMs < minEmitIntervalMs) {
      return;
    }
    if (nextSignature === lastEmittedSignature) {
      return;
    }
    const renderedProgress = next.detail
      ? `${next.text} · ${next.detail}`
      : next.text;
    writeProgressLine(`${ACTIVITY_PROGRESS_PREFIX} ${renderedProgress}\n`);
    lastEmittedSignature = nextSignature;
    lastEmittedAtMs = now;
  };

  const processChunk = (chunk: string, suppressDiagnostics: boolean): string => {
    bufferedStderr += chunk;
    const lines = bufferedStderr.split("\n");
    bufferedStderr = lines.pop() ?? "";
    let forwarded = "";
    for (const line of lines) {
      const parsed = parseDiagnosticLine(line);
      if (parsed.update) {
        setActivity(parsed.update);
      }
      if (!suppressDiagnostics || !parsed.isDiagnostic) {
        forwarded += `${line}\n`;
      }
    }
    return forwarded;
  };

  return {
    markTurnStart: (inputStart): void => {
      setActivity({
        stageId: inputStart?.stageId ?? (inputStart?.planMode ? "plan_turn_start" : "turn_start"),
        text: inputStart?.text
          ?? (inputStart?.planMode
            ? "Reading goal and preparing plan context"
            : "Reading task and preparing context"),
        detail: inputStart?.detail,
      });
    },
    markTurnFinished: (status): void => {
      if (status === "ok") {
        snapshot = undefined;
        lastEmittedSignature = "";
        lastEmittedAtMs = 0;
        return;
      }
      if (status === "interrupted") {
        setActivity({
          stageId: "turn_finished_interrupted",
          text: "Execution interrupted",
          status: "warning",
        });
        return;
      }
      setActivity({
        stageId: "turn_finished_error",
        text: "Execution failed; see error output",
        status: "error",
      });
    },
    consumeStderrChunk: (chunk): string => processChunk(chunk, true),
    observeStderrChunk: (chunk): void => {
      void processChunk(chunk, false);
    },
    observeRuntimeEvent: (event): void => {
      const update = resolveRuntimeEventActivity(event);
      if (update) {
        setActivity(update);
      }
    },
    flushBufferedStderr: (): string => {
      if (!bufferedStderr) {
        return "";
      }
      const remainder = bufferedStderr;
      bufferedStderr = "";
      const parsed = parseDiagnosticLine(remainder.trim());
      if (parsed.update) {
        setActivity(parsed.update);
      }
      return parsed.isDiagnostic ? "" : remainder;
    },
    readPromptActivitySnapshot: (): { stageId: string; text: string } | undefined => {
      if (!snapshot) {
        return undefined;
      }
      if (Date.now() - snapshot.updatedAtMs > promptRetentionMs) {
        return undefined;
      }
      return {
        stageId: snapshot.stageId,
        text: snapshot.text,
      };
    },
    readActivitySnapshot: (): ActivitySnapshot | undefined => {
      if (!snapshot) {
        return undefined;
      }
      if (Date.now() - snapshot.updatedAtMs > promptRetentionMs) {
        return undefined;
      }
      return {
        ...snapshot,
      };
    },
    readPromptActivity: (): string | undefined => {
      if (!snapshot) {
        return undefined;
      }
      if (Date.now() - snapshot.updatedAtMs > promptRetentionMs) {
        return undefined;
      }
      return snapshot.text;
    },
  };
}
