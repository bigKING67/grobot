#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";

const VERSION = "0.2.0-ga-cdp";
const CDP_DEFAULT_ENDPOINT = "http://127.0.0.1:9222";
const TMWD_LINK_DEFAULT_ENDPOINT = "http://127.0.0.1:18766/link";
const TMWD_WS_DEFAULT_ENDPOINT = "ws://127.0.0.1:18765";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_SCAN_MAX_CHARS = 35_000;
const SESSION_RETAIN_MS = 10 * 60 * 1000;
const NATIVE_INPUT_DEFAULT_TIMEOUT_MS = 8_000;
const NATIVE_INPUT_MAX_TIMEOUT_MS = 30_000;

let activeTargetId = "";
let defaultSessionId = "";
let latestSessionId = "";
const sessionRegistry = new Map();
const tmwdWsRuntime = {
  endpoint: "",
  socket: null,
  state: "idle",
  connectPromise: null,
  pending: new Map(),
  lastTabs: [],
};

const TOOL_SCHEMAS = {
    browser_scan: {
      description: "GA-style web_scan: tabs + simplified content from active tab.",
      inputSchema: {
        type: "object",
        properties: {
          tabs_only: { type: "boolean", default: false },
          switch_tab_id: { type: "string" },
          session_id: { type: "string" },
          session_url_pattern: { type: "string" },
          tmwd_mode: { type: "string", enum: ["auto", "tmwd", "cdp"], default: "auto" },
          tmwd_transport: { type: "string", enum: ["auto", "ws", "link"], default: "auto" },
          tmwd_ws_endpoint: { type: "string" },
          tmwd_link_endpoint: { type: "string" },
          text_only: { type: "boolean", default: false },
          main_only: { type: "boolean", default: false },
          main_only_fallback_to_full: { type: "boolean", default: true },
          main_only_min_chars: { type: "number", minimum: 100, maximum: 10_000 },
          main_only_min_coverage: { type: "number", minimum: 0.05, maximum: 0.95 },
          max_chars: { type: "number", minimum: 1_000, maximum: 300_000 },
          cdp_endpoint: { type: "string" },
        },
      },
  },
  browser_execute_js: {
    description: "GA-style web_execute_js via CDP bridge protocol (cmd=tabs/cookies/cdp/batch) or plain JS.",
    inputSchema: {
      type: "object",
        properties: {
          script: { type: "string" },
          code: { type: "string" },
          tab_id: { type: "string" },
          switch_tab_id: { type: "string" },
          session_id: { type: "string" },
          session_url_pattern: { type: "string" },
          tmwd_mode: { type: "string", enum: ["auto", "tmwd", "cdp"], default: "auto" },
          tmwd_transport: { type: "string", enum: ["auto", "ws", "link"], default: "auto" },
          tmwd_ws_endpoint: { type: "string" },
          tmwd_link_endpoint: { type: "string" },
          no_monitor: { type: "boolean", default: false },
          native_auto_fallback: { type: "boolean", default: false },
          native_auto_fallback_policy: {
            type: "string",
            enum: ["strict", "balanced", "aggressive"],
            default: "balanced",
          },
          native_auto_execute: { type: "boolean", default: false },
          native_execute_action_scope: {
            type: "string",
            enum: ["non_pointer", "all"],
            default: "non_pointer",
          },
          native_fallback_action: {
            type: "string",
            enum: [
              "activate_window",
              "move",
              "click",
              "double_click",
              "press",
              "type",
              "paste",
              "scroll",
              "get_window_rect",
            ],
          },
          native_fallback_args: { type: "object" },
          native_fallback_timeout_ms: { type: "number", minimum: 500, maximum: NATIVE_INPUT_MAX_TIMEOUT_MS },
          timeout_ms: { type: "number", minimum: 100, maximum: 120_000 },
          cdp_endpoint: { type: "string" },
          target_url_contains: { type: "string" },
        },
      anyOf: [
        { required: ["script"] },
        { required: ["code"] },
      ],
    },
  },
  browser_extract: {
    description: "Extract actionable nodes from html or active page html.",
    inputSchema: {
      type: "object",
        properties: {
          html: { type: "string" },
          selector_limit: { type: "number", minimum: 1, maximum: 300 },
          tmwd_mode: { type: "string", enum: ["auto", "tmwd", "cdp"], default: "auto" },
          tmwd_transport: { type: "string", enum: ["auto", "ws", "link"], default: "auto" },
          tmwd_ws_endpoint: { type: "string" },
          tmwd_link_endpoint: { type: "string" },
          cdp_endpoint: { type: "string" },
          switch_tab_id: { type: "string" },
          session_id: { type: "string" },
          session_url_pattern: { type: "string" },
        },
      },
    },
  browser_diff: {
    description: "Diff two HTML snapshots and return signatures.",
    inputSchema: {
      type: "object",
      properties: {
        before: { type: "string" },
        after: { type: "string" },
      },
      required: ["before", "after"],
    },
  },
  browser_tab_ops: {
    description: "Tab operations over CDP targets.",
    inputSchema: {
      type: "object",
      properties: {
          op: {
            type: "string",
            enum: ["list", "switch", "current", "list_sessions", "find_session", "set_session", "current_session"],
          },
          tab_id: { type: "string" },
          session_id: { type: "string" },
          url_pattern: { type: "string" },
          include_disconnected: { type: "boolean", default: false },
          tmwd_mode: { type: "string", enum: ["auto", "tmwd", "cdp"], default: "auto" },
          tmwd_transport: { type: "string", enum: ["auto", "ws", "link"], default: "auto" },
          tmwd_ws_endpoint: { type: "string" },
          tmwd_link_endpoint: { type: "string" },
          cdp_endpoint: { type: "string" },
        },
        required: ["op"],
      },
  },
  browser_native_input: {
    description: "Cross-platform native input fallback (Windows/macOS/Linux) for blocked browser cases.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "activate_window",
            "move",
            "click",
            "double_click",
            "press",
            "type",
            "paste",
            "scroll",
            "get_window_rect",
            "capabilities",
          ],
        },
        x: { type: "number" },
        y: { type: "number" },
        button: { type: "string", enum: ["left", "middle", "right"], default: "left" },
        key: { type: "string" },
        text: { type: "string" },
        delay_ms: { type: "number", minimum: 0, maximum: 10_000 },
        delta_x: { type: "number" },
        delta_y: { type: "number" },
        window_title: { type: "string" },
        window_pid: { type: "number" },
        dry_run: { type: "boolean", default: false },
        timeout_ms: { type: "number", minimum: 500, maximum: NATIVE_INPUT_MAX_TIMEOUT_MS },
      },
      required: ["action"],
    },
  },
};

function nowIso() {
  return new Date().toISOString();
}

function hashText(value) {
  return createHash("sha1").update(String(value ?? "")).digest("hex");
}

