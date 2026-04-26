interface ActivityUpdate {
  stageId: string;
  text: string;
  status?: ActivityStatus;
}

export type ActivityKind =
  | "context"
  | "runtime"
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
  markTurnStart(): void;
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

function resolveProgressTextFromDiagnostic(tag: string, body: string): ActivityUpdate | undefined {
  const event = extractField(body, "event");
  if (tag === "runtime-model") {
    return {
      stageId: "runtime_model",
      text: "正在准备模型请求参数",
    };
  }
  if (tag === "execution") {
    return {
      stageId: "execution_done",
      text: "模型响应已返回，正在整理输出",
    };
  }
  if (tag === "governance" || tag.startsWith("governance:")) {
    return {
      stageId: "governance",
      text: "正在执行治理与路由策略检查",
    };
  }
  if (tag === "runtime-route") {
    if (body.includes("provider_retry")) {
      const backoffMs = extractField(body, "backoff_ms");
      return {
        stageId: "runtime_retry",
        text: backoffMs
          ? `上游限流，${backoffMs}ms 后重试`
          : "上游限流，正在重试请求",
      };
    }
    if (event === "decision") {
      return {
        stageId: "runtime_route_decision",
        text: "正在选择可用路由",
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
        };
      }
      if (status === "warning" || status === "degraded") {
        return {
          stageId: "context_prefetch_degraded",
          text: "语义证据部分可用，继续执行",
        };
      }
      return {
        stageId: "context_prefetch",
        text: "正在尝试语义证据预取",
      };
    }
    if (event === "prompt_prepared" || event === "quality_guard_precompact" || event === "downshift_precompact") {
      return {
        stageId: "context_prepare",
        text: "正在整理上下文窗口",
      };
    }
    if (event?.startsWith("pre_send_")) {
      return {
        stageId: "context_pre_send",
        text: "正在压缩上下文以适配预算",
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
      };
    }
    if (event === "clarification_hint_injected") {
      return {
        stageId: "ask_user_clarify",
        text: "正在补充澄清提示",
      };
    }
    return {
      stageId: "ask_user",
      text: "正在处理用户确认流程",
    };
  }
  if (tag === "experience" && event === "publish_skipped") {
    return {
      stageId: "experience_skip",
      text: "当前轮触发人工确认，跳过经验沉淀",
    };
  }
  if (tag === "experience-pool" || tag === "experience-scheduler") {
    return {
      stageId: "experience_maintenance",
      text: "正在维护经验池与调度任务",
    };
  }
  if (tag === "memory-orchestrator") {
    return {
      stageId: "memory_maintenance",
      text: "正在维护记忆策略与质量窗口",
    };
  }
  if (tag === "interrupt") {
    return {
      stageId: "interrupt",
      text: "正在处理中断请求",
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
    const nextSignature = `${next.stageId}:${next.text}`;
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
    writeProgressLine(`[process] ${next.text}\n`);
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
    markTurnStart: (): void => {
      setActivity({
        stageId: "turn_start",
        text: "已接收任务，正在执行",
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
