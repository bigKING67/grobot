interface ActivityUpdate {
  stageId: string;
  text: string;
  detail?: string;
  status?: ActivityStatus;
}

export type ActivityKind =
  | "context"
  | "runtime"
  | "plan"
  | "route"
  | "ask-user"
  | "tool"
  | "memory"
  | "governance";

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

function fieldDetail(label: string, value: string | undefined): string {
  if (!value || value === "<none>") {
    return "";
  }
  return `${label}=${value}`;
}

function promptBudgetDetail(body: string): string | undefined {
  const stage = extractField(body, "stage");
  const estimatedTokens = extractField(body, "estimated_tokens");
  const targetLimit = extractField(body, "target_limit");
  const selectedUtilization = extractField(body, "selected_utilization");
  const utilization = selectedUtilization ?? extractField(body, "utilization");
  return detailFromParts([
    fieldDetail("stage", stage),
    estimatedTokens && targetLimit ? `tokens=${estimatedTokens}/${targetLimit}` : "",
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
      text: "正在准备模型请求参数",
      detail: detailFromParts([
        fieldDetail("provider", provider),
        fieldDetail("timeout", timeoutMs ? `${timeoutMs}ms` : undefined),
      ]),
    };
  }
  if (tag === "execution") {
    return {
      stageId: "execution_done",
      text: "模型响应已返回，正在整理输出",
      detail: "formatting final answer",
    };
  }
  if (tag === "governance" || tag.startsWith("governance:")) {
    return {
      stageId: "governance",
      text: "正在执行治理与路由策略检查",
      detail: tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : undefined,
    };
  }
  if (tag === "runtime-route") {
    if (body.includes("all provider circuits are OPEN")) {
      return {
        stageId: "runtime_route_open_circuit",
        text: "所有模型通道暂不可用",
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
          ? `上游限流，${backoffMs}ms 后重试`
          : "上游限流，正在重试请求",
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
        text: "正在选择模型路由",
        detail: detailFromParts([
          fieldDetail("selected", selected),
          stickyHit === "true" ? "sticky=hit" : "",
          fieldDetail("strategy", strategy),
        ]),
      };
    }
    return {
      stageId: "runtime_route",
      text: "正在执行模型路由",
    };
  }
  if (tag === "context-engine") {
    if (event === "semantic_prefetch") {
      const status = extractField(body, "status");
      if (status === "applied") {
        return {
          stageId: "context_prefetch_applied",
          text: "正在补充语义证据",
          detail: fieldDetail("status", status),
        };
      }
      if (status === "warning" || status === "degraded") {
        return {
          stageId: "context_prefetch_degraded",
          text: "语义证据部分可用，继续执行",
          detail: fieldDetail("status", status),
          status: "warning",
        };
      }
      return {
        stageId: "context_prefetch",
        text: "正在尝试语义证据预取",
      };
    }
    if (event === "prompt_quality") {
      return {
        stageId: "context_quality",
        text: "正在评估提示词质量",
        detail: detailFromParts([
          fieldDetail("overall", extractField(body, "overall")),
          fieldDetail("coverage", extractField(body, "coverage")),
        ]),
      };
    }
    if (event === "graph_cache_stats") {
      return {
        stageId: "context_graph_cache",
        text: "正在校准上下文证据",
        detail: detailFromParts([
          fieldDetail("symbol", extractField(body, "quality_symbol_rows")),
          fieldDetail("deps", extractField(body, "quality_dependency_rows")),
        ]),
      };
    }
    if (event === "prompt_prepared" || event === "quality_guard_precompact" || event === "downshift_precompact") {
      return {
        stageId: "context_prepare",
        text: "正在整理上下文窗口",
        detail: promptBudgetDetail(body),
      };
    }
    if (event?.startsWith("pre_send_")) {
      return {
        stageId: "context_pre_send",
        text: "正在压缩上下文以适配预算",
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
        text: "正在执行上下文恢复策略",
        detail: detailFromParts([
          fieldDetail("provider", extractField(body, "provider")),
          fieldDetail("reason", extractField(body, "reason")),
          fieldDetail("retry", extractField(body, "retry")),
        ]),
      };
    }
    return {
      stageId: "context_engine",
      text: "正在构建上下文",
    };
  }
  if (tag === "ask-user") {
    if (event === "interrupt_received") {
      return {
        stageId: "ask_user_waiting",
        text: "等待你确认后继续执行",
        detail: "reply in prompt",
      };
    }
    if (event === "clarification_hint_injected") {
      return {
        stageId: "ask_user_clarify",
        text: "正在补充澄清提示",
        detail: "clarification context",
      };
    }
    return {
      stageId: "ask_user",
      text: "正在处理用户确认流程",
    };
  }
  if (tag === "plan-mode") {
    if (event === "enter_started") {
      return {
        stageId: "plan_enter_started",
        text: "正在进入计划模式",
      };
    }
    if (event === "draft_created") {
      return {
        stageId: "plan_draft_created",
        text: "计划草稿已创建，正在补充目标上下文",
      };
    }
    if (event === "progress_saved") {
      return {
        stageId: "plan_progress_saved",
        text: "正在记录你的补充要求",
      };
    }
    if (event === "model_planning") {
      return {
        stageId: "plan_model_planning",
        text: "Grobot 正在规划实现方案",
        detail: fieldDetail("phase", extractField(body, "phase")),
      };
    }
    if (event === "model_returned") {
      return {
        stageId: "plan_model_returned",
        text: "计划草稿已返回，正在保存",
      };
    }
    if (event === "proposed_plan_ingested") {
      return {
        stageId: "plan_file_updated",
        text: "正在更新计划文件",
      };
    }
    if (event === "review_started") {
      return {
        stageId: "plan_review_started",
        text: "正在检查计划是否可执行",
      };
    }
    if (event === "review_needs_refinement") {
      return {
        stageId: "plan_review_refinement",
        text: "计划需要补充细节",
        status: "warning",
      };
    }
    if (event === "plan_updated") {
      return {
        stageId: "plan_updated",
        text: "计划已更新，等待继续细化",
        status: "done",
      };
    }
    if (event === "approval_waiting") {
      return {
        stageId: "plan_approval_waiting",
        text: "等待你确认计划",
        detail: "approve or keep planning",
      };
    }
    if (event === "apply_review_started") {
      return {
        stageId: "plan_apply_review_started",
        text: "正在复核已批准计划",
      };
    }
    if (event === "apply_model_running") {
      return {
        stageId: "plan_apply_model_running",
        text: "正在执行已批准计划",
      };
    }
    if (event === "apply_finished") {
      return {
        stageId: "plan_apply_finished",
        text: "已按计划完成执行，正在收尾",
        status: "done",
      };
    }
    return {
      stageId: "plan_mode",
      text: "正在处理计划模式流程",
      detail: fieldDetail("event", event),
    };
  }
  if (tag === "experience" && event === "publish_skipped") {
    return {
      stageId: "experience_skip",
      text: "当前轮触发人工确认，跳过经验沉淀",
      detail: "ask-user pending",
    };
  }
  if (tag === "experience-pool" || tag === "experience-scheduler") {
    return {
      stageId: "experience_maintenance",
      text: "正在维护经验池与调度任务",
      detail: fieldDetail("event", event),
    };
  }
  if (tag === "memory-orchestrator") {
    return {
      stageId: "memory_maintenance",
      text: "正在维护记忆策略与质量窗口",
      detail: fieldDetail("event", event),
    };
  }
  if (tag === "interrupt") {
    return {
      stageId: "interrupt",
      text: "正在处理中断请求",
      detail: fieldDetail("event", event),
    };
  }
  if (tag === "reflection") {
    return {
      stageId: "reflection",
      text: "正在生成复盘建议",
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
    writeProgressLine(`[process] ${renderedProgress}\n`);
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
            ? "正在读取目标并准备计划上下文"
            : "正在读取任务并准备上下文"),
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
          text: "执行已中断",
          status: "warning",
        });
        return;
      }
      setActivity({
        stageId: "turn_finished_error",
        text: "执行失败，请查看错误输出",
        status: "error",
      });
    },
    consumeStderrChunk: (chunk): string => processChunk(chunk, true),
    observeStderrChunk: (chunk): void => {
      void processChunk(chunk, false);
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