function randomId(prefix) {
  return `${String(prefix)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function compactText(value, maxLength) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}

function clipContent(value, maxChars) {
  const text = String(value ?? "");
  if (text.length <= maxChars) {
    return {
      value: text,
      truncated: false,
      original_length: text.length,
    };
  }
  return {
    value: `${text.slice(0, maxChars)}\n\n[TRUNCATED ${String(text.length - maxChars)} chars]`,
    truncated: true,
    original_length: text.length,
  };
}

function normalizeTimeoutMs(raw) {
  const parsed = Number(raw ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.max(100, Math.min(120_000, Math.floor(parsed)));
}

function normalizeMaxChars(raw) {
  const parsed = Number(raw ?? DEFAULT_SCAN_MAX_CHARS);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SCAN_MAX_CHARS;
  }
  return Math.max(1_000, Math.min(300_000, Math.floor(parsed)));
}

function normalizeMainOnlyMinChars(raw) {
  const parsed = Number(raw ?? 600);
  if (!Number.isFinite(parsed)) {
    return 600;
  }
  return Math.max(100, Math.min(10_000, Math.floor(parsed)));
}

function normalizeMainOnlyMinCoverage(raw) {
  const parsed = Number(raw ?? 0.35);
  if (!Number.isFinite(parsed)) {
    return 0.35;
  }
  return Math.max(0.05, Math.min(0.95, parsed));
}

function applyMainOnlyGuardrail(mainText, fullText, args) {
  const main = String(mainText ?? "");
  const full = String(fullText ?? "");
  const fallbackToFull = args?.main_only_fallback_to_full !== false;
  const minChars = normalizeMainOnlyMinChars(args?.main_only_min_chars);
  const minCoverage = normalizeMainOnlyMinCoverage(args?.main_only_min_coverage);
  const mainLength = main.length;
  const fullLength = full.length;
  const coverage = fullLength > 0 ? (mainLength / fullLength) : 1;

  const reasons = [];
  if (mainLength === 0) {
    reasons.push("empty_main");
  }
  if (mainLength > 0 && mainLength < minChars) {
    reasons.push("below_min_chars");
  }
  if (fullLength > 0 && coverage < minCoverage) {
    reasons.push("below_min_coverage");
  }
  if (fullLength === 0 && reasons.length > 0) {
    reasons.push("full_empty");
  }

  let fallbackApplied = false;
  let content = main;
  if (fallbackToFull && reasons.length > 0 && fullLength > 0) {
    fallbackApplied = true;
    content = full;
  }

  return {
    content,
    metadata: {
      enabled: true,
      fallback_to_full: fallbackToFull,
      fallback_applied: fallbackApplied,
      fallback_reason: reasons.length > 0 ? reasons.join("+") : "none",
      min_chars: minChars,
      min_coverage: minCoverage,
      main_length: mainLength,
      full_length: fullLength,
      main_coverage: Number(coverage.toFixed(4)),
      main_only_effective: !fallbackApplied,
    },
  };
}

function normalizeEndpoint(raw) {
  const endpoint = String(raw ?? CDP_DEFAULT_ENDPOINT).trim();
  if (!endpoint) {
    return CDP_DEFAULT_ENDPOINT;
  }
  return endpoint.replace(/\/$/, "");
}

function normalizeTmwdLinkEndpoint(raw) {
  const endpoint = String(raw ?? TMWD_LINK_DEFAULT_ENDPOINT).trim();
  if (!endpoint) {
    return TMWD_LINK_DEFAULT_ENDPOINT;
  }
  return endpoint.replace(/\/$/, "");
}

function normalizeTmwdWsEndpoint(raw) {
  const endpoint = String(raw ?? TMWD_WS_DEFAULT_ENDPOINT).trim();
  if (!endpoint) {
    return TMWD_WS_DEFAULT_ENDPOINT;
  }
  return endpoint;
}

function resolveTmwdMode(raw) {
  const normalized = String(raw ?? process.env.BROWSER_STRUCTURED_TMWD_MODE ?? "auto").trim().toLowerCase();
  if (normalized === "tmwd") {
    return "tmwd";
  }
  if (normalized === "cdp") {
    return "cdp";
  }
  return "auto";
}

function resolveTmwdTransport(raw) {
  const normalized = String(raw ?? process.env.BROWSER_STRUCTURED_TMWD_TRANSPORT ?? "auto").trim().toLowerCase();
  if (normalized === "ws") {
    return "ws";
  }
  if (normalized === "link") {
    return "link";
  }
  return "auto";
}

function parseObjectLiteral(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed;
    }
  } catch {
    // no-op
  }
  try {
    const value = Function(`"use strict"; return (${raw});`)();
    if (typeof value === "object" && value !== null) {
      return value;
    }
  } catch {
    // no-op
  }
  return undefined;
}

function parseBridgeCommand(script) {
  if (typeof script === "object" && script !== null && !Array.isArray(script)) {
    if (typeof script.cmd === "string" && script.cmd.trim().length > 0) {
      return script;
    }
    return undefined;
  }
  if (typeof script !== "string") {
    return undefined;
  }
  const trimmed = script.trim();
  if (!trimmed || !trimmed.startsWith("{")) {
    return undefined;
  }
  const parsed = parseObjectLiteral(trimmed);
  if (!parsed || typeof parsed.cmd !== "string" || parsed.cmd.trim().length === 0) {
    return undefined;
  }
  return parsed;
}

function resolveExecuteJsScriptInput(args) {
  const hasScript = Object.prototype.hasOwnProperty.call(args ?? {}, "script");
  const hasCode = Object.prototype.hasOwnProperty.call(args ?? {}, "code");
  if (hasScript) {
    return {
      source: "script",
      value: args?.script,
    };
  }
  if (hasCode) {
    return {
      source: "code",
      value: args?.code,
    };
  }
  return {
    source: "script",
    value: "",
  };
}

function normalizeTmwdTransportLabel(transport) {
  return transport === "ws" ? "tmwd_ws" : "tmwd_link";
}

function appendTransportAttempt(attempts, transport, phase, status, options = {}) {
  attempts.push({
    transport: normalizeTmwdTransportLabel(transport),
    phase,
    status,
    reason: options.reason,
    message: options.message,
    error_code: options.error_code,
  });
}

function shouldFallbackAcrossTmwdTransports(args, error) {
  const configuredTransport = resolveTmwdTransport(args?.tmwd_transport);
  if (configuredTransport === "link") {
    return false;
  }
  const message = String(error?.message ?? error ?? "");
  const code = classifyBrowserErrorCode(message);
  return isRetryableBrowserErrorCode(code);
}

function mergeTransportAttempts(primary, secondary) {
  const first = Array.isArray(primary) ? primary : [];
  const second = Array.isArray(secondary) ? secondary : [];
  return [...first, ...second];
}

function extractActionableNodes(html, limit) {
  const text = String(html ?? "");
  const pattern = /<(a|button|input|select|textarea)[^>]*>(.*?)<\/\1>|<(input|select|textarea)[^>]*\/?>/gims;
  const nodes = [];
  let match = pattern.exec(text);
  while (match && nodes.length < limit) {
    const raw = match[0] ?? "";
    const tag = (match[1] || match[3] || "unknown").toLowerCase();
    const content = match[2] ?? "";
    const nodeText = compactText(content.replace(/<[^>]+>/g, " "), 120);
    const id = `${tag}_${hashText(raw).slice(0, 10)}`;
    nodes.push({
      id,
      role: tag,
      text: nodeText,
      selector: `${tag}[data-ga-node="${id}"]`,
    });
    match = pattern.exec(text);
  }
  return nodes;
}

function makeResult(payload) {
  return {
    content: [
      {
        type: "json",
        json: payload,
      },
    ],
  };
}

function makeErrorPayload(tool, error) {
  const message = String(error?.message ?? error ?? "unknown error");
  const explicitErrorCode = typeof error?.errorCode === "string" ? error.errorCode.trim() : "";
  const errorCode = explicitErrorCode || classifyBrowserErrorCode(message);
  const retryable = typeof error?.retryable === "boolean"
    ? error.retryable
    : isRetryableBrowserErrorCode(errorCode);
  const transportAttempts = Array.isArray(error?.transportAttempts)
    ? error.transportAttempts
    : undefined;
  const errorDetails = (
    typeof error?.details === "object"
    && error.details !== null
    && !Array.isArray(error.details)
  )
    ? error.details
    : undefined;
  return {
    isError: true,
    content: [
      {
        type: "json",
        json: {
          status: "error",
          tool,
          error: message,
          error_code: errorCode,
          retryable,
          transport_attempts: transportAttempts,
          details: errorDetails,
          at: nowIso(),
        },
      },
    ],
  };
}

function classifyBrowserErrorCode(message) {
  const normalized = String(message ?? "").toLowerCase();
  if (
    normalized.includes("tmwd ws connection failed")
    || normalized.includes("no active extension websocket")
    || normalized.includes("tmwd ws is not connected")
    || normalized.includes("extension websocket closed")
  ) {
    return "NO_EXTENSION";
  }
  if (
    normalized.includes("no active session available")
    || normalized.includes("get_all_sessions returned empty")
    || normalized.includes("tmwd ws tabs returned empty")
    || normalized.includes("no cdp page targets found")
    || normalized.includes("tab not found")
  ) {
    return "NO_SESSION";
  }
  if (normalized.includes("timeout")) {
    return "TIMEOUT";
  }
  if (
    normalized.includes("content security policy")
    || (normalized.includes("csp") && normalized.includes("violat"))
  ) {
    return "CSP_BLOCKED";
  }
  if (
    normalized.includes("cdp")
    && (normalized.includes("not allowed") || normalized.includes("permission denied"))
  ) {
    return "CDP_DENIED";
  }
  if (
    normalized.includes("tmwd context unavailable")
    || normalized.includes("no transport succeeded")
    || normalized.includes("transport unavailable")
  ) {
    return "TRANSPORT_UNAVAILABLE";
  }
  if (
    normalized.includes("platform permission required")
    || normalized.includes("accessibility permission")
    || normalized.includes("apple events")
    || normalized.includes("not authorized")
  ) {
    return "PLATFORM_PERMISSION_REQUIRED";
  }
  if (
    normalized.includes("display backend unsupported")
    || normalized.includes("cannot open display")
    || normalized.includes("wayland session")
  ) {
    return "DISPLAY_BACKEND_UNSUPPORTED";
  }
  if (normalized.includes("window not found")) {
    return "WINDOW_NOT_FOUND";
  }
  if (normalized.includes("coordinate out of range")) {
    return "COORDINATE_OUT_OF_RANGE";
  }
  if (normalized.includes("action not supported")) {
    return "ACTION_NOT_SUPPORTED";
  }
  if (normalized.includes("native input execution failed")) {
    return "NATIVE_INPUT_EXECUTION_FAILED";
  }
  return "EXECUTION_ERROR";
}

function isRetryableBrowserErrorCode(code) {
  return code === "NO_EXTENSION"
    || code === "NO_SESSION"
    || code === "TIMEOUT"
    || code === "TRANSPORT_UNAVAILABLE";
}

function withTransportAttempts(error, attempts) {
  if (typeof error === "object" && error !== null) {
    error.transportAttempts = [...attempts];
  }
  return error;
}

function normalizeIdToken(raw) {
  const value = String(raw ?? "").trim();
  return value.length > 0 ? value : "";
}

function sessionPointers() {
  return {
    active_session_id: activeTargetId || null,
    default_session_id: defaultSessionId || null,
    latest_session_id: latestSessionId || null,
  };
}

function pruneDisconnectedSessions(nowMs) {
  for (const [sessionId, record] of sessionRegistry.entries()) {
    if (!record.disconnect_at) {
      continue;
    }
    const disconnectedAtMs = Date.parse(record.disconnect_at);
    if (!Number.isFinite(disconnectedAtMs)) {
      continue;
    }
    if (nowMs - disconnectedAtMs > SESSION_RETAIN_MS) {
      sessionRegistry.delete(sessionId);
    }
  }
}

function syncSessionRegistry(targets) {
  const nowIsoValue = nowIso();
  const nowMs = Date.now();
  const targetIds = new Set(targets.map((item) => item.id));
  for (const [sessionId, record] of sessionRegistry.entries()) {
    if (targetIds.has(sessionId)) {
      continue;
    }
    if (!record.disconnect_at) {
      sessionRegistry.set(sessionId, {
        ...record,
        disconnect_at: nowIsoValue,
      });
    }
  }
  for (const target of targets) {
    const existing = sessionRegistry.get(target.id);
    if (!existing) {
      sessionRegistry.set(target.id, {
        id: target.id,
        url: target.url,
        title: target.title,
        type: "ext_ws",
        connected_at: nowIsoValue,
        disconnect_at: null,
      });
      latestSessionId = target.id;
      if (!defaultSessionId) {
        defaultSessionId = target.id;
      }
      continue;
    }
    sessionRegistry.set(target.id, {
      ...existing,
      url: target.url,
      title: target.title,
      disconnect_at: null,
    });
    latestSessionId = target.id;
  }
  pruneDisconnectedSessions(nowMs);
  if (!defaultSessionId || !targetIds.has(defaultSessionId)) {
    const fallback = targets.find((item) => item.active) ?? targets[0];
    defaultSessionId = fallback?.id ?? "";
  }
  if (!activeTargetId || !targetIds.has(activeTargetId)) {
    activeTargetId = defaultSessionId || targets[0]?.id || "";
  }
}

function listSessionsSnapshot(options = {}) {
  const includeDisconnected = options.include_disconnected === true;
  const rows = [];
  for (const record of sessionRegistry.values()) {
    const active = record.disconnect_at === null;
    if (!includeDisconnected && !active) {
      continue;
    }
    rows.push({
      id: record.id,
      url: record.url,
      title: record.title,
      type: record.type,
      active,
      connected_at: record.connected_at,
      disconnect_at: record.disconnect_at,
      is_default: record.id === defaultSessionId,
      is_latest: record.id === latestSessionId,
    });
  }
  rows.sort((left, right) => {
    if (left.active !== right.active) {
      return left.active ? -1 : 1;
    }
    if (left.is_default !== right.is_default) {
      return left.is_default ? -1 : 1;
    }
    return left.id.localeCompare(right.id);
  });
  return rows;
}

function resolveSessionByPattern(targets, pattern) {
  const normalized = String(pattern ?? "").trim();
  if (!normalized) {
    return [];
  }
  return targets.filter((item) => item.url.includes(normalized) || item.title.includes(normalized));
}

function markSessionSelected(sessionId, options = {}) {
  const normalizedSessionId = normalizeIdToken(sessionId);
  if (!normalizedSessionId) {
    return;
  }
  activeTargetId = normalizedSessionId;
  latestSessionId = normalizedSessionId;
  if (options.make_default === true || !defaultSessionId) {
    defaultSessionId = normalizedSessionId;
  }
}

function selectTargetFromCandidates(targets, args) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("no candidate targets");
  }
  const explicitTabId = normalizeIdToken(args?.switch_tab_id ?? args?.tab_id ?? args?.tabId);
  const explicitSessionId = normalizeIdToken(args?.session_id ?? args?.sessionId);
  const explicitSessionPattern = String(args?.session_url_pattern ?? args?.url_pattern ?? "").trim();
  const urlHint = String(args?.target_url_contains ?? "").trim();
  let selected = null;
  let selectedBy = "";
  let selectionWarning = "";
  if (explicitTabId) {
    selected = targets.find((item) => item.id === explicitTabId) ?? null;
    if (!selected) {
      throw new Error(`tab not found: ${explicitTabId}`);
    }
    selectedBy = "tab_id";
  }
  if (!selected && explicitSessionId) {
    selected = targets.find((item) => item.id === explicitSessionId) ?? null;
    if (selected) {
      selectedBy = "session_id";
    }
  }
  if (!selected && explicitSessionPattern) {
    const matched = resolveSessionByPattern(targets, explicitSessionPattern);
    if (matched.length > 0) {
      selected = matched[0];
      selectedBy = "session_url_pattern";
    }
  }
  if (!selected && urlHint) {
    selected = targets.find((item) => item.url.includes(urlHint)) ?? null;
    if (selected) {
      selectedBy = "target_url_contains";
    }
  }
  if (!selected && activeTargetId) {
    selected = targets.find((item) => item.id === activeTargetId) ?? null;
    if (selected) {
      selectedBy = "active_target";
    }
  }
  if (!selected && defaultSessionId) {
    selected = targets.find((item) => item.id === defaultSessionId) ?? null;
    if (selected) {
      selectedBy = "default_session";
    }
  }
  if (!selected) {
    selected = targets.find((item) => item.active) ?? targets[0];
    selectedBy = selected?.active ? "browser_active" : "first_target";
  }
  if (!selected) {
    throw new Error("no target selected");
  }
  if (explicitSessionId && selected.id !== explicitSessionId) {
    selectionWarning = `session_id=${explicitSessionId} unavailable, fallback=${selected.id}`;
    defaultSessionId = selected.id;
  }
  return {
    target: selected,
    selection: {
      selected_by: selectedBy || "unknown",
      warning: selectionWarning || undefined,
    },
  };
}

function normalizeTmwdTabsPayload(raw) {
  if (Array.isArray(raw)) {
    return normalizeTmwdSessions(raw);
  }
  if (raw && typeof raw === "object" && Array.isArray(raw.data)) {
    return normalizeTmwdSessions(raw.data);
  }
  return [];
}

function clearTmwdWsPending(errorMessage) {
  for (const [, pending] of tmwdWsRuntime.pending) {
    clearTimeout(pending.timer);
    pending.reject(new Error(errorMessage));
  }
  tmwdWsRuntime.pending.clear();
}

function closeTmwdWsConnection(reason) {
  if (tmwdWsRuntime.socket) {
    try {
      tmwdWsRuntime.socket.close();
    } catch {
      // no-op
    }
  }
  tmwdWsRuntime.socket = null;
  tmwdWsRuntime.state = "idle";
  tmwdWsRuntime.connectPromise = null;
  if (reason) {
    clearTmwdWsPending(reason);
  }
}

function onTmwdWsMessage(eventData) {
  let payload;
  try {
    payload = JSON.parse(String(eventData));
  } catch {
    return;
  }
  if (!payload || typeof payload !== "object") {
    return;
  }
  if (payload.type === "ext_ready" || payload.type === "tabs_update") {
    const tabs = normalizeTmwdTabsPayload(payload.tabs ?? payload.result ?? payload.data);
    if (tabs.length > 0) {
      tmwdWsRuntime.lastTabs = tabs;
      syncSessionRegistry(tabs);
    }
    return;
  }
  const responseId = String(payload.id ?? "").trim();
  if (!responseId) {
    return;
  }
  const pending = tmwdWsRuntime.pending.get(responseId);
  if (!pending) {
    return;
  }
  tmwdWsRuntime.pending.delete(responseId);
  clearTimeout(pending.timer);
  if (payload.type === "error") {
    pending.resolve({
      success: false,
      error: payload.error ?? "tmwd ws returned error",
      result: payload.result,
      newTabs: Array.isArray(payload.newTabs) ? payload.newTabs : [],
    });
    return;
  }
  pending.resolve({
    success: true,
    result: payload.result,
    error: payload.error,
    newTabs: Array.isArray(payload.newTabs) ? payload.newTabs : [],
  });
}

async function connectTmwdWs(args, options = {}) {
  const endpoint = normalizeTmwdWsEndpoint(args?.tmwd_ws_endpoint ?? process.env.BROWSER_STRUCTURED_TMWD_WS_ENDPOINT);
  const connectTimeoutMs = options.probe === true ? 1_500 : 5_000;
  if (
    tmwdWsRuntime.socket
    && tmwdWsRuntime.state === "open"
    && tmwdWsRuntime.endpoint === endpoint
    && tmwdWsRuntime.socket.readyState === WebSocket.OPEN
  ) {
    return endpoint;
  }
  if (tmwdWsRuntime.connectPromise && tmwdWsRuntime.endpoint === endpoint) {
    await tmwdWsRuntime.connectPromise;
    return endpoint;
  }
  if (tmwdWsRuntime.endpoint && tmwdWsRuntime.endpoint !== endpoint) {
    closeTmwdWsConnection("tmwd ws endpoint changed");
  }
  tmwdWsRuntime.endpoint = endpoint;
  tmwdWsRuntime.state = "connecting";
  const connectPromise = new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket.close();
      } catch {
        // no-op
      }
      reject(new Error(`tmwd ws connect timeout after ${String(connectTimeoutMs)}ms`));
    }, connectTimeoutMs);
    const finishResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(undefined);
    };
    const finishReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    socket.addEventListener("open", () => {
      tmwdWsRuntime.socket = socket;
      tmwdWsRuntime.state = "open";
      finishResolve();
    }, { once: true });
    socket.addEventListener("message", (event) => {
      onTmwdWsMessage(event.data);
    });
    socket.addEventListener("close", () => {
      const reason = "tmwd ws closed";
      if (tmwdWsRuntime.socket === socket) {
        closeTmwdWsConnection(reason);
      }
      if (tmwdWsRuntime.state === "connecting") {
        finishReject(new Error(reason));
      }
    });
    socket.addEventListener("error", (event) => {
      const detail = String(event?.message ?? "").trim();
      const reason = detail.length > 0
        ? `tmwd ws error: ${detail}`
        : `tmwd ws connection failed endpoint=${endpoint}`;
      if (tmwdWsRuntime.socket === socket) {
        closeTmwdWsConnection(reason);
      }
      if (tmwdWsRuntime.state === "connecting") {
        finishReject(new Error(reason));
      }
    });
  });
  tmwdWsRuntime.connectPromise = connectPromise;
  try {
    await connectPromise;
    return endpoint;
  } finally {
    if (tmwdWsRuntime.connectPromise === connectPromise) {
      tmwdWsRuntime.connectPromise = null;
    }
    if (tmwdWsRuntime.state === "connecting") {
      tmwdWsRuntime.state = "idle";
    }
  }
}

async function sendTmwdWsRequest(args, payload, timeoutMs) {
  await connectTmwdWs(args, { probe: false });
  const socket = tmwdWsRuntime.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("tmwd ws is not connected");
  }
  const requestId = randomId("tmwd_ws");
  const requestTimeoutMs = Math.max(500, timeoutMs);
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      tmwdWsRuntime.pending.delete(requestId);
      reject(new Error(`tmwd ws request timeout id=${requestId}`));
    }, requestTimeoutMs);
    tmwdWsRuntime.pending.set(requestId, {
      resolve,
      reject,
      timer,
    });
  });
  socket.send(JSON.stringify({
    id: requestId,
    tabId: payload.tabId,
    code: payload.code,
  }));
  return promise;
}

async function listTmwdWsSessions(args, options = {}) {
  const timeoutMs = options.probe === true ? 1_500 : Math.min(10_000, normalizeTimeoutMs(args?.timeout_ms));
  await connectTmwdWs(args, { probe: options.probe === true });
  const response = await sendTmwdWsRequest(args, {
    code: { cmd: "tabs" },
  }, timeoutMs);
  if (!response.success) {
    throw new Error(String(response.error ?? "tmwd ws tabs failed"));
  }
  const tabs = normalizeTmwdTabsPayload(response.result);
  if (tabs.length > 0) {
    tmwdWsRuntime.lastTabs = tabs;
    syncSessionRegistry(tabs);
  }
  return tabs.length > 0 ? tabs : [...tmwdWsRuntime.lastTabs];
}

async function callTmwdLink(args, payload, timeoutMsOverride) {
  const endpoint = normalizeTmwdLinkEndpoint(args?.tmwd_link_endpoint ?? process.env.BROWSER_STRUCTURED_TMWD_LINK_ENDPOINT);
  const timeoutMs = timeoutMsOverride ?? Math.min(15_000, normalizeTimeoutMs(args?.timeout_ms));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`tmwd link failed status=${String(response.status)}`);
    }
    const parsed = await response.json();
    if (typeof parsed !== "object" || parsed === null || !("r" in parsed)) {
      throw new Error("tmwd link returned invalid payload");
    }
    return {
      endpoint,
      value: parsed.r,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`tmwd link timeout after ${String(timeoutMs)}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTmwdSessions(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }
      const id = normalizeIdToken(item.id ?? item.sessionId);
      if (!id) {
        return null;
      }
      return {
        id,
        title: String(item.title ?? ""),
        url: String(item.url ?? ""),
        active: true,
        type: String(item.type ?? "ext_ws"),
      };
    })
    .filter((item) => item !== null);
}

async function resolveTmwdContextViaLink(args, options = {}) {
  const timeoutMs = options.probe === true
    ? Math.min(1_500, normalizeTimeoutMs(args?.timeout_ms))
    : undefined;
  const tmwd = await callTmwdLink(args, { cmd: "get_all_sessions" }, timeoutMs);
  const targets = normalizeTmwdSessions(tmwd.value);
  if (targets.length === 0) {
    throw new Error("tmwd get_all_sessions returned empty");
  }
  syncSessionRegistry(targets);
  const picked = selectTargetFromCandidates(targets, args);
  markSessionSelected(picked.target.id, { make_default: false });
  return {
    endpoint: tmwd.endpoint,
    tmwd_transport: "link",
    targets,
    target: picked.target,
    selection: picked.selection,
    sessions: listSessionsSnapshot(),
    ...sessionPointers(),
  };
}

async function resolveTmwdContextViaWs(args, options = {}) {
  const targets = await listTmwdWsSessions(args, { probe: options.probe === true });
  if (targets.length === 0) {
    throw new Error("tmwd ws tabs returned empty");
  }
  syncSessionRegistry(targets);
  const picked = selectTargetFromCandidates(targets, args);
  markSessionSelected(picked.target.id, { make_default: false });
  return {
    endpoint: normalizeTmwdWsEndpoint(args?.tmwd_ws_endpoint ?? process.env.BROWSER_STRUCTURED_TMWD_WS_ENDPOINT),
    tmwd_transport: "ws",
    targets,
    target: picked.target,
    selection: picked.selection,
    sessions: listSessionsSnapshot(),
    ...sessionPointers(),
  };
}

async function resolveTmwdContext(args, options = {}) {
  const transport = resolveTmwdTransport(args?.tmwd_transport);
  const attempts = [];
  if (transport !== "link") {
    try {
      const resolved = await resolveTmwdContextViaWs(args, options);
      return {
        ...resolved,
        transport_attempts: [
          ...attempts,
          { transport: "ws", status: "ok" },
        ],
      };
    } catch (error) {
      attempts.push({
        transport: "ws",
        status: "error",
        message: String(error?.message ?? error),
      });
      if (transport === "ws") {
        throw withTransportAttempts(error, attempts);
      }
    }
  }
  if (transport !== "ws") {
    try {
      const resolved = await resolveTmwdContextViaLink(args, options);
      return {
        ...resolved,
        transport_attempts: [
          ...attempts,
          { transport: "link", status: "ok" },
        ],
      };
    } catch (error) {
      attempts.push({
        transport: "link",
        status: "error",
        message: String(error?.message ?? error),
      });
      if (transport === "link") {
        throw withTransportAttempts(error, attempts);
      }
    }
  }
  const summary = attempts
    .filter((item) => item.status === "error")
    .map((item) => `${item.transport}=${item.message}`)
    .join("; ");
  const error = new Error(`tmwd context unavailable (${summary || "no transport succeeded"})`);
  withTransportAttempts(error, attempts);
  throw error;
}

async function resolvePreferredBrowserContext(args) {
  const mode = resolveTmwdMode(args?.tmwd_mode);
  if (mode === "cdp") {
    const context = await resolveTarget(args);
    return {
      transport: "cdp",
      context,
      transport_attempts: [
        { transport: "cdp", status: "ok", reason: "forced_mode" },
      ],
    };
  }
  try {
    const context = await resolveTmwdContext(args, { probe: mode === "auto" });
    return {
      transport: context.tmwd_transport === "ws" ? "tmwd_ws" : "tmwd_link",
      context,
      transport_attempts: Array.isArray(context.transport_attempts) ? context.transport_attempts : [],
    };
  } catch (error) {
    const attempts = Array.isArray(error?.transportAttempts)
      ? [...error.transportAttempts]
      : [];
    if (mode === "tmwd") {
      throw withTransportAttempts(error, attempts);
    }
    const context = await resolveTarget(args);
    return {
      transport: "cdp",
      context,
      transport_attempts: [
        ...attempts,
        { transport: "cdp", status: "ok", reason: "auto_fallback" },
      ],
    };
  }
}

async function executeTmwdJs(args, tmwdContext, code) {
  const timeoutMs = normalizeTimeoutMs(args?.timeout_ms);
  if (tmwdContext.tmwd_transport === "ws") {
    const codePayload = typeof code === "object" && code !== null
      ? { tabId: tmwdContext.target.id, ...code }
      : String(code ?? "");
    const response = await sendTmwdWsRequest(
      {
        ...args,
        tmwd_ws_endpoint: tmwdContext.endpoint,
      },
      {
        tabId: tmwdContext.target.id,
        code: codePayload,
      },
      Math.min(20_000, timeoutMs + 2_000),
    );
    const raw = response.success
      ? { ok: true, data: response.result, newTabs: response.newTabs }
      : { ok: false, error: response.error, result: response.result, newTabs: response.newTabs };
    if (!response.success) {
      return {
        raw,
        value: response.result,
        newTabs: Array.isArray(response.newTabs) ? response.newTabs : [],
      };
    }
    if (raw.data && typeof raw.data === "object" && raw.data !== null && "ok" in raw.data) {
      return {
        raw: raw.data,
        value: raw.data.data ?? raw.data.results ?? raw.data,
        newTabs: Array.isArray(response.newTabs) ? response.newTabs : [],
      };
    }
    return {
      raw,
      value: response.result,
      newTabs: Array.isArray(response.newTabs) ? response.newTabs : [],
    };
  }
  const timeoutSecs = Number((timeoutMs / 1000).toFixed(2));
  const exec = await callTmwdLink(
    {
      ...args,
      tmwd_link_endpoint: tmwdContext.endpoint,
    },
    {
      cmd: "execute_js",
      sessionId: tmwdContext.target.id,
      code,
      timeout: String(timeoutSecs),
    },
    Math.min(20_000, timeoutMs + 2_000),
  );
  const raw = exec.value;
  if (raw && typeof raw === "object" && typeof raw.error === "string" && raw.error.length > 0) {
    throw new Error(raw.error);
  }
  return {
    raw,
    value: raw?.data ?? raw?.result ?? raw,
    newTabs: Array.isArray(raw?.newTabs) ? raw.newTabs : [],
  };
}

async function resolveTmwdContextWithTransport(args, transport, sessionIdHint) {
  const contextArgs = {
    ...args,
    session_id: sessionIdHint || normalizeIdToken(args?.session_id ?? args?.sessionId),
    tmwd_transport: transport,
  };
  if (transport === "ws") {
    return resolveTmwdContextViaWs(contextArgs, { probe: false });
  }
  return resolveTmwdContextViaLink(contextArgs, { probe: false });
}

async function executeTmwdJsWithFallback(args, tmwdContext, codePayload) {
  const attempts = [];
  const initialTransport = tmwdContext.tmwd_transport === "ws" ? "ws" : "link";
  const runExecute = async (context, transport, reason) => {
    try {
      const executed = await executeTmwdJs(
        {
          ...args,
          session_id: context.target.id,
        },
        context,
        codePayload,
      );
      appendTransportAttempt(attempts, transport, "execute", "ok", { reason });
      return {
        executed,
        context,
      };
    } catch (error) {
      appendTransportAttempt(attempts, transport, "execute", "error", {
        reason,
        message: String(error?.message ?? error),
        error_code: classifyBrowserErrorCode(String(error?.message ?? error)),
      });
      throw error;
    }
  };

  try {
    const first = await runExecute(tmwdContext, initialTransport, "primary");
    return {
      ...first,
      transport_attempts: attempts,
    };
  } catch (primaryError) {
    if (!shouldFallbackAcrossTmwdTransports(args, primaryError)) {
      throw withTransportAttempts(primaryError, attempts);
    }
    const fallbackTransport = initialTransport === "ws" ? "link" : "ws";
    let fallbackContext;
    try {
      fallbackContext = await resolveTmwdContextWithTransport(args, fallbackTransport, tmwdContext.target.id);
      appendTransportAttempt(attempts, fallbackTransport, "resolve_context", "ok", {
        reason: "fallback_after_primary_error",
      });
    } catch (resolveError) {
      appendTransportAttempt(attempts, fallbackTransport, "resolve_context", "error", {
        reason: "fallback_after_primary_error",
        message: String(resolveError?.message ?? resolveError),
        error_code: classifyBrowserErrorCode(String(resolveError?.message ?? resolveError)),
      });
      throw withTransportAttempts(resolveError, attempts);
    }
    try {
      const retried = await runExecute(fallbackContext, fallbackTransport, "fallback_after_primary_error");
      return {
        ...retried,
        transport_attempts: attempts,
      };
    } catch (fallbackError) {
      throw withTransportAttempts(fallbackError, attempts);
    }
  }
}

async function fetchCdpTargets(endpoint) {
  const response = await fetch(`${endpoint}/json/list`);
  if (!response.ok) {
    throw new Error(`cdp /json/list failed status=${String(response.status)}`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("cdp /json/list returned invalid payload");
  }
  return data
    .filter((item) => item?.type === "page" && typeof item?.webSocketDebuggerUrl === "string")
    .map((item) => ({
      id: String(item.id ?? ""),
      title: String(item.title ?? ""),
      url: String(item.url ?? ""),
      webSocketDebuggerUrl: String(item.webSocketDebuggerUrl),
      active: item.active === true,
    }))
    .filter((item) => item.id.length > 0 && item.webSocketDebuggerUrl.length > 0);
}

async function resolveTarget(args) {
  const endpoint = normalizeEndpoint(args?.cdp_endpoint);
  const targets = await fetchCdpTargets(endpoint);
  if (targets.length === 0) {
    throw new Error("no CDP page targets found");
  }
  syncSessionRegistry(targets);
  const picked = selectTargetFromCandidates(targets, args);
  const selected = picked.target;
  markSessionSelected(selected.id, { make_default: false });
  return {
    endpoint,
    targets,
    target: selected,
    selection: picked.selection,
    sessions: listSessionsSnapshot(),
    pointers: sessionPointers(),
  };
}

function waitForWebSocketOpen(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`cdp websocket open timeout after ${String(timeoutMs)}ms`));
    }, timeoutMs);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(new Error(String(event?.message || "websocket error")));
    }, { once: true });
  });
}

function createCdpClient(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 1;

  const rejectAllPending = (error) => {
    for (const [, deferred] of pending) {
      deferred.reject(error);
    }
    pending.clear();
  };

  socket.addEventListener("message", (event) => {
    let payload;
    try {
      payload = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object") {
      return;
    }
    const id = payload.id;
    if (typeof id !== "number") {
      return;
    }
    const deferred = pending.get(id);
    if (!deferred) {
      return;
    }
    pending.delete(id);
    if (payload.error) {
      deferred.reject(new Error(String(payload.error.message ?? "cdp command failed")));
      return;
    }
    deferred.resolve(payload.result ?? {});
  });

  socket.addEventListener("close", () => {
    rejectAllPending(new Error("cdp websocket closed"));
  });

  socket.addEventListener("error", () => {
    rejectAllPending(new Error("cdp websocket error"));
  });

  return {
    async connect(timeoutMs) {
      await waitForWebSocketOpen(socket, timeoutMs);
    },
    send(method, params = {}, timeoutMs = 10_000) {
      const id = seq;
      seq += 1;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`cdp command timeout method=${method}`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      try {
        socket.close();
      } catch {
        // no-op
      }
    },
  };
}

function buildExecScript(code, errorHandler) {
  return `(async () => {
  function smartProcessResult(result) {
    if (result === null || result === undefined || typeof result !== 'object') return result;
    try { if (result.window === result && result.document) return '[Window: ' + (result.location?.href || 'about:blank') + ']'; } catch(_) {}
    if (result instanceof NodeList || result instanceof HTMLCollection) {
      const elements = [];
      for (let i = 0; i < result.length; i += 1) {
        if (result[i] && result[i].nodeType === 1) elements.push(result[i].outerHTML);
      }
      return elements;
    }
    if (result.nodeType === 1) return result.outerHTML;
    try {
      return JSON.parse(JSON.stringify(result, function(_, value) {
        if (typeof value === 'object' && value !== null) {
          if (value.nodeType === 1) return value.outerHTML;
          if (value === window || value === document) return '[Object]';
          try { if (value.window === value && value.document) return '[Window]'; } catch(_) {}
        }
        return value;
      }));
    } catch (e) {
      return '[无法序列化: ' + e.message + ']';
    }
  }
  try {
    const jsCode = ${JSON.stringify(code)}.trim();
    const lines = jsCode.split(/\\r?\\n/).filter((l) => l.trim());
    const lastLine = lines.length > 0 ? lines[lines.length - 1].trim() : '';
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    let r;
    function _air(c) {
      const ls = c.split(/\\r?\\n/);
      let i = ls.length - 1;
      while (i >= 0 && !ls[i].trim()) i -= 1;
      if (i < 0) return c;
      const t = ls[i].trim();
      if (/^(return |return;|return$|let |const |var |if |if\\(|for |for\\(|while |while\\(|switch|try |throw |class |function |async |import |export |\\/\\/|})/.test(t)) return c;
      ls[i] = ls[i].match(/^(\\s*)/)[1] + 'return ' + t;
      return ls.join('\\n');
    }
    if (lastLine.startsWith('return')) {
      r = await (new AsyncFunction(jsCode))();
    } else {
      try {
        r = eval(jsCode);
        if (r instanceof Promise) r = await r;
      } catch (e) {
        if (e instanceof SyntaxError && (/return/i.test(e.message) || /await/i.test(e.message))) {
          r = await (new AsyncFunction(_air(jsCode)))();
        } else {
          throw e;
        }
      }
    }
    return { ok: true, data: smartProcessResult(r) };
  } catch (e) {
${errorHandler}
  }
})()`;
}

function buildCdpScript(code) {
  return buildExecScript(code, `    return { ok: false, error: { name: e.name || 'Error', message: e.message || String(e), stack: e.stack || '' } };`);
}

async function withTargetClient(args, operation) {
  const timeoutMs = normalizeTimeoutMs(args?.timeout_ms);
  const resolved = await resolveTarget(args);
  const client = createCdpClient(resolved.target.webSocketDebuggerUrl);
  await client.connect(Math.min(timeoutMs, 10_000));
  try {
    const result = await operation(client, resolved.target, resolved.endpoint, timeoutMs, resolved);
    return {
      ...resolved,
      result,
    };
  } finally {
    client.close();
  }
}

async function cdpEvaluateScript(args, script) {
  return withTargetClient(args, async (client, target, endpoint, timeoutMs, resolved) => {
    await client.send("Runtime.enable", {}, Math.min(timeoutMs, 10_000));
    const wrappedCode = buildCdpScript(script);
    const evalResult = await client.send("Runtime.evaluate", {
      expression: wrappedCode,
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs);
    if (evalResult?.exceptionDetails) {
      const description = evalResult.exceptionDetails?.exception?.description
        || evalResult.exceptionDetails?.text
        || "CDP Runtime.evaluate failed";
      throw new Error(String(description));
    }
      return {
        target_id: target.id,
        target_url: target.url,
        endpoint,
        value: evalResult?.result?.value,
        type: evalResult?.result?.type ?? typeof evalResult?.result?.value,
        selection: resolved.selection,
        sessions: resolved.sessions,
        ...sessionPointers(),
      };
    });
  }

function buildScanContentExpression(textOnly, mainOnly) {
  if (textOnly && mainOnly) {
    return `(() => {
      const selectors = 'main, article, [role="main"], #main, .main-content, .content, .mdx-content, .markdown-body, .prose, [data-doc-main]';
      const direct = document.querySelector(selectors);
      if (direct) {
        const text = (direct.innerText || '').trim();
        if (text.length >= 200) {
          return text;
        }
      }
      const clone = document.body ? document.body.cloneNode(true) : null;
      if (!clone) {
        return document.documentElement ? (document.documentElement.innerText || '') : '';
      }
      clone.querySelectorAll('nav, header, footer, aside, script, style, noscript, form, [role="navigation"], [data-testid*="nav"], [class*="sidebar"], [class*="toc"], [class*="breadcrumb"]').forEach((node) => node.remove());
      const stripped = (clone.innerText || '').trim();
      if (stripped.length >= 200) {
        return stripped;
      }
      const root = document.body || document.documentElement;
      return root ? (root.innerText || '') : '';
    })()`;
  }
  if (textOnly) {
    return `(() => document.body ? document.body.innerText : document.documentElement.innerText)()`;
  }
  if (mainOnly) {
    return `(() => {
      const selectors = 'main, article, [role="main"], #main, .main-content, .content, .mdx-content, .markdown-body, .prose, [data-doc-main]';
      const direct = document.querySelector(selectors);
      if (direct) {
        return direct.outerHTML || '';
      }
      const clone = document.body ? document.body.cloneNode(true) : null;
      if (!clone) {
        return document.documentElement ? (document.documentElement.outerHTML || '') : '';
      }
      clone.querySelectorAll('nav, header, footer, aside, script, style, noscript, form, [role="navigation"], [data-testid*="nav"], [class*="sidebar"], [class*="toc"], [class*="breadcrumb"]').forEach((node) => node.remove());
      return clone.outerHTML || (document.documentElement ? (document.documentElement.outerHTML || '') : '');
    })()`;
  }
  return `(() => document.documentElement.outerHTML)()`;
}

async function cdpReadPageContent(args, textOnly, mainOnly = false) {
  const expression = buildScanContentExpression(textOnly, mainOnly);
  return withTargetClient(args, async (client, target, endpoint, timeoutMs, resolved) => {
    await client.send("Runtime.enable", {}, Math.min(timeoutMs, 10_000));
    const evalResult = await client.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs);
    if (evalResult?.exceptionDetails) {
      const description = evalResult.exceptionDetails?.exception?.description
        || evalResult.exceptionDetails?.text
        || "CDP page content evaluate failed";
      throw new Error(String(description));
    }
      return {
        target_id: target.id,
        target_url: target.url,
        endpoint,
        content: String(evalResult?.result?.value ?? ""),
        selection: resolved.selection,
        sessions: resolved.sessions,
        ...sessionPointers(),
      };
    });
  }

async function cdpRunCommand(args, method, params) {
  return withTargetClient(args, async (client, target, endpoint, timeoutMs, resolved) => {
    const response = await client.send(method, params ?? {}, timeoutMs);
      return {
        target_id: target.id,
        target_url: target.url,
        endpoint,
        response,
        selection: resolved.selection,
        sessions: resolved.sessions,
        ...sessionPointers(),
      };
    });
  }

function resolvePathValue(input, path) {
  if (!path) {
    return input;
  }
  let current = input;
  for (const token of path.split(".")) {
    if (current === null || current === undefined) {
      throw new Error(`batch reference unresolved at token=${token}`);
    }
    if (/^\d+$/.test(token)) {
      const index = Number.parseInt(token, 10);
      if (!Array.isArray(current)) {
        throw new Error(`batch reference expected array at token=${token}`);
      }
      if (index < 0 || index >= current.length) {
        throw new Error(`batch reference index out of range: ${token}`);
      }
      current = current[index];
      continue;
    }
    if (!(token in Object(current))) {
      throw new Error(`batch reference missing key: ${token}`);
    }
    current = current[token];
  }
  return current;
}

function replaceBatchRefs(value, results) {
  const encoded = JSON.stringify(value ?? {});
  const replaced = encoded.replace(/"\$(\d+)\.([^"]+)"/g, (_, idxRaw, path) => {
    const idx = Number.parseInt(idxRaw, 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= results.length) {
      throw new Error(`batch reference index unavailable: $${String(idxRaw)}.${path}`);
    }
    const picked = resolvePathValue(results[idx], path);
    return JSON.stringify(picked);
  });
  return JSON.parse(replaced);
}

function replaceBatchScalarRef(value, results) {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!/^\$\d+\./.test(trimmed)) {
    return value;
  }
  return replaceBatchRefs({ value: trimmed }, results).value;
}

function applyBatchRefsToCommand(command, results) {
  const next = { ...command };
  next.tabId = replaceBatchScalarRef(next.tabId, results);
  next.tab_id = replaceBatchScalarRef(next.tab_id, results);
  next.sessionId = replaceBatchScalarRef(next.sessionId, results);
  next.session_id = replaceBatchScalarRef(next.session_id, results);
  next.url = replaceBatchScalarRef(next.url, results);
  next.method = replaceBatchScalarRef(next.method, results);
  if (next.params !== undefined) {
    next.params = replaceBatchRefs(next.params, results);
  }
  return next;
}

function resolveInheritedBatchTabId(args) {
  if (args?.tabId !== undefined) {
    return args.tabId;
  }
  if (args?.tab_id !== undefined) {
    return args.tab_id;
  }
  if (args?.switch_tab_id !== undefined) {
    return args.switch_tab_id;
  }
  return undefined;
}

function resolveInheritedBatchSessionId(args) {
  if (args?.sessionId !== undefined) {
    return args.sessionId;
  }
  if (args?.session_id !== undefined) {
    return args.session_id;
  }
  return undefined;
}

async function bridgeTabs(args) {
  const endpoint = normalizeEndpoint(args?.cdp_endpoint);
  const targets = await fetchCdpTargets(endpoint);
  syncSessionRegistry(targets);
  const tabId = String(args?.tabId ?? args?.tab_id ?? "").trim();
  const method = String(args?.method ?? "").trim().toLowerCase();
  if ((method === "switch" || method === "activate") && tabId) {
    const found = targets.find((item) => item.id === tabId);
    if (!found) {
      throw new Error(`tabs.switch target not found: ${tabId}`);
    }
    markSessionSelected(tabId, { make_default: false });
    return {
      ok: true,
      activeTab: tabId,
      ...sessionPointers(),
    };
  }
  if (method === "find_session") {
    const pattern = String(args?.url_pattern ?? args?.urlPattern ?? "").trim();
    const matched = resolveSessionByPattern(targets, pattern);
    return {
      ok: true,
      pattern,
      matched: asShortTabs(matched),
      ...sessionPointers(),
    };
  }
  if (method === "set_session") {
    const pattern = String(args?.url_pattern ?? args?.urlPattern ?? "").trim();
    const matched = resolveSessionByPattern(targets, pattern);
    if (matched.length === 0) {
      return {
        ok: false,
        error: `no session matched pattern: ${pattern}`,
        ...sessionPointers(),
      };
    }
    markSessionSelected(matched[0].id, { make_default: true });
    return {
      ok: true,
      selected: matched[0].id,
      matched: asShortTabs(matched),
      ...sessionPointers(),
    };
  }
  if (method === "current_session") {
    return {
      ok: true,
      ...sessionPointers(),
    };
  }
  return {
    ok: true,
    data: targets.map((item) => ({
      id: item.id,
      url: item.url,
      title: item.title,
      active: item.id === activeTargetId || item.active,
    })),
    sessions: listSessionsSnapshot(),
    ...sessionPointers(),
  };
}

async function bridgeCookies(args) {
  const resolved = await resolveTarget({
    ...args,
    switch_tab_id: args?.tabId ?? args?.tab_id ?? args?.switch_tab_id,
  });
  const url = String(args?.url ?? resolved.target.url ?? "").trim();
  if (!url) {
    return {
      ok: true,
      data: [],
    };
  }
  const command = await cdpRunCommand(
    {
      ...args,
      switch_tab_id: resolved.target.id,
    },
    "Network.getCookies",
    { urls: [url] },
  );
  return {
    ok: true,
    data: command.result.response?.cookies ?? [],
    selection: command.selection,
    ...sessionPointers(),
  };
}

async function bridgeCdp(args) {
  const method = String(args?.method ?? "").trim();
  if (!method) {
    throw new Error("cmd=cdp requires method");
  }
  const params = typeof args?.params === "object" && args.params !== null ? args.params : {};
  const run = await cdpRunCommand(
    {
      ...args,
      switch_tab_id: args?.tabId ?? args?.tab_id ?? args?.switch_tab_id,
    },
    method,
    params,
  );
  return {
    ok: true,
    data: run.result.response,
    tab_id: run.target.id,
    selection: run.selection,
    ...sessionPointers(),
  };
}

async function bridgeBatch(args) {
  const commands = Array.isArray(args?.commands) ? args.commands : [];
  const results = [];
  try {
    const inheritedTabId = resolveInheritedBatchTabId(args);
    const inheritedSessionId = resolveInheritedBatchSessionId(args);
    for (const command of commands) {
      if (typeof command !== "object" || command === null) {
        results.push({ ok: false, error: "command must be object" });
        continue;
      }
      const commandWithInheritedTab = { ...command };
      if (commandWithInheritedTab.tabId === undefined && inheritedTabId !== undefined) {
        commandWithInheritedTab.tabId = inheritedTabId;
      }
      if (commandWithInheritedTab.tab_id === undefined && inheritedTabId !== undefined) {
        commandWithInheritedTab.tab_id = inheritedTabId;
      }
      if (commandWithInheritedTab.sessionId === undefined && inheritedSessionId !== undefined) {
        commandWithInheritedTab.sessionId = inheritedSessionId;
      }
      if (commandWithInheritedTab.session_id === undefined && inheritedSessionId !== undefined) {
        commandWithInheritedTab.session_id = inheritedSessionId;
      }
      const resolvedCommand = applyBatchRefsToCommand(commandWithInheritedTab, results);
      const cmd = String(resolvedCommand.cmd ?? "").trim().toLowerCase();
      if (cmd === "tabs") {
        results.push(await bridgeTabs(resolvedCommand));
        continue;
      }
      if (cmd === "cookies") {
        results.push(await bridgeCookies(resolvedCommand));
        continue;
      }
      if (cmd === "cdp") {
        results.push(await bridgeCdp(resolvedCommand));
        continue;
      }
      results.push({ ok: false, error: `unknown cmd: ${cmd || "<empty>"}` });
    }
    return {
      ok: true,
      results,
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message ?? error),
      results,
    };
  }
}

async function runBridgeCommand(command, args) {
  const cmd = String(command?.cmd ?? "").trim().toLowerCase();
  if (cmd === "tabs") {
    return bridgeTabs({ ...args, ...command });
  }
  if (cmd === "cookies") {
    return bridgeCookies({ ...args, ...command });
  }
  if (cmd === "cdp") {
    return bridgeCdp({ ...args, ...command });
  }
  if (cmd === "batch") {
    return bridgeBatch({ ...args, ...command });
  }
  if (cmd === "management") {
    return {
      ok: false,
      error: "management command is not supported in standalone CDP mode",
    };
  }
  return {
    ok: false,
    error: `unknown cmd: ${cmd || "<empty>"}`,
  };
}

function asShortTabs(targets) {
  return targets.map((item) => ({
    id: item.id,
    url: compactText(item.url, 50),
    title: compactText(item.title, 80),
    active: item.id === activeTargetId || item.active,
    is_default: item.id === defaultSessionId,
    is_latest: item.id === latestSessionId,
  }));
}

function createToolError(errorCode, message, options = {}) {
  const error = new Error(String(message ?? "tool execution failed"));
  error.errorCode = String(errorCode || "EXECUTION_ERROR");
  if (typeof options.retryable === "boolean") {
    error.retryable = options.retryable;
  }
  if (typeof options.details === "object" && options.details !== null) {
    error.details = options.details;
  }
  return error;
}

function normalizeNativeInputTimeoutMs(raw) {
  const parsed = Number(raw ?? NATIVE_INPUT_DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) {
    return NATIVE_INPUT_DEFAULT_TIMEOUT_MS;
  }
  return Math.max(500, Math.min(NATIVE_INPUT_MAX_TIMEOUT_MS, Math.floor(parsed)));
}

function normalizeNativeInputAction(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  const allowed = new Set([
    "activate_window",
    "move",
    "click",
    "double_click",
    "press",
    "type",
    "paste",
    "scroll",
    "get_window_rect",
    "capabilities",
  ]);
  if (!allowed.has(value)) {
    throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: ${value || "<empty>"}`);
  }
  return value;
}

function allNativeInputActions() {
  return [
    "activate_window",
    "move",
    "click",
    "double_click",
    "press",
    "type",
    "paste",
    "scroll",
    "get_window_rect",
  ];
}

async function detectNativeInputCapabilities() {
  const platform = process.platform;
  const actions = allNativeInputActions();
  if (platform === "win32") {
    const hasPowerShell = await commandExists("powershell", 1_200) || await commandExists("pwsh", 1_200);
    return {
      platform,
      driver: "windows-powershell",
      checks: {
        powershell: hasPowerShell,
      },
      supported_actions: hasPowerShell ? [...actions] : [],
      unsupported_actions: hasPowerShell ? [] : [...actions],
      requirements: hasPowerShell
        ? []
        : ["Install PowerShell (`powershell` or `pwsh`) and ensure it is on PATH."],
      permission_notes: [
        "Some actions may require foreground window focus permissions managed by OS policy.",
      ],
    };
  }
  if (platform === "darwin") {
    const hasOsaScript = await commandExists("osascript", 1_200);
    const hasCliclick = await commandExists("cliclick", 1_200);
    const noPointerActions = [
      "activate_window",
      "press",
      "type",
      "paste",
      "get_window_rect",
    ];
    const pointerActions = [
      "move",
      "click",
      "double_click",
      "scroll",
    ];
    const supported = new Set();
    if (hasOsaScript) {
      for (const action of noPointerActions) {
        supported.add(action);
      }
    }
    if (hasCliclick) {
      for (const action of pointerActions) {
        supported.add(action);
      }
    }
    const supportedActions = actions.filter((action) => supported.has(action));
    const unsupportedActions = actions.filter((action) => !supported.has(action));
    const requirements = [];
    if (!hasOsaScript) {
      requirements.push("macOS requires `osascript` for keyboard/window actions.");
    }
    if (!hasCliclick) {
      requirements.push("Install `cliclick` for pointer actions (`move/click/double_click/scroll`).");
    }
    return {
      platform,
      driver: "macos-osascript-cliclick",
      checks: {
        osascript: hasOsaScript,
        cliclick: hasCliclick,
      },
      supported_actions: supportedActions,
      unsupported_actions: unsupportedActions,
      requirements,
      permission_notes: [
        "Grant Accessibility and Automation permissions to terminal process for native input.",
      ],
    };
  }
  if (platform === "linux") {
    const hasDisplay = String(process.env.DISPLAY ?? "").trim().length > 0;
    const hasWaylandOnly = !hasDisplay && String(process.env.WAYLAND_DISPLAY ?? "").trim().length > 0;
    const hasXdotool = await commandExists("xdotool", 1_200);
    const hasXclip = await commandExists("xclip", 1_200);
    const baseSupported = hasDisplay && hasXdotool;
    const requirements = [];
    if (!hasDisplay) {
      if (hasWaylandOnly) {
        requirements.push("Wayland-only session detected; X11 DISPLAY or equivalent bridge is required.");
      } else {
        requirements.push("Set DISPLAY for X11-compatible native input.");
      }
    }
    if (!hasXdotool) {
      requirements.push("Install `xdotool` for keyboard/mouse actions.");
    }
    if (!hasXclip) {
      requirements.push("Optional: install `xclip` for true clipboard paste (fallback can type text).");
    }
    return {
      platform,
      driver: "linux-xdotool",
      checks: {
        display: hasDisplay,
        wayland_only: hasWaylandOnly,
        xdotool: hasXdotool,
        xclip: hasXclip,
      },
      supported_actions: baseSupported ? [...actions] : [],
      unsupported_actions: baseSupported ? [] : [...actions],
      requirements,
      permission_notes: [
        "Window manager/focus policies may still block specific actions even when tooling is present.",
      ],
    };
  }
  return {
    platform,
    driver: "unsupported",
    checks: {},
    supported_actions: [],
    unsupported_actions: [...actions],
    requirements: [`Unsupported platform: ${platform}`],
    permission_notes: [],
  };
}

function validateNativeInputArguments(action, args) {
  const input = args ?? {};
  if (action === "capabilities") {
    return {};
  }
  if (action === "activate_window") {
    const selector = parseWindowSelector(input);
    if (!selector.title && !selector.pid) {
      throw createToolError("WINDOW_NOT_FOUND", "window not found: window_title or window_pid is required");
    }
    return {
      window_title: selector.title || undefined,
      window_pid: selector.pid ?? undefined,
    };
  }
  if (action === "move") {
    return {
      x: normalizeCoordinate(input.x, "x"),
      y: normalizeCoordinate(input.y, "y"),
    };
  }
  if (action === "click" || action === "double_click") {
    const normalized = {
      button: normalizeMouseButton(input.button),
    };
    const hasX = input.x !== undefined;
    const hasY = input.y !== undefined;
    if (hasX !== hasY) {
      throw createToolError("COORDINATE_OUT_OF_RANGE", "coordinate out of range: both x and y are required together");
    }
    if (hasX && hasY) {
      normalized.x = normalizeCoordinate(input.x, "x");
      normalized.y = normalizeCoordinate(input.y, "y");
    }
    return normalized;
  }
  if (action === "press") {
    const key = String(input.key ?? "").trim();
    if (!key) {
      throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: press requires key");
    }
    return {
      key,
    };
  }
  if (action === "type") {
    if (input.text === undefined || input.text === null) {
      throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: type requires text");
    }
    const text = String(input.text);
    const delayRaw = Number(input.delay_ms ?? 6);
    const delayMs = Number.isFinite(delayRaw) ? Math.max(0, Math.min(10_000, Math.floor(delayRaw))) : 6;
    return {
      text,
      text_length: text.length,
      delay_ms: delayMs,
    };
  }
  if (action === "paste") {
    if (input.text === undefined || input.text === null) {
      return {
        use_existing_clipboard: true,
      };
    }
    const text = String(input.text);
    return {
      text,
      text_length: text.length,
      use_existing_clipboard: false,
    };
  }
  if (action === "scroll") {
    const deltaXRaw = Number(input.delta_x ?? 0);
    const deltaYRaw = Number(input.delta_y ?? 0);
    const deltaX = Number.isFinite(deltaXRaw) ? Math.max(-24_000, Math.min(24_000, Math.round(deltaXRaw))) : 0;
    const deltaY = Number.isFinite(deltaYRaw) ? Math.max(-24_000, Math.min(24_000, Math.round(deltaYRaw))) : 0;
    return {
      delta_x: deltaX,
      delta_y: deltaY,
    };
  }
  if (action === "get_window_rect") {
    const selector = parseWindowSelector(input);
    return {
      window_title: selector.title || undefined,
      window_pid: selector.pid ?? undefined,
    };
  }
  throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: ${action}`);
}

function buildNativeInputDriverPlan(platform, action) {
  if (platform === "win32") {
    return {
      primary_driver: "windows-powershell",
      binary_requirements: ["powershell|pwsh"],
      permission_requirements: ["Foreground window/focus permissions managed by OS policy."],
    };
  }
  if (platform === "darwin") {
    const pointerActions = new Set(["move", "click", "double_click", "scroll"]);
    return {
      primary_driver: pointerActions.has(action) ? "macos-cliclick" : "macos-osascript",
      binary_requirements: pointerActions.has(action) ? ["osascript", "cliclick"] : ["osascript"],
      permission_requirements: ["Accessibility + Automation permissions for terminal process."],
    };
  }
  if (platform === "linux") {
    const requirements = ["xdotool", "DISPLAY"];
    if (action === "paste") {
      requirements.push("xclip (optional for clipboard paste)");
    }
    return {
      primary_driver: "linux-xdotool",
      binary_requirements: requirements,
      permission_requirements: ["Window manager/focus policy can still block specific actions."],
    };
  }
  return {
    primary_driver: "unsupported",
    binary_requirements: [],
    permission_requirements: [],
  };
}

function buildNativeInputDryRunResponse(action, args, timeoutMs, capabilities) {
  const validatedArgs = validateNativeInputArguments(action, args);
  const supportedActions = Array.isArray(capabilities?.supported_actions) ? capabilities.supported_actions : [];
  const unsupportedActions = Array.isArray(capabilities?.unsupported_actions) ? capabilities.unsupported_actions : [];
  const requirements = Array.isArray(capabilities?.requirements) ? capabilities.requirements : [];
  const checks = (
    typeof capabilities?.checks === "object"
    && capabilities.checks !== null
    && !Array.isArray(capabilities.checks)
  ) ? capabilities.checks : {};
  const supported = supportedActions.includes(action);
  return {
    status: "success",
    dry_run: true,
    platform: String(capabilities?.platform ?? process.platform),
    action,
    timeout_ms: timeoutMs,
    validated_args: validatedArgs,
    driver_plan: buildNativeInputDriverPlan(String(capabilities?.platform ?? process.platform), action),
    capabilities_summary: {
      supported,
      checks,
      supported_actions: supportedActions,
      unsupported_actions: unsupportedActions,
      requirements,
    },
    next_step: supported ? "safe_to_execute" : "requirements_missing",
    at: nowIso(),
  };
}

function normalizeMouseButton(raw) {
  const value = String(raw ?? "left").trim().toLowerCase();
  if (value === "left" || value === "middle" || value === "right") {
    return value;
  }
  throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: button=${value}`);
}

function normalizeCoordinate(raw, axisName) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw createToolError("COORDINATE_OUT_OF_RANGE", `coordinate out of range: ${axisName} is not finite`);
  }
  const value = Math.round(parsed);
  if (value < 0 || value > 100_000) {
    throw createToolError("COORDINATE_OUT_OF_RANGE", `coordinate out of range: ${axisName}=${String(value)}`);
  }
  return value;
}

function parseWindowSelector(args) {
  const title = String(args?.window_title ?? "").trim();
  const pidParsed = Number(args?.window_pid);
  const pid = Number.isInteger(pidParsed) && pidParsed > 0 ? pidParsed : null;
  return { title, pid };
}

function parseJsonFromCommandOutput(stdout) {
  const rows = String(stdout ?? "")
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(rows[index]);
    } catch {
      // continue
    }
  }
  return null;
}

async function runNativeCommand(command, args = [], options = {}) {
  const timeoutMs = normalizeNativeInputTimeoutMs(options.timeoutMs);
  const env = options.env ?? process.env;
  const input = typeof options.input === "string" ? options.input : null;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // no-op
      }
      reject(new Error(`native input execution failed: ${command} timeout after ${String(timeoutMs)}ms`));
    }, timeoutMs);
    const finish = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code, signal) => {
      finish({
        code: typeof code === "number" ? code : -1,
        signal: signal ? String(signal) : "",
        stdout,
        stderr,
        command,
        args,
      });
    });
    if (input !== null) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

async function commandExists(command, timeoutMs = 2_000) {
  const probeCommand = process.platform === "win32" ? "where" : "which";
  try {
    const result = await runNativeCommand(probeCommand, [command], { timeoutMs });
    return result.code === 0;
  } catch {
    return false;
  }
}

function escapeAppleScriptString(raw) {
  return String(raw ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"");
}

function escapePowerShellString(raw) {
  return String(raw ?? "").replace(/'/g, "''");
}

function escapeWindowsSendKeysText(raw) {
  return String(raw ?? "").replace(/[+^%~(){}]/g, (token) => {
    if (token === "{") {
      return "{{}";
    }
    if (token === "}") {
      return "{}}";
    }
    return `{${token}}`;
  });
}

function toWindowsSendKeys(raw) {
  const normalized = String(raw ?? "").trim();
  if (!normalized) {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: empty key");
  }
  const pieces = normalized.split("+").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (pieces.length === 0) {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: empty key");
  }
  const keyToken = pieces[pieces.length - 1];
  const modifierTokens = pieces.slice(0, -1);
  const modifierMap = new Map([
    ["ctrl", "^"],
    ["control", "^"],
    ["shift", "+"],
    ["alt", "%"],
    ["option", "%"],
    ["cmd", "^"],
    ["command", "^"],
    ["meta", "^"],
    ["win", "^"],
  ]);
  let prefix = "";
  for (const modifier of modifierTokens) {
    if (!modifierMap.has(modifier)) {
      throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: key modifier=${modifier}`);
    }
    prefix += modifierMap.get(modifier);
  }
  const keyMap = new Map([
    ["enter", "{ENTER}"],
    ["return", "{ENTER}"],
    ["tab", "{TAB}"],
    ["esc", "{ESC}"],
    ["escape", "{ESC}"],
    ["space", " "],
    ["up", "{UP}"],
    ["down", "{DOWN}"],
    ["left", "{LEFT}"],
    ["right", "{RIGHT}"],
    ["backspace", "{BACKSPACE}"],
    ["delete", "{DELETE}"],
    ["home", "{HOME}"],
    ["end", "{END}"],
    ["pageup", "{PGUP}"],
    ["pagedown", "{PGDN}"],
  ]);
  if (keyMap.has(keyToken)) {
    return `${prefix}${keyMap.get(keyToken)}`;
  }
  if (/^f([1-9]|1[0-2])$/.test(keyToken)) {
    return `${prefix}{${keyToken.toUpperCase()}}`;
  }
  if (keyToken.length === 1) {
    return `${prefix}${escapeWindowsSendKeysText(keyToken)}`;
  }
  return `${prefix}{${keyToken.toUpperCase()}}`;
}

function toLinuxXdotoolKey(raw) {
  const normalized = String(raw ?? "").trim();
  if (!normalized) {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: empty key");
  }
  const pieces = normalized.split("+").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const mapped = pieces.map((piece) => {
    if (piece === "cmd" || piece === "command" || piece === "meta" || piece === "win") {
      return "super";
    }
    if (piece === "control") {
      return "ctrl";
    }
    if (piece === "option") {
      return "alt";
    }
    if (piece === "enter") {
      return "Return";
    }
    if (piece === "esc") {
      return "Escape";
    }
    if (piece === "space") {
      return "space";
    }
    return piece;
  });
  return mapped.join("+");
}

function parseAppleKeyChord(raw) {
  const normalized = String(raw ?? "").trim();
  if (!normalized) {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: empty key");
  }
  const pieces = normalized.split("+").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (pieces.length === 0) {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: empty key");
  }
  const mainKey = pieces[pieces.length - 1];
  const modifierMap = new Map([
    ["cmd", "command down"],
    ["command", "command down"],
    ["meta", "command down"],
    ["win", "command down"],
    ["shift", "shift down"],
    ["alt", "option down"],
    ["option", "option down"],
    ["ctrl", "control down"],
    ["control", "control down"],
  ]);
  const modifiers = [];
  for (const token of pieces.slice(0, -1)) {
    if (!modifierMap.has(token)) {
      throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: key modifier=${token}`);
    }
    const mapped = modifierMap.get(token);
    if (!modifiers.includes(mapped)) {
      modifiers.push(mapped);
    }
  }
  const keyCodeMap = new Map([
    ["enter", 36],
    ["return", 36],
    ["tab", 48],
    ["esc", 53],
    ["escape", 53],
    ["space", 49],
    ["left", 123],
    ["right", 124],
    ["down", 125],
    ["up", 126],
    ["delete", 51],
    ["backspace", 51],
    ["forwarddelete", 117],
    ["home", 115],
    ["end", 119],
    ["pageup", 116],
    ["pagedown", 121],
  ]);
  const keyCode = keyCodeMap.get(mainKey);
  if (keyCode !== undefined) {
    return {
      keyCode,
      keyText: "",
      modifiers,
    };
  }
  if (mainKey.length === 1) {
    return {
      keyCode: null,
      keyText: mainKey,
      modifiers,
    };
  }
  throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: key=${mainKey}`);
}

function buildAppleModifiersClause(modifiers) {
  if (!Array.isArray(modifiers) || modifiers.length === 0) {
    return "";
  }
  return ` using {${modifiers.join(", ")}}`;
}

async function runAppleScript(lines, timeoutMs) {
  const args = [];
  for (const line of lines) {
    args.push("-e", line);
  }
  return runNativeCommand("osascript", args, { timeoutMs });
}

function parseWindowGeometryFromShell(raw) {
  const pairs = {};
  for (const line of String(raw ?? "").split(/\r?\n/g)) {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (!match) {
      continue;
    }
    pairs[match[1]] = match[2];
  }
  const x = Number.parseInt(pairs.X ?? "", 10);
  const y = Number.parseInt(pairs.Y ?? "", 10);
  const width = Number.parseInt(pairs.WIDTH ?? "", 10);
  const height = Number.parseInt(pairs.HEIGHT ?? "", 10);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`native input execution failed: invalid geometry payload=${raw}`);
  }
  return { x, y, width, height };
}

function ensureNativeCommandOk(result, label) {
  if (result.code === 0) {
    return;
  }
  const detail = compactText(result.stderr || result.stdout || "unknown command failure", 600);
  throw new Error(`${label} failed exit=${String(result.code)} detail=${detail}`);
}

async function runWindowsPowerShellScript(script, timeoutMs) {
  const commands = ["powershell", "pwsh"];
  let missingCount = 0;
  for (const command of commands) {
    try {
      const result = await runNativeCommand(command, [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ], {
        timeoutMs,
      });
      return result;
    } catch (error) {
      if (error?.code === "ENOENT") {
        missingCount += 1;
        continue;
      }
      throw error;
    }
  }
  if (missingCount >= commands.length) {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: powershell not found");
  }
  throw createToolError("NATIVE_INPUT_EXECUTION_FAILED", "native input execution failed: powershell unavailable");
}

function buildWindowsNativePrelude() {
  return [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "Add-Type @\"",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class NativeBridge {",
    "  [StructLayout(LayoutKind.Sequential)]",
    "  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }",
    "  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
    "  [DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);",
    "  [DllImport(\"user32.dll\")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);",
    "}",
    "\"@",
  ].join("\n");
}

function buildWindowsTargetLookup(selector) {
  const title = escapePowerShellString(selector.title);
  const pid = Number.isInteger(selector.pid) ? selector.pid : null;
  return [
    "$target = $null",
    pid
      ? `$target = Get-Process -Id ${String(pid)} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1`
      : "",
    `$lookupTitle = '${title}'`,
    "if (-not $target -and $lookupTitle -ne '') {",
    "  $target = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like ('*' + $lookupTitle + '*') } | Select-Object -First 1",
    "}",
  ].filter(Boolean).join("\n");
}

function parsePowerShellNativeResult(result, fallbackAction) {
  const parsed = parseJsonFromCommandOutput(result.stdout);
  if (!parsed) {
    ensureNativeCommandOk(result, "powershell");
    throw new Error(`native input execution failed: missing powershell json output action=${fallbackAction}`);
  }
  if (parsed.ok === false) {
    const code = typeof parsed.error_code === "string" ? parsed.error_code : "NATIVE_INPUT_EXECUTION_FAILED";
    const message = String(parsed.error ?? `native input execution failed action=${fallbackAction}`);
    throw createToolError(code, message, { details: parsed });
  }
  if (result.code !== 0) {
    ensureNativeCommandOk(result, "powershell");
  }
  return parsed;
}

async function runNativeInputWindows(action, args, timeoutMs) {
  const selector = parseWindowSelector(args);
  const prelude = buildWindowsNativePrelude();
  if (action === "activate_window") {
    if (!selector.title && !selector.pid) {
      throw createToolError("WINDOW_NOT_FOUND", "window not found: window_title or window_pid is required");
    }
    const script = [
      prelude,
      buildWindowsTargetLookup(selector),
      "if (-not $target) {",
      "  @{ ok = $false; error_code = 'WINDOW_NOT_FOUND'; error = 'window not found' } | ConvertTo-Json -Compress",
      "  exit 7",
      "}",
      "[NativeBridge]::ShowWindowAsync($target.MainWindowHandle, 9) | Out-Null",
      "$focus = [NativeBridge]::SetForegroundWindow($target.MainWindowHandle)",
      "@{ ok = $true; pid = $target.Id; title = $target.MainWindowTitle; hwnd = [Int64]$target.MainWindowHandle; focused = [bool]$focus } | ConvertTo-Json -Compress",
    ].join("\n");
    const response = await runWindowsPowerShellScript(script, timeoutMs);
    const parsed = parsePowerShellNativeResult(response, action);
    return {
      driver: "windows-powershell",
      ...parsed,
    };
  }
  if (action === "move") {
    const x = normalizeCoordinate(args?.x, "x");
    const y = normalizeCoordinate(args?.y, "y");
    const script = [
      prelude,
      `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${String(x)}, ${String(y)})`,
      `@{ ok = $true; x = ${String(x)}; y = ${String(y)} } | ConvertTo-Json -Compress`,
    ].join("\n");
    const response = await runWindowsPowerShellScript(script, timeoutMs);
    const parsed = parsePowerShellNativeResult(response, action);
    return {
      driver: "windows-powershell",
      ...parsed,
    };
  }
  if (action === "click" || action === "double_click") {
    if (args?.x !== undefined || args?.y !== undefined) {
      const x = normalizeCoordinate(args?.x, "x");
      const y = normalizeCoordinate(args?.y, "y");
      const moveScript = [
        prelude,
        `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${String(x)}, ${String(y)})`,
        "@{ ok = $true } | ConvertTo-Json -Compress",
      ].join("\n");
      const moveResult = await runWindowsPowerShellScript(moveScript, timeoutMs);
      parsePowerShellNativeResult(moveResult, "move");
    }
    const button = normalizeMouseButton(args?.button);
    const downFlag = button === "right" ? "0x0008" : (button === "middle" ? "0x0020" : "0x0002");
    const upFlag = button === "right" ? "0x0010" : (button === "middle" ? "0x0040" : "0x0004");
    const count = action === "double_click" ? 2 : 1;
    const script = [
      prelude,
      `$downFlag = [uint32]${downFlag}`,
      `$upFlag = [uint32]${upFlag}`,
      `$count = ${String(count)}`,
      "for ($index = 0; $index -lt $count; $index += 1) {",
      "  [NativeBridge]::mouse_event($downFlag, 0, 0, 0, [UIntPtr]::Zero)",
      "  Start-Sleep -Milliseconds 35",
      "  [NativeBridge]::mouse_event($upFlag, 0, 0, 0, [UIntPtr]::Zero)",
      "  if ($index -lt ($count - 1)) { Start-Sleep -Milliseconds 55 }",
      "}",
      `@{ ok = $true; button = '${button}'; count = ${String(count)} } | ConvertTo-Json -Compress`,
    ].join("\n");
    const response = await runWindowsPowerShellScript(script, timeoutMs);
    const parsed = parsePowerShellNativeResult(response, action);
    return {
      driver: "windows-powershell",
      ...parsed,
    };
  }
  if (action === "press") {
    const key = toWindowsSendKeys(args?.key);
    const script = [
      prelude,
      `[System.Windows.Forms.SendKeys]::SendWait('${escapePowerShellString(key)}')`,
      `@{ ok = $true; key = '${escapePowerShellString(String(args?.key ?? ""))}' } | ConvertTo-Json -Compress`,
    ].join("\n");
    const response = await runWindowsPowerShellScript(script, timeoutMs);
    const parsed = parsePowerShellNativeResult(response, action);
    return {
      driver: "windows-powershell",
      ...parsed,
    };
  }
  if (action === "type") {
    const text = String(args?.text ?? "");
    const script = [
      prelude,
      `[System.Windows.Forms.SendKeys]::SendWait('${escapePowerShellString(escapeWindowsSendKeysText(text))}')`,
      `@{ ok = $true; text_length = ${String(text.length)} } | ConvertTo-Json -Compress`,
    ].join("\n");
    const response = await runWindowsPowerShellScript(script, timeoutMs);
    const parsed = parsePowerShellNativeResult(response, action);
    return {
      driver: "windows-powershell",
      ...parsed,
    };
  }
  if (action === "paste") {
    const text = args?.text === undefined ? "" : String(args?.text);
    const script = [
      prelude,
      text.length > 0 ? `Set-Clipboard -Value '${escapePowerShellString(text)}'` : "",
      "[System.Windows.Forms.SendKeys]::SendWait('^v')",
      `@{ ok = $true; used_clipboard = ${text.length > 0 ? "$true" : "$false"} } | ConvertTo-Json -Compress`,
    ].filter(Boolean).join("\n");
    const response = await runWindowsPowerShellScript(script, timeoutMs);
    const parsed = parsePowerShellNativeResult(response, action);
    return {
      driver: "windows-powershell",
      ...parsed,
    };
  }
  if (action === "scroll") {
    const deltaYRaw = Number(args?.delta_y ?? 0);
    const deltaY = Number.isFinite(deltaYRaw) ? Math.max(-24_000, Math.min(24_000, Math.round(deltaYRaw))) : 0;
    if (deltaY === 0) {
      return {
        driver: "windows-powershell",
        ok: true,
        delta_y: 0,
      };
    }
    const script = [
      prelude,
      `[NativeBridge]::mouse_event([uint32]0x0800, 0, 0, ${String(deltaY)}, [UIntPtr]::Zero)`,
      `@{ ok = $true; delta_y = ${String(deltaY)} } | ConvertTo-Json -Compress`,
    ].join("\n");
    const response = await runWindowsPowerShellScript(script, timeoutMs);
    const parsed = parsePowerShellNativeResult(response, action);
    return {
      driver: "windows-powershell",
      ...parsed,
    };
  }
  if (action === "get_window_rect") {
    const script = [
      prelude,
      buildWindowsTargetLookup(selector),
      "$hwnd = [IntPtr]::Zero",
      "if ($target) {",
      "  $hwnd = $target.MainWindowHandle",
      "} else {",
      "  $hwnd = [NativeBridge]::GetForegroundWindow()",
      "}",
      "if ($hwnd -eq [IntPtr]::Zero) {",
      "  @{ ok = $false; error_code = 'WINDOW_NOT_FOUND'; error = 'window not found' } | ConvertTo-Json -Compress",
      "  exit 7",
      "}",
      "$rect = New-Object NativeBridge+RECT",
      "$ok = [NativeBridge]::GetWindowRect($hwnd, [ref]$rect)",
      "if (-not $ok) {",
      "  @{ ok = $false; error_code = 'NATIVE_INPUT_EXECUTION_FAILED'; error = 'GetWindowRect failed' } | ConvertTo-Json -Compress",
      "  exit 9",
      "}",
      "$width = $rect.Right - $rect.Left",
      "$height = $rect.Bottom - $rect.Top",
      "@{ ok = $true; left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom; width = $width; height = $height; hwnd = [Int64]$hwnd } | ConvertTo-Json -Compress",
    ].join("\n");
    const response = await runWindowsPowerShellScript(script, timeoutMs);
    const parsed = parsePowerShellNativeResult(response, action);
    return {
      driver: "windows-powershell",
      ...parsed,
    };
  }
  throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: ${action}`);
}

async function runNativeInputMac(action, args, timeoutMs) {
  if (action === "activate_window") {
    const selector = parseWindowSelector(args);
    if (!selector.title && !selector.pid) {
      throw createToolError("WINDOW_NOT_FOUND", "window not found: window_title or window_pid is required");
    }
    const lines = [
      "tell application \"System Events\"",
      selector.pid
        ? `  set targetProcess to first process whose unix id is ${String(selector.pid)}`
        : `  set targetProcess to first process whose name contains \"${escapeAppleScriptString(selector.title)}\"`,
      "  set frontmost of targetProcess to true",
      "  return name of targetProcess",
      "end tell",
    ];
    const result = await runAppleScript(lines, timeoutMs);
    ensureNativeCommandOk(result, "osascript activate_window");
    return {
      driver: "macos-osascript",
      target: String(result.stdout ?? "").trim() || null,
    };
  }
  if (action === "press") {
    const parsed = parseAppleKeyChord(args?.key);
    const modifiers = buildAppleModifiersClause(parsed.modifiers);
    const keyCommand = parsed.keyCode !== null
      ? `tell application "System Events" to key code ${String(parsed.keyCode)}${modifiers}`
      : `tell application "System Events" to keystroke "${escapeAppleScriptString(parsed.keyText)}"${modifiers}`;
    const result = await runAppleScript([keyCommand], timeoutMs);
    ensureNativeCommandOk(result, "osascript press");
    return {
      driver: "macos-osascript",
      key: String(args?.key ?? ""),
    };
  }
  if (action === "type") {
    const text = String(args?.text ?? "");
    const result = await runAppleScript([
      `tell application "System Events" to keystroke "${escapeAppleScriptString(text)}"`,
    ], timeoutMs);
    ensureNativeCommandOk(result, "osascript type");
    return {
      driver: "macos-osascript",
      text_length: text.length,
    };
  }
  if (action === "paste") {
    const lines = [];
    if (args?.text !== undefined) {
      lines.push(`set the clipboard to "${escapeAppleScriptString(String(args.text))}"`);
    }
    lines.push("tell application \"System Events\" to keystroke \"v\" using {command down}");
    const result = await runAppleScript(lines, timeoutMs);
    ensureNativeCommandOk(result, "osascript paste");
    return {
      driver: "macos-osascript",
      used_clipboard: args?.text !== undefined,
    };
  }
  if (action === "get_window_rect") {
    const lines = [
      "tell application \"System Events\"",
      "  set frontProc to first process whose frontmost is true",
      "  if (count of windows of frontProc) is 0 then error \"window not found\"",
      "  set p to position of front window of frontProc",
      "  set s to size of front window of frontProc",
      "  set t to name of front window of frontProc",
      "end tell",
      "return (item 1 of p as text) & \",\" & (item 2 of p as text) & \",\" & (item 1 of s as text) & \",\" & (item 2 of s as text) & \",\" & t",
    ];
    const result = await runAppleScript(lines, timeoutMs);
    ensureNativeCommandOk(result, "osascript get_window_rect");
    const pieces = String(result.stdout ?? "").trim().split(",");
    if (pieces.length < 5) {
      throw new Error(`native input execution failed: invalid mac window rect output=${result.stdout}`);
    }
    const left = Number.parseInt(pieces[0] ?? "", 10);
    const top = Number.parseInt(pieces[1] ?? "", 10);
    const width = Number.parseInt(pieces[2] ?? "", 10);
    const height = Number.parseInt(pieces[3] ?? "", 10);
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) {
      throw new Error(`native input execution failed: invalid mac window rect numbers=${result.stdout}`);
    }
    return {
      driver: "macos-osascript",
      left,
      top,
      width,
      height,
      title: pieces.slice(4).join(","),
    };
  }

  const hasCliclick = await commandExists("cliclick", Math.min(timeoutMs, 2_000));
  if (!hasCliclick) {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: cliclick is required on macOS for pointer actions", {
      details: { required_binary: "cliclick" },
    });
  }

  if (action === "move") {
    const x = normalizeCoordinate(args?.x, "x");
    const y = normalizeCoordinate(args?.y, "y");
    const result = await runNativeCommand("cliclick", [`m:${String(x)},${String(y)}`], { timeoutMs });
    ensureNativeCommandOk(result, "cliclick move");
    return {
      driver: "macos-cliclick",
      x,
      y,
    };
  }
  if (action === "click" || action === "double_click") {
    const x = normalizeCoordinate(args?.x, "x");
    const y = normalizeCoordinate(args?.y, "y");
    const button = normalizeMouseButton(args?.button);
    const base = button === "right" ? "rc" : (button === "middle" ? "mc" : "c");
    const count = action === "double_click" ? 2 : 1;
    const commands = [];
    for (let index = 0; index < count; index += 1) {
      commands.push(`${base}:${String(x)},${String(y)}`);
    }
    const result = await runNativeCommand("cliclick", commands, { timeoutMs });
    ensureNativeCommandOk(result, "cliclick click");
    return {
      driver: "macos-cliclick",
      x,
      y,
      button,
      count,
    };
  }
  if (action === "scroll") {
    const deltaXRaw = Number(args?.delta_x ?? 0);
    const deltaYRaw = Number(args?.delta_y ?? 0);
    const deltaX = Number.isFinite(deltaXRaw) ? Math.max(-1_000, Math.min(1_000, Math.round(deltaXRaw))) : 0;
    const deltaY = Number.isFinite(deltaYRaw) ? Math.max(-1_000, Math.min(1_000, Math.round(deltaYRaw))) : 0;
    const result = await runNativeCommand("cliclick", [`w:${String(deltaX)},${String(deltaY)}`], { timeoutMs });
    ensureNativeCommandOk(result, "cliclick scroll");
    return {
      driver: "macos-cliclick",
      delta_x: deltaX,
      delta_y: deltaY,
    };
  }
  throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: ${action}`);
}

function resolveLinuxButton(button) {
  if (button === "left") {
    return 1;
  }
  if (button === "middle") {
    return 2;
  }
  if (button === "right") {
    return 3;
  }
  return 1;
}

function ensureLinuxDisplayBackend() {
  const display = String(process.env.DISPLAY ?? "").trim();
  if (display) {
    return;
  }
  const wayland = String(process.env.WAYLAND_DISPLAY ?? "").trim();
  if (wayland) {
    throw createToolError(
      "DISPLAY_BACKEND_UNSUPPORTED",
      "display backend unsupported: Wayland session without X11 DISPLAY",
    );
  }
  throw createToolError("DISPLAY_BACKEND_UNSUPPORTED", "display backend unsupported: DISPLAY is not set");
}

async function resolveLinuxWindowId(selector, timeoutMs) {
  if (selector.pid) {
    const byPid = await runNativeCommand("xdotool", ["search", "--pid", String(selector.pid)], { timeoutMs });
    ensureNativeCommandOk(byPid, "xdotool search --pid");
    const id = String(byPid.stdout ?? "").split(/\r?\n/g).find((item) => item.trim().length > 0)?.trim() ?? "";
    if (!id) {
      throw createToolError("WINDOW_NOT_FOUND", `window not found: pid=${String(selector.pid)}`);
    }
    return id;
  }
  if (selector.title) {
    const byTitle = await runNativeCommand("xdotool", ["search", "--name", selector.title], { timeoutMs });
    ensureNativeCommandOk(byTitle, "xdotool search --name");
    const id = String(byTitle.stdout ?? "").split(/\r?\n/g).find((item) => item.trim().length > 0)?.trim() ?? "";
    if (!id) {
      throw createToolError("WINDOW_NOT_FOUND", `window not found: title=${selector.title}`);
    }
    return id;
  }
  const active = await runNativeCommand("xdotool", ["getactivewindow"], { timeoutMs });
  ensureNativeCommandOk(active, "xdotool getactivewindow");
  const id = String(active.stdout ?? "").trim();
  if (!id) {
    throw createToolError("WINDOW_NOT_FOUND", "window not found: no active window");
  }
  return id;
}

async function runNativeInputLinux(action, args, timeoutMs) {
  ensureLinuxDisplayBackend();
  const hasXdotool = await commandExists("xdotool", Math.min(timeoutMs, 2_000));
  if (!hasXdotool) {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: xdotool is required on linux");
  }
  const selector = parseWindowSelector(args);
  if (action === "activate_window") {
    const windowId = await resolveLinuxWindowId(selector, timeoutMs);
    const activate = await runNativeCommand("xdotool", ["windowactivate", "--sync", windowId], { timeoutMs });
    ensureNativeCommandOk(activate, "xdotool windowactivate");
    return {
      driver: "linux-xdotool",
      window_id: windowId,
    };
  }
  if (action === "move") {
    const x = normalizeCoordinate(args?.x, "x");
    const y = normalizeCoordinate(args?.y, "y");
    const move = await runNativeCommand("xdotool", ["mousemove", String(x), String(y)], { timeoutMs });
    ensureNativeCommandOk(move, "xdotool mousemove");
    return {
      driver: "linux-xdotool",
      x,
      y,
    };
  }
  if (action === "click" || action === "double_click") {
    if (args?.x !== undefined || args?.y !== undefined) {
      const x = normalizeCoordinate(args?.x, "x");
      const y = normalizeCoordinate(args?.y, "y");
      const move = await runNativeCommand("xdotool", ["mousemove", String(x), String(y)], { timeoutMs });
      ensureNativeCommandOk(move, "xdotool mousemove");
    }
    const button = normalizeMouseButton(args?.button);
    const repeat = action === "double_click" ? 2 : 1;
    const click = await runNativeCommand("xdotool", [
      "click",
      "--repeat",
      String(repeat),
      "--delay",
      "80",
      String(resolveLinuxButton(button)),
    ], {
      timeoutMs,
    });
    ensureNativeCommandOk(click, "xdotool click");
    return {
      driver: "linux-xdotool",
      button,
      count: repeat,
    };
  }
  if (action === "press") {
    const key = toLinuxXdotoolKey(args?.key);
    const press = await runNativeCommand("xdotool", ["key", "--clearmodifiers", key], { timeoutMs });
    ensureNativeCommandOk(press, "xdotool key");
    return {
      driver: "linux-xdotool",
      key,
    };
  }
  if (action === "type") {
    const text = String(args?.text ?? "");
    const delayRaw = Number(args?.delay_ms ?? 6);
    const delay = Number.isFinite(delayRaw) ? Math.max(0, Math.min(1_000, Math.floor(delayRaw))) : 6;
    const typed = await runNativeCommand("xdotool", ["type", "--delay", String(delay), text], { timeoutMs });
    ensureNativeCommandOk(typed, "xdotool type");
    return {
      driver: "linux-xdotool",
      text_length: text.length,
      delay_ms: delay,
    };
  }
  if (action === "paste") {
    const text = args?.text === undefined ? null : String(args?.text);
    let fallbackUsed = "none";
    if (text !== null) {
      const hasXclip = await commandExists("xclip", Math.min(timeoutMs, 2_000));
      if (hasXclip) {
        const clipboard = await runNativeCommand(
          "xclip",
          ["-selection", "clipboard"],
          { timeoutMs, input: text },
        );
        ensureNativeCommandOk(clipboard, "xclip");
      } else {
        const typed = await runNativeCommand("xdotool", ["type", "--delay", "6", text], { timeoutMs });
        ensureNativeCommandOk(typed, "xdotool type (paste fallback)");
        fallbackUsed = "typed_text_instead_of_clipboard";
        return {
          driver: "linux-xdotool",
          used_clipboard: false,
          fallback_used: fallbackUsed,
          text_length: text.length,
        };
      }
    }
    const paste = await runNativeCommand("xdotool", ["key", "--clearmodifiers", "ctrl+v"], { timeoutMs });
    ensureNativeCommandOk(paste, "xdotool key ctrl+v");
    return {
      driver: "linux-xdotool",
      used_clipboard: text !== null,
      fallback_used: fallbackUsed,
    };
  }
  if (action === "scroll") {
    const deltaYRaw = Number(args?.delta_y ?? 0);
    const deltaY = Number.isFinite(deltaYRaw) ? Math.max(-1_000, Math.min(1_000, Math.round(deltaYRaw))) : 0;
    if (deltaY === 0) {
      return {
        driver: "linux-xdotool",
        delta_y: 0,
      };
    }
    const button = deltaY > 0 ? "5" : "4";
    const steps = Math.max(1, Math.min(160, Math.abs(deltaY)));
    const scrolled = await runNativeCommand("xdotool", ["click", "--repeat", String(steps), button], { timeoutMs });
    ensureNativeCommandOk(scrolled, "xdotool scroll click");
    return {
      driver: "linux-xdotool",
      delta_y: deltaY,
      steps,
    };
  }
  if (action === "get_window_rect") {
    const windowId = await resolveLinuxWindowId(selector, timeoutMs);
    const geometry = await runNativeCommand("xdotool", ["getwindowgeometry", "--shell", windowId], { timeoutMs });
    ensureNativeCommandOk(geometry, "xdotool getwindowgeometry");
    const parsed = parseWindowGeometryFromShell(geometry.stdout);
    return {
      driver: "linux-xdotool",
      window_id: windowId,
      ...parsed,
    };
  }
  throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: ${action}`);
}

function mapNativeInputError(action, error) {
  if (typeof error?.errorCode === "string" && error.errorCode.trim().length > 0) {
    return error;
  }
  const rawMessage = String(error?.message ?? error ?? "native input execution failed");
  const normalized = rawMessage.toLowerCase();
  if (normalized.includes("enoent")) {
    return createToolError("ACTION_NOT_SUPPORTED", `action not supported: required binary missing for ${action}`);
  }
  if (
    normalized.includes("not permitted")
    || normalized.includes("not authorized")
    || normalized.includes("apple events")
    || normalized.includes("accessibility")
  ) {
    return createToolError("PLATFORM_PERMISSION_REQUIRED", `platform permission required: ${rawMessage}`);
  }
  if (
    normalized.includes("display backend unsupported")
    || normalized.includes("cannot open display")
    || normalized.includes("wayland session")
    || normalized.includes("display is not set")
  ) {
    return createToolError("DISPLAY_BACKEND_UNSUPPORTED", `display backend unsupported: ${rawMessage}`);
  }
  if (normalized.includes("window not found")) {
    return createToolError("WINDOW_NOT_FOUND", `window not found: ${rawMessage}`);
  }
  if (normalized.includes("coordinate out of range")) {
    return createToolError("COORDINATE_OUT_OF_RANGE", rawMessage);
  }
  if (normalized.includes("action not supported")) {
    return createToolError("ACTION_NOT_SUPPORTED", rawMessage);
  }
  return createToolError("NATIVE_INPUT_EXECUTION_FAILED", `native input execution failed action=${action}: ${rawMessage}`);
}

async function handleBrowserNativeInput(args) {
  const action = normalizeNativeInputAction(args?.action);
  const timeoutMs = normalizeNativeInputTimeoutMs(args?.timeout_ms);
  const dryRun = args?.dry_run === true;
  if (action === "capabilities") {
    const capabilities = await detectNativeInputCapabilities();
    return {
      status: "success",
      action,
      timeout_ms: timeoutMs,
      ...capabilities,
      at: nowIso(),
    };
  }
  const validatedArgs = validateNativeInputArguments(action, args ?? {});
  const effectiveArgs = {
    ...(args ?? {}),
    ...validatedArgs,
  };
  if (dryRun) {
    const capabilities = await detectNativeInputCapabilities();
    return buildNativeInputDryRunResponse(action, effectiveArgs, timeoutMs, capabilities);
  }
  try {
    const payload = await executeNativeInputAction(action, effectiveArgs, timeoutMs);
    return {
      status: "success",
      platform: process.platform,
      action,
      dry_run: false,
      timeout_ms: timeoutMs,
      ...payload,
      at: nowIso(),
    };
  } catch (error) {
    throw mapNativeInputError(action, error);
  }
}

async function handleBrowserScan(args) {
  const preferred = await resolvePreferredBrowserContext(args ?? {});
  const resolved = preferred.context;
  const targets = resolved.targets;
  const selected = resolved.target;
  markSessionSelected(selected.id, { make_default: false });
  const metadata = {
    transport: preferred.transport,
    transport_attempts: Array.isArray(preferred.transport_attempts) ? preferred.transport_attempts : [],
    tabs_count: targets.length,
    tabs: asShortTabs(targets),
    active_tab: selected.id,
    cdp_endpoint: preferred.transport === "cdp" ? resolved.endpoint : undefined,
    tmwd_link_endpoint: preferred.transport === "tmwd_link" ? resolved.endpoint : undefined,
    tmwd_ws_endpoint: preferred.transport === "tmwd_ws" ? resolved.endpoint : undefined,
    selection: resolved.selection,
    selection_source: resolved.selection?.selected_by ?? null,
    selection_warning: resolved.selection?.warning ?? undefined,
    sessions: resolved.sessions,
    ...sessionPointers(),
  };
  if (args?.tabs_only === true) {
    return {
      status: "success",
      metadata,
    };
  }
  const textOnly = args?.text_only === true;
  const mainOnly = args?.main_only === true;
  const maxChars = normalizeMaxChars(args?.max_chars);
  let mainOnlyGuardrail;
  let content = "";
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
    const readTmwdContent = async (readTextOnly, readMainOnly) => {
      const tmwdScript = `return ${buildScanContentExpression(readTextOnly, readMainOnly)};`;
      const tmwdExec = await executeTmwdJs(
        {
          ...args,
          session_id: selected.id,
        },
        resolved,
        tmwdScript,
      );
      return String(tmwdExec.value ?? "");
    };
    if (textOnly && mainOnly) {
      const mainContent = await readTmwdContent(true, true);
      const fullContent = await readTmwdContent(true, false);
      const guarded = applyMainOnlyGuardrail(mainContent, fullContent, args);
      content = guarded.content;
      mainOnlyGuardrail = guarded.metadata;
    } else {
      content = await readTmwdContent(textOnly, mainOnly);
    }
  } else {
    const readCdpContent = async (readTextOnly, readMainOnly) => {
      const contentResult = await cdpReadPageContent({
        ...args,
        switch_tab_id: selected.id,
      }, readTextOnly, readMainOnly);
      return String(contentResult.result.content ?? "");
    };
    if (textOnly && mainOnly) {
      const mainContent = await readCdpContent(true, true);
      const fullContent = await readCdpContent(true, false);
      const guarded = applyMainOnlyGuardrail(mainContent, fullContent, args);
      content = guarded.content;
      mainOnlyGuardrail = guarded.metadata;
    } else {
      content = await readCdpContent(textOnly, mainOnly);
    }
  }
  const clipped = clipContent(content, maxChars);
  return {
    status: "success",
    metadata: {
      ...metadata,
      text_only: textOnly,
      main_only: mainOnly,
      main_only_guardrail: textOnly && mainOnly ? mainOnlyGuardrail : undefined,
      truncated: clipped.truncated,
      original_length: clipped.original_length,
      max_chars: maxChars,
    },
    content: clipped.value,
  };
}

async function getTransientTexts(args) {
  try {
    const evalResult = await cdpEvaluateScript(args, `
      const nodes = Array.from(document.querySelectorAll('[role="alert"], [role="status"], [aria-live], .toast, .notification'))
        .map((n) => (n.innerText || '').trim())
        .filter(Boolean)
        .slice(0, 12);
      return nodes;
    `);
    const rows = Array.isArray(evalResult.result.value) ? evalResult.result.value : [];
    return rows.filter((item) => typeof item === "string");
  } catch {
    return [];
  }
}

function resolveNativeAutoFallbackPolicy(args) {
  const normalized = String(args?.native_auto_fallback_policy ?? "balanced").trim().toLowerCase();
  if (normalized === "strict" || normalized === "aggressive") {
    return normalized;
  }
  return "balanced";
}

function buildNativeInputSuggestion(errorCode, errorMessage, policy = "balanced") {
  if (!errorCode) {
    return {
      should_escalate: false,
      policy,
    };
  }
  if (
    policy === "aggressive"
    && (
      errorCode === "NO_EXTENSION"
      || errorCode === "NO_SESSION"
      || errorCode === "TRANSPORT_UNAVAILABLE"
      || errorCode === "TIMEOUT"
    )
  ) {
    return {
      should_escalate: true,
      reason: "transport_or_session_unavailable",
      suggested_tool: "browser_native_input",
      suggested_action: "click",
      note: "Browser transport/session is unavailable; native fallback planning may help recover control.",
      policy,
    };
  }
  if (
    policy === "balanced"
    && (
      errorCode === "NO_EXTENSION"
      || errorCode === "NO_SESSION"
      || errorCode === "TRANSPORT_UNAVAILABLE"
    )
  ) {
    return {
      should_escalate: true,
      reason: "transport_or_session_unavailable",
      suggested_tool: "browser_native_input",
      suggested_action: "click",
      note: "Browser transport/session is unavailable; native fallback planning may help recover control.",
      policy,
    };
  }
  const normalized = String(errorMessage ?? "").toLowerCase();
  if (
    errorCode === "CSP_BLOCKED"
    || errorCode === "CDP_DENIED"
    || (policy === "aggressive" && errorCode === "EXECUTION_ERROR")
  ) {
    return {
      should_escalate: true,
      reason: "browser_policy_blocked",
      suggested_tool: "browser_native_input",
      suggested_action: "click",
      note: "Browser policy blocked JS/CDP path; native input may be required.",
      policy,
    };
  }
  if (
    errorCode === "EXECUTION_ERROR"
    && (
      normalized.includes("istrusted")
      || normalized.includes("is trusted")
      || normalized.includes("user gesture")
      || normalized.includes("file chooser")
      || normalized.includes("picker")
    )
  ) {
    return {
      should_escalate: true,
      reason: "trusted_event_or_native_dialog_required",
      suggested_tool: "browser_native_input",
      suggested_action: "click",
      note: "Page requires trusted/native interaction semantics.",
      policy,
    };
  }
  return {
    should_escalate: false,
    policy,
  };
}

function resolveNativeFallbackAction(args, suggestion) {
  const rawRequested = String(args?.native_fallback_action ?? "").trim();
  const candidate = rawRequested || String(suggestion?.suggested_action ?? "click");
  const action = normalizeNativeInputAction(candidate);
  if (action === "capabilities") {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: native fallback cannot use capabilities");
  }
  return action;
}

function resolveNativeFallbackArgs(args) {
  const raw = args?.native_fallback_args;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw;
  }
  return {};
}

function resolveNativeExecuteActionScope(args) {
  const normalized = String(args?.native_execute_action_scope ?? "non_pointer").trim().toLowerCase();
  if (normalized === "all") {
    return "all";
  }
  return "non_pointer";
}

function isPointerNativeAction(action) {
  return action === "move"
    || action === "click"
    || action === "double_click"
    || action === "scroll";
}

async function executeNativeInputAction(action, effectiveArgs, timeoutMs) {
  if (process.platform === "win32") {
    return runNativeInputWindows(action, effectiveArgs, timeoutMs);
  }
  if (process.platform === "darwin") {
    return runNativeInputMac(action, effectiveArgs, timeoutMs);
  }
  if (process.platform === "linux") {
    return runNativeInputLinux(action, effectiveArgs, timeoutMs);
  }
  throw createToolError("DISPLAY_BACKEND_UNSUPPORTED", `display backend unsupported: platform=${process.platform}`);
}

async function maybeRunNativeFallbackForExecuteJs(
  args,
  errorCode,
  errorMessage,
  policy = resolveNativeAutoFallbackPolicy(args),
) {
  if (args?.native_auto_fallback !== true) {
    return undefined;
  }
  const suggestion = buildNativeInputSuggestion(errorCode, errorMessage, policy);
  if (suggestion.should_escalate !== true) {
    return {
      attempted: false,
      executed: false,
      status: "skipped",
      reason: "no_escalation_signal",
      policy,
      suggestion,
    };
  }
  let action;
  let fallbackArgs;
  let timeoutMs;
  let capabilities;
  let dryRun;
  try {
    action = resolveNativeFallbackAction(args, suggestion);
    fallbackArgs = resolveNativeFallbackArgs(args);
    timeoutMs = normalizeNativeInputTimeoutMs(args?.native_fallback_timeout_ms ?? args?.timeout_ms);
    capabilities = await detectNativeInputCapabilities();
    dryRun = buildNativeInputDryRunResponse(action, fallbackArgs, timeoutMs, capabilities);
  } catch (error) {
    const mapped = mapNativeInputError(String(action ?? "native_fallback"), error);
    return {
      attempted: true,
      executed: false,
      status: "failed",
      reason: "invalid_fallback_plan",
      policy,
      error: String(mapped.message ?? mapped),
      error_code: String(mapped.errorCode ?? "NATIVE_INPUT_EXECUTION_FAILED"),
      retryable: isRetryableBrowserErrorCode(String(mapped.errorCode ?? "NATIVE_INPUT_EXECUTION_FAILED")),
      suggestion,
    };
  }
  const autoExecute = args?.native_auto_execute === true;
  const actionScope = resolveNativeExecuteActionScope(args);
  if (dryRun.next_step !== "safe_to_execute") {
    return {
      attempted: true,
      executed: false,
      status: "blocked",
      reason: "requirements_missing",
      policy,
      suggestion,
      action,
      timeout_ms: timeoutMs,
      dry_run: dryRun,
      capabilities,
      auto_execute: autoExecute,
      action_scope: actionScope,
    };
  }
  if (!autoExecute) {
    return {
      attempted: true,
      executed: false,
      status: "dry_run_only",
      reason: "native_auto_execute_disabled",
      policy,
      suggestion,
      action,
      timeout_ms: timeoutMs,
      dry_run: dryRun,
      capabilities,
      auto_execute: false,
      action_scope: actionScope,
    };
  }
  if (actionScope !== "all" && isPointerNativeAction(action)) {
    return {
      attempted: true,
      executed: false,
      status: "blocked",
      reason: "pointer_action_scope_blocked",
      policy,
      suggestion,
      action,
      timeout_ms: timeoutMs,
      dry_run: dryRun,
      capabilities,
      auto_execute: true,
      action_scope: actionScope,
      required_scope: "all",
    };
  }
  try {
    const payload = await executeNativeInputAction(action, dryRun.validated_args ?? {}, timeoutMs);
    return {
      attempted: true,
      executed: true,
      status: "executed",
      policy,
      suggestion,
      action,
      timeout_ms: timeoutMs,
      payload,
      dry_run: dryRun,
      capabilities,
      auto_execute: true,
      action_scope: actionScope,
    };
  } catch (error) {
    const mapped = mapNativeInputError(action, error);
    return {
      attempted: true,
      executed: false,
      status: "failed",
      reason: "native_execution_failed",
      policy,
      suggestion,
      action,
      timeout_ms: timeoutMs,
      dry_run: dryRun,
      capabilities,
      auto_execute: true,
      action_scope: actionScope,
      error: String(mapped.message ?? mapped),
      error_code: String(mapped.errorCode ?? "NATIVE_INPUT_EXECUTION_FAILED"),
      retryable: isRetryableBrowserErrorCode(String(mapped.errorCode ?? "NATIVE_INPUT_EXECUTION_FAILED")),
    };
  }
}

async function handleBrowserExecuteJs(args) {
  let preferred = null;
  try {
    preferred = await resolvePreferredBrowserContext(args ?? {});
  } catch (contextError) {
    if (args?.native_auto_fallback !== true) {
      throw contextError;
    }
    const errorMessage = String(contextError?.message ?? contextError);
    const errorCode = classifyBrowserErrorCode(errorMessage);
    const nativeAutoFallbackPolicy = resolveNativeAutoFallbackPolicy(args ?? {});
    const nativeInputSuggestion = buildNativeInputSuggestion(errorCode, errorMessage, nativeAutoFallbackPolicy);
    const nativeAutoFallback = await maybeRunNativeFallbackForExecuteJs(
      args ?? {},
      errorCode,
      errorMessage,
      nativeAutoFallbackPolicy,
    );
    let nativeInputCapabilities;
    if (typeof nativeAutoFallback?.capabilities === "object" && nativeAutoFallback.capabilities !== null) {
      nativeInputCapabilities = nativeAutoFallback.capabilities;
    } else if (nativeInputSuggestion.should_escalate === true) {
      try {
        nativeInputCapabilities = await detectNativeInputCapabilities();
      } catch {
        nativeInputCapabilities = undefined;
      }
    }
    const status = nativeAutoFallback?.executed === true ? "fallback_executed" : "failed";
    const transportAttempts = Array.isArray(contextError?.transportAttempts)
      ? contextError.transportAttempts
      : [];
    return {
      status,
      transport: "unresolved",
      transport_attempts: transportAttempts,
      js_return: null,
      error: errorMessage,
      error_code: errorCode,
      retryable: isRetryableBrowserErrorCode(errorCode),
      native_input_suggested: nativeInputSuggestion.should_escalate === true,
      native_input_hint: nativeInputSuggestion.should_escalate === true ? nativeInputSuggestion : undefined,
      native_input_capabilities: nativeInputSuggestion.should_escalate === true ? nativeInputCapabilities : undefined,
      native_auto_fallback: nativeAutoFallback,
      tab_id: activeTargetId || undefined,
      session_id: activeTargetId || undefined,
      selection: undefined,
      selection_source: null,
      selection_warning: undefined,
      newTabs: [],
      reloaded: false,
      transients: [],
      diff: "context resolution failed before script execution",
      sessions: listSessionsSnapshot(),
      ...sessionPointers(),
      environment: {
        newTabs: [],
        reloaded: false,
      },
    };
  }
  const scriptInput = resolveExecuteJsScriptInput(args ?? {});
  const command = parseBridgeCommand(scriptInput.value);
  let jsReturn = null;
  let error = "";
  let responseTransport = preferred.transport;
  let executeTransportAttempts = [];
  let tabId = preferred.context.target.id;
  let selection = preferred.context.selection;
  let beforeTargets = preferred.context.targets;
  let afterTargets = preferred.context.targets;
  let newTabs = [];
  try {
    if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
      const codePayload = command ?? String(scriptInput.value ?? "");
      const tmwdExecution = await executeTmwdJsWithFallback(
        args ?? {},
        preferred.context,
        codePayload,
      );
      const executed = tmwdExecution.executed;
      preferred = {
        ...preferred,
        context: tmwdExecution.context,
      };
      responseTransport = normalizeTmwdTransportLabel(tmwdExecution.context.tmwd_transport);
      executeTransportAttempts = Array.isArray(tmwdExecution.transport_attempts)
        ? tmwdExecution.transport_attempts
        : [];
      jsReturn = executed.value;
      newTabs = executed.newTabs;
      selection = tmwdExecution.context.selection ?? selection;
      if (executed.raw && typeof executed.raw === "object") {
        if (executed.raw.ok === false) {
          error = String(executed.raw.error ?? "tmwd bridge command failed");
        }
        if (typeof executed.raw.tab_id === "string" && executed.raw.tab_id.trim().length > 0) {
          tabId = executed.raw.tab_id.trim();
        }
      }
      if (Array.isArray(newTabs) && newTabs.length > 0) {
        const normalizedNewTabs = newTabs.map((item) => ({
          id: normalizeIdToken(item?.id ?? item?.tabId),
          url: String(item?.url ?? ""),
          title: String(item?.title ?? ""),
          active: false,
        })).filter((item) => item.id.length > 0);
        if (normalizedNewTabs.length > 0) {
          syncSessionRegistry(normalizedNewTabs);
        }
      }
      try {
        const refreshed = await resolveTmwdContext(
          {
            ...args,
            tmwd_transport: tmwdExecution.context.tmwd_transport,
            session_id: tabId,
          },
          { probe: false },
        );
        afterTargets = refreshed.targets;
        selection = refreshed.selection;
      } catch {
        afterTargets = beforeTargets;
      }
    } else if (command) {
      const commandResult = await runBridgeCommand(command, args);
      jsReturn = commandResult;
      if (commandResult && typeof commandResult === "object") {
        if (commandResult.ok === false) {
          error = String(commandResult.error ?? "bridge command failed");
        }
        if (commandResult.selection && typeof commandResult.selection === "object") {
          selection = commandResult.selection;
        }
      }
      if (typeof command?.tabId === "string" && command.tabId.trim().length > 0) {
        tabId = command.tabId.trim();
      } else if (typeof command?.tab_id === "string" && command.tab_id.trim().length > 0) {
        tabId = command.tab_id.trim();
      } else if (typeof commandResult?.tab_id === "string" && commandResult.tab_id.trim().length > 0) {
        tabId = commandResult.tab_id.trim();
      } else if (typeof command?.sessionId === "string" && command.sessionId.trim().length > 0) {
        tabId = command.sessionId.trim();
      } else if (typeof command?.session_id === "string" && command.session_id.trim().length > 0) {
        tabId = command.session_id.trim();
      }
      afterTargets = await fetchCdpTargets(normalizeEndpoint(args?.cdp_endpoint));
      syncSessionRegistry(afterTargets);
    } else {
      const executed = await cdpEvaluateScript(args, String(scriptInput.value ?? ""));
      jsReturn = executed.result.value;
      tabId = executed.target.id;
      selection = executed.result.selection;
      afterTargets = await fetchCdpTargets(normalizeEndpoint(args?.cdp_endpoint));
      syncSessionRegistry(afterTargets);
    }
  } catch (execError) {
    error = String(execError?.message ?? execError);
    if (Array.isArray(execError?.transportAttempts)) {
      executeTransportAttempts = execError.transportAttempts;
    }
  }
  if (tabId) {
    markSessionSelected(tabId, { make_default: false });
  }
  if (preferred.transport === "cdp") {
    const beforeIds = new Set(beforeTargets.map((item) => item.id));
    newTabs = afterTargets
      .filter((item) => !beforeIds.has(item.id))
      .map((item) => ({ id: item.id, url: item.url, title: item.title }));
  }
  const noMonitor = args?.no_monitor === true;
  const transients = noMonitor || preferred.transport !== "cdp" ? [] : await getTransientTexts(args);
  const diff = noMonitor
    ? "monitor skipped (no_monitor=true)"
    : (newTabs.length > 0 ? `DOM变化监控：检测到 ${String(newTabs.length)} 个新标签页` : "DOM变化监控：未检测到显著结构变化");
  const errorCode = error ? classifyBrowserErrorCode(error) : undefined;
  const nativeAutoFallbackPolicy = resolveNativeAutoFallbackPolicy(args ?? {});
  const nativeInputSuggestion = buildNativeInputSuggestion(errorCode, error, nativeAutoFallbackPolicy);
  const nativeAutoFallback = error
    ? await maybeRunNativeFallbackForExecuteJs(args ?? {}, errorCode, error, nativeAutoFallbackPolicy)
    : undefined;
  let nativeInputCapabilities;
  if (typeof nativeAutoFallback?.capabilities === "object" && nativeAutoFallback.capabilities !== null) {
    nativeInputCapabilities = nativeAutoFallback.capabilities;
  } else if (nativeInputSuggestion.should_escalate === true) {
    try {
      nativeInputCapabilities = await detectNativeInputCapabilities();
    } catch {
      nativeInputCapabilities = undefined;
    }
  }
  const status = error
    ? (nativeAutoFallback?.executed === true ? "fallback_executed" : "failed")
    : "success";
  return {
    status,
    transport: responseTransport,
    transport_attempts: mergeTransportAttempts(
      preferred.transport_attempts,
      executeTransportAttempts,
    ),
    js_return: jsReturn,
    error: error || undefined,
    error_code: errorCode,
    retryable: errorCode ? isRetryableBrowserErrorCode(errorCode) : undefined,
    native_input_suggested: nativeInputSuggestion.should_escalate === true,
    native_input_hint: nativeInputSuggestion.should_escalate === true ? nativeInputSuggestion : undefined,
    native_input_capabilities: nativeInputSuggestion.should_escalate === true ? nativeInputCapabilities : undefined,
    native_auto_fallback: nativeAutoFallback,
    tab_id: tabId || activeTargetId || undefined,
    session_id: tabId || activeTargetId || undefined,
    selection,
    selection_source: selection?.selected_by ?? null,
    selection_warning: selection?.warning ?? undefined,
    newTabs,
    reloaded: false,
    transients,
    diff,
    sessions: listSessionsSnapshot(),
    ...sessionPointers(),
    environment: {
      newTabs,
      reloaded: false,
    },
    script_source: scriptInput.source,
  };
}

async function handleBrowserExtract(args) {
  let html = "";
  let transport = "cdp";
  let tmwdLinkEndpoint;
  let tmwdWsEndpoint;
  let selection;
  let transportAttempts = [];
  if (typeof args?.html === "string" && args.html.length > 0) {
    html = args.html;
    } else {
      const preferred = await resolvePreferredBrowserContext(args ?? {});
      transport = preferred.transport;
      transportAttempts = Array.isArray(preferred.transport_attempts) ? preferred.transport_attempts : [];
      tmwdLinkEndpoint = preferred.transport === "tmwd_link" ? preferred.context.endpoint : undefined;
      tmwdWsEndpoint = preferred.transport === "tmwd_ws" ? preferred.context.endpoint : undefined;
      selection = preferred.context.selection;
      if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
        const executed = await executeTmwdJs(
          {
          ...args,
          session_id: preferred.context.target.id,
        },
        preferred.context,
        "return (() => document.documentElement.outerHTML)();",
        );
        html = String(executed.value ?? "");
      } else {
        const page = await cdpReadPageContent(args ?? {}, false);
        html = page.result.content;
      }
  }
  const limitRaw = Number(args?.selector_limit ?? 120);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(300, Math.floor(limitRaw)))
    : 120;
  const nodes = extractActionableNodes(html, limit);
  return {
    transport,
    transport_attempts: transportAttempts,
    tmwd_link_endpoint: tmwdLinkEndpoint,
    tmwd_ws_endpoint: tmwdWsEndpoint,
    selection,
    selection_source: selection?.selected_by ?? null,
    selection_warning: selection?.warning ?? undefined,
    page_fingerprint: hashText(html),
    actionable_nodes: nodes,
    state_transients: [],
    evidence_snapshot_ref: `snapshot_${hashText(html).slice(0, 12)}`,
    fallback_used: "none",
    active_tab: activeTargetId || null,
  };
}

function handleBrowserDiff(args) {
  const toLines = (value) => String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const beforeLines = new Set(toLines(args?.before ?? ""));
  const afterLines = new Set(toLines(args?.after ?? ""));
  const added = [];
  const removed = [];
  for (const line of afterLines) {
    if (!beforeLines.has(line)) {
      added.push(hashText(line).slice(0, 12));
    }
  }
  for (const line of beforeLines) {
    if (!afterLines.has(line)) {
      removed.push(hashText(line).slice(0, 12));
    }
  }
  return {
    added_signatures: added.slice(0, 200),
    removed_signatures: removed.slice(0, 200),
    before_fingerprint: hashText(String(args?.before ?? "")),
    after_fingerprint: hashText(String(args?.after ?? "")),
  };
}

async function handleBrowserTabOps(args) {
  const op = String(args?.op ?? "").trim().toLowerCase();
  if (op === "current" || op === "current_session") {
    return {
      status: "ok",
      active_tab: activeTargetId || null,
      ...sessionPointers(),
    };
  }
  const preferred = await resolvePreferredBrowserContext(args ?? {});
  const tabs = preferred.context.targets;
  const transportAttempts = Array.isArray(preferred.transport_attempts) ? preferred.transport_attempts : [];
  if (op === "set_session") {
    const pattern = String(args?.url_pattern ?? "").trim();
    if (!pattern) {
      return {
        status: "error",
        msg: "url_pattern is required for op=set_session",
      };
    }
    const matched = resolveSessionByPattern(tabs, pattern);
    if (matched.length === 0) {
      return {
        status: "error",
        msg: `no session matched pattern: ${pattern}`,
        ...sessionPointers(),
      };
    }
    markSessionSelected(matched[0].id, { make_default: true });
    return {
      status: "ok",
      selected: matched[0].id,
      matched: asShortTabs(matched),
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      selection_source: "url_pattern",
      ...sessionPointers(),
    };
  }
  if (op === "find_session") {
    const pattern = String(args?.url_pattern ?? "").trim();
    return {
      status: "ok",
      pattern,
      matched: asShortTabs(resolveSessionByPattern(tabs, pattern)),
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      ...sessionPointers(),
    };
  }
  if (op === "list_sessions") {
    return {
      status: "ok",
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      sessions: listSessionsSnapshot({
        include_disconnected: args?.include_disconnected === true,
      }),
      ...sessionPointers(),
    };
  }
  if (op === "switch") {
    const tabId = String(args?.tab_id ?? args?.session_id ?? "").trim();
    if (!tabId) {
      return {
        status: "error",
        msg: "tab_id or session_id is required for op=switch",
      };
    }
    if (!tabs.some((item) => item.id === tabId)) {
      return {
        status: "error",
        msg: `tab not found: ${tabId}`,
      };
    }
    markSessionSelected(tabId, { make_default: false });
    return {
      status: "ok",
      active_tab: tabId,
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      selection_source: "session_id",
      ...sessionPointers(),
    };
  }
  if (op === "list") {
    return {
      status: "ok",
      transport: preferred.transport,
      transport_attempts: transportAttempts,
      tabs_count: tabs.length,
      tabs: asShortTabs(tabs),
      active_tab: activeTargetId || null,
      sessions: listSessionsSnapshot(),
      ...sessionPointers(),
    };
  }
  return {
    status: "error",
    msg: `unsupported op: ${op}`,
  };
}

async function dispatchToolCall(name, args) {
  try {
    if (name === "browser_scan") {
      return makeResult(await handleBrowserScan(args));
    }
    if (name === "browser_execute_js") {
      return makeResult(await handleBrowserExecuteJs(args));
    }
    if (name === "browser_extract") {
      return makeResult(await handleBrowserExtract(args));
    }
    if (name === "browser_diff") {
      return makeResult(handleBrowserDiff(args));
    }
    if (name === "browser_tab_ops") {
      return makeResult(await handleBrowserTabOps(args));
    }
    if (name === "browser_native_input") {
      return makeResult(await handleBrowserNativeInput(args));
    }
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `unknown tool: ${String(name)}`,
        },
      ],
    };
  } catch (error) {
    return makeErrorPayload(name, error);
  }
}

function sendResponse(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function sendError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function handleRequest(request) {
  const { id, method, params } = request;
  if (!method || typeof method !== "string") {
    sendError(id ?? null, -32600, "invalid request: missing method");
    return;
  }
  if (method === "initialize") {
    sendResponse(id, {
      protocolVersion: "2024-11-05",
      serverInfo: {
        name: "browser-structured-mcp",
        version: VERSION,
      },
      capabilities: {
        tools: {},
      },
    });
    return;
  }
  if (method === "tools/list") {
    const tools = Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
      name,
      description: schema.description,
      inputSchema: schema.inputSchema,
    }));
    sendResponse(id, { tools });
    return;
  }
  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments ?? {};
    if (typeof toolName !== "string") {
      sendError(id ?? null, -32602, "tools/call requires string params.name");
      return;
    }
    dispatchToolCall(toolName, args)
      .then((result) => {
        sendResponse(id, result);
      })
      .catch((error) => {
        sendError(id ?? null, -32000, `tool execution failed: ${String(error)}`);
      });
    return;
  }
  if (method === "notifications/initialized") {
    return;
  }
  sendError(id ?? null, -32601, `method not found: ${method}`);
}

const rl = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  const raw = line.trim();
  if (!raw) {
    return;
  }
  try {
    const request = JSON.parse(raw);
    handleRequest(request);
  } catch (error) {
    sendError(null, -32700, `parse error: ${String(error)}`);
  }
});
