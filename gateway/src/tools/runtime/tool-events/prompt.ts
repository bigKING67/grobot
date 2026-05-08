import { RUNTIME_TOOL_RECOVERY_PROMPT_MAX_CHARS } from "./contract";
import { compactRecoveryDetail, normalizeRecord } from "./payload";

function joinRecoveryPromptLines(lines: readonly string[]): string {
  return lines.join("\n");
}

export function compactRuntimeToolRecoveryPrompt(input: {
  requiredLines: readonly (string | null | undefined)[];
  detailLines: readonly (string | null | undefined)[];
}): string {
  const requiredLines = input.requiredLines.filter((line): line is string => typeof line === "string");
  const detailLines = input.detailLines.filter((line): line is string => typeof line === "string");
  const fullPrompt = joinRecoveryPromptLines([...requiredLines, ...detailLines]);
  if (fullPrompt.length <= RUNTIME_TOOL_RECOVERY_PROMPT_MAX_CHARS) {
    return fullPrompt;
  }

  const output = [...requiredLines];
  let omittedCount = 0;
  for (const line of detailLines) {
    const candidate = joinRecoveryPromptLines([...output, line]);
    if (candidate.length <= RUNTIME_TOOL_RECOVERY_PROMPT_MAX_CHARS) {
      output.push(line);
    } else {
      omittedCount += 1;
    }
  }

  if (omittedCount > 0) {
    let marker =
      `Details truncated: omitted ${String(omittedCount)} low-priority recovery detail line(s) to stay within prompt budget=${String(RUNTIME_TOOL_RECOVERY_PROMPT_MAX_CHARS)} chars.`;
    while (
      output.length > requiredLines.length
      && joinRecoveryPromptLines([...output, marker]).length > RUNTIME_TOOL_RECOVERY_PROMPT_MAX_CHARS
    ) {
      output.pop();
      omittedCount += 1;
      marker =
        `Details truncated: omitted ${String(omittedCount)} low-priority recovery detail line(s) to stay within prompt budget=${String(RUNTIME_TOOL_RECOVERY_PROMPT_MAX_CHARS)} chars.`;
    }
    if (joinRecoveryPromptLines([...output, marker]).length <= RUNTIME_TOOL_RECOVERY_PROMPT_MAX_CHARS) {
      output.push(marker);
    } else {
      const compactMarker = `Details truncated: omitted ${String(omittedCount)} detail line(s).`;
      if (joinRecoveryPromptLines([...output, compactMarker]).length <= RUNTIME_TOOL_RECOVERY_PROMPT_MAX_CHARS) {
        output.push(compactMarker);
      }
    }
  }
  return joinRecoveryPromptLines(output);
}

function quoteRecoveryPreview(value: string): string {
  return JSON.stringify(compactRecoveryDetail(value) ?? "") ?? "\"\"";
}

function pushCompactStringPart(
  parts: string[],
  label: string,
  value: unknown,
  options?: { quote?: boolean },
): void {
  const compact = typeof value === "string" ? compactRecoveryDetail(value) : undefined;
  if (!compact) {
    return;
  }
  parts.push(`${label}=${options?.quote ? quoteRecoveryPreview(compact) : compact}`);
}

function pushFiniteNumberPart(parts: string[], label: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return;
  }
  parts.push(`${label}=${String(Math.trunc(value))}`);
}

function pushBooleanPart(parts: string[], label: string, value: unknown): void {
  if (typeof value !== "boolean") {
    return;
  }
  parts.push(`${label}=${String(value)}`);
}

function compactRecoveryCandidateList(label: string, value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const rows = value
    .map((item) => {
      const row = normalizeRecord(item);
      const line = typeof row.line === "number" && Number.isFinite(row.line) ? Math.trunc(row.line) : null;
      const preview = typeof row.preview === "string" ? row.preview : "";
      if (line === null && !preview.trim()) {
        return null;
      }
      if (line === null) {
        return quoteRecoveryPreview(preview);
      }
      if (!preview.trim()) {
        return `line ${String(line)}`;
      }
      return `line ${String(line)} ${quoteRecoveryPreview(preview)}`;
    })
    .filter((item): item is string => typeof item === "string")
    .slice(0, 4);
  if (rows.length === 0) {
    return undefined;
  }
  return `${label}=${rows.join(", ")}`;
}

function compactRecoveryStringList(label: string, value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  const rows = normalized.map((item) => quoteRecoveryPreview(item)).slice(0, 4);
  if (rows.length === 0) {
    return undefined;
  }
  const overflow = normalized.length > rows.length ? `,+${String(normalized.length - rows.length)}` : "";
  return `${label}=[${rows.join(",")}${overflow}]`;
}

export function compactRecoveryErrorData(errorData: Record<string, unknown> | undefined): string | undefined {
  if (!errorData) {
    return undefined;
  }
  const parts: string[] = [];
  const diagnostics = normalizeRecord(errorData.diagnostics);
  const diagnosticKind = typeof errorData.diagnostic_kind === "string" && errorData.diagnostic_kind.trim()
    ? errorData.diagnostic_kind.trim()
    : typeof diagnostics.diagnostic_kind === "string" && diagnostics.diagnostic_kind.trim()
      ? diagnostics.diagnostic_kind.trim()
      : undefined;
  const browserLike =
    typeof errorData.backend === "string"
    || typeof errorData.mapped_tool === "string"
    || typeof errorData.browser_context_kind === "string"
    || typeof errorData.transport_attempts_count === "number";
  if (browserLike && diagnosticKind) {
    parts.push(`diagnostic_kind=${diagnosticKind}`);
  }
  const recoveryStage = typeof errorData.recovery_stage === "string"
    ? compactRecoveryDetail(errorData.recovery_stage)
    : undefined;
  if (recoveryStage) {
    parts.push(`recovery_stage=${recoveryStage}`);
  }
  const recommendedNextAction = typeof errorData.recommended_next_action === "string"
    ? compactRecoveryDetail(errorData.recommended_next_action)
    : undefined;
  if (recommendedNextAction) {
    parts.push(`recommended_next_action=${recommendedNextAction}`);
  }
  const browserTool = typeof errorData.tool === "string" ? compactRecoveryDetail(errorData.tool) : undefined;
  if (browserLike && browserTool) {
    parts.push(`tool=${browserTool}`);
  }
  const server = typeof errorData.server === "string" ? compactRecoveryDetail(errorData.server) : undefined;
  if (server) {
    parts.push(`server=${server}`);
  }
  const serverKey = typeof errorData.server_key === "string" ? compactRecoveryDetail(errorData.server_key) : undefined;
  if (serverKey) {
    parts.push(`server_key=${serverKey}`);
  }
  const toolName = typeof errorData.tool_name === "string" ? compactRecoveryDetail(errorData.tool_name) : undefined;
  if (toolName) {
    parts.push(`tool_name=${toolName}`);
  }
  pushCompactStringPart(parts, "provider", errorData.provider);
  pushCompactStringPart(parts, "provider_kind", errorData.provider_kind);
  pushCompactStringPart(parts, "model", errorData.model);
  const backend = typeof errorData.backend === "string" ? compactRecoveryDetail(errorData.backend) : undefined;
  if (backend) {
    parts.push(`backend=${backend}`);
  }
  const backendServer =
    typeof errorData.backend_server === "string" ? compactRecoveryDetail(errorData.backend_server) : undefined;
  if (backendServer) {
    parts.push(`backend_server=${backendServer}`);
  }
  const mappedTool =
    typeof errorData.mapped_tool === "string" ? compactRecoveryDetail(errorData.mapped_tool) : undefined;
  if (mappedTool) {
    parts.push(`mapped_tool=${mappedTool}`);
  }
  const operation = typeof errorData.operation === "string" ? compactRecoveryDetail(errorData.operation) : undefined;
  if (operation) {
    parts.push(`operation=${operation}`);
  }
  const semanticLike =
    typeof errorData.bridge_command === "string"
    || typeof errorData.bridge_error_class === "string"
    || typeof errorData.source_roots_count === "number";
  if (semanticLike && diagnosticKind) {
    parts.push(`diagnostic_kind=${diagnosticKind}`);
  }
  const tool = typeof errorData.tool === "string" ? compactRecoveryDetail(errorData.tool) : undefined;
  if (tool && !browserLike) {
    parts.push(`tool=${tool}`);
  }
  const toolSurfaceProfile =
    typeof errorData.tool_surface_profile === "string"
      ? compactRecoveryDetail(errorData.tool_surface_profile)
      : undefined;
  if (toolSurfaceProfile) {
    parts.push(`tool_surface_profile=${toolSurfaceProfile}`);
  }
  const bridgeCommand =
    typeof errorData.bridge_command === "string" ? compactRecoveryDetail(errorData.bridge_command) : undefined;
  if (bridgeCommand) {
    parts.push(`bridge_command=${bridgeCommand}`);
  }
  const source = typeof errorData.source === "string" ? compactRecoveryDetail(errorData.source) : undefined;
  if (source) {
    parts.push(`source=${source}`);
  }
  pushCompactStringPart(parts, "stage", errorData.stage);
  pushCompactStringPart(parts, "purpose", errorData.purpose);
  pushCompactStringPart(parts, "file_id", errorData.file_id);
  pushCompactStringPart(parts, "upstream_error_kind", errorData.upstream_error_kind);
  pushCompactStringPart(parts, "thinking", errorData.thinking);
  const path = typeof errorData.path === "string" ? compactRecoveryDetail(errorData.path) : undefined;
  if (path) {
    parts.push(`path=${path}`);
  }
  const candidatePath =
    typeof errorData.candidate_path === "string" ? compactRecoveryDetail(errorData.candidate_path) : undefined;
  if (candidatePath) {
    parts.push(`candidate_path=${candidatePath}`);
  }
  const reason = typeof errorData.reason === "string" ? compactRecoveryDetail(errorData.reason) : undefined;
  if (reason) {
    parts.push(`reason=${reason}`);
  }
  if (typeof errorData.edit_index === "number" && Number.isFinite(errorData.edit_index)) {
    parts.push(`edit_index=${String(Math.trunc(errorData.edit_index))}`);
  }
  if (typeof errorData.match_mode === "string" && errorData.match_mode.trim()) {
    parts.push(`match_mode=${errorData.match_mode.trim()}`);
  }
  if (typeof errorData.match_count === "number" && Number.isFinite(errorData.match_count)) {
    parts.push(`match_count=${String(Math.trunc(errorData.match_count))}`);
  }
  if (typeof errorData.allowlist_rule_count === "number" && Number.isFinite(errorData.allowlist_rule_count)) {
    parts.push(`allowlist_rule_count=${String(Math.trunc(errorData.allowlist_rule_count))}`);
  }
  if (typeof errorData.in_flight === "number" && Number.isFinite(errorData.in_flight)) {
    parts.push(`in_flight=${String(Math.trunc(errorData.in_flight))}`);
  }
  if (typeof errorData.queue_waiting === "number" && Number.isFinite(errorData.queue_waiting)) {
    parts.push(`queue_waiting=${String(Math.trunc(errorData.queue_waiting))}`);
  }
  if (typeof errorData.source_roots_count === "number" && Number.isFinite(errorData.source_roots_count)) {
    parts.push(`source_roots_count=${String(Math.trunc(errorData.source_roots_count))}`);
  }
  if (typeof errorData.bridge_exit_status === "number" && Number.isFinite(errorData.bridge_exit_status)) {
    parts.push(`bridge_exit_status=${String(Math.trunc(errorData.bridge_exit_status))}`);
  }
  if (typeof errorData.matched_files === "number" && Number.isFinite(errorData.matched_files)) {
    parts.push(`matched_files=${String(Math.trunc(errorData.matched_files))}`);
  }
  if (typeof errorData.source_count === "number" && Number.isFinite(errorData.source_count)) {
    parts.push(`source_count=${String(Math.trunc(errorData.source_count))}`);
  }
  pushFiniteNumberPart(parts, "http_status", errorData.http_status);
  pushFiniteNumberPart(parts, "attempt", errorData.attempt);
  pushFiniteNumberPart(parts, "max_attempts", errorData.max_attempts);
  pushFiniteNumberPart(parts, "model_count", errorData.model_count);
  pushFiniteNumberPart(parts, "tool_round", errorData.tool_round);
  pushFiniteNumberPart(parts, "max_tool_rounds", errorData.max_tool_rounds);
  pushFiniteNumberPart(parts, "batch_index", errorData.batch_index);
  pushFiniteNumberPart(parts, "tool_call_index", errorData.tool_call_index);
  if (
    typeof errorData.transport_attempts_count === "number"
    && Number.isFinite(errorData.transport_attempts_count)
  ) {
    parts.push(`transport_attempts_count=${String(Math.trunc(errorData.transport_attempts_count))}`);
  }
  if (
    typeof errorData.max_concurrency_per_server === "number"
    && Number.isFinite(errorData.max_concurrency_per_server)
  ) {
    parts.push(`max_concurrency_per_server=${String(Math.trunc(errorData.max_concurrency_per_server))}`);
  }
  if (typeof errorData.max_queue_per_server === "number" && Number.isFinite(errorData.max_queue_per_server)) {
    parts.push(`max_queue_per_server=${String(Math.trunc(errorData.max_queue_per_server))}`);
  }
  if (typeof errorData.argument_bytes === "number" && Number.isFinite(errorData.argument_bytes)) {
    parts.push(`argument_bytes=${String(Math.trunc(errorData.argument_bytes))}`);
  }
  if (typeof errorData.max_argument_bytes === "number" && Number.isFinite(errorData.max_argument_bytes)) {
    parts.push(`max_argument_bytes=${String(Math.trunc(errorData.max_argument_bytes))}`);
  }
  if (
    typeof errorData.circuit_open_until_epoch_secs === "number"
    && Number.isFinite(errorData.circuit_open_until_epoch_secs)
  ) {
    parts.push(`circuit_open_until_epoch_secs=${String(Math.trunc(errorData.circuit_open_until_epoch_secs))}`);
  }
  if (typeof errorData.enabled === "boolean") {
    parts.push(`enabled=${String(errorData.enabled)}`);
  }
  if (typeof errorData.ready === "boolean") {
    parts.push(`ready=${String(errorData.ready)}`);
  }
  if (typeof errorData.is_error === "boolean") {
    parts.push(`is_error=${String(errorData.is_error)}`);
  }
  if (typeof errorData.retryable === "boolean") {
    parts.push(`retryable=${String(errorData.retryable)}`);
  }
  pushBooleanPart(parts, "kimi_reasoning_context_error", errorData.kimi_reasoning_context_error);
  pushBooleanPart(parts, "kimi_temperature_validation_error", errorData.kimi_temperature_validation_error);
  if (typeof errorData.advanced_tool_schema === "boolean") {
    parts.push(`advanced_tool_schema=${String(errorData.advanced_tool_schema)}`);
  }
  if (typeof errorData.facade_default_tmwd_mode_applied === "boolean") {
    parts.push(`facade_default_tmwd_mode_applied=${String(errorData.facade_default_tmwd_mode_applied)}`);
  }
  const readyReason =
    typeof errorData.ready_reason === "string" ? compactRecoveryDetail(errorData.ready_reason) : undefined;
  if (readyReason) {
    parts.push(`ready_reason=${readyReason}`);
  }
  const deniedSegment =
    typeof errorData.denied_segment === "string" ? compactRecoveryDetail(errorData.denied_segment) : undefined;
  if (deniedSegment) {
    parts.push(`denied_segment=${quoteRecoveryPreview(deniedSegment)}`);
  }
  if (typeof errorData.timeout_ms === "number" && Number.isFinite(errorData.timeout_ms)) {
    parts.push(`timeout_ms=${String(Math.trunc(errorData.timeout_ms))}`);
  }
  if (typeof errorData.duration_ms === "number" && Number.isFinite(errorData.duration_ms)) {
    parts.push(`duration_ms=${String(Math.trunc(errorData.duration_ms))}`);
  }
  const nodeBin = typeof errorData.node_bin === "string" ? compactRecoveryDetail(errorData.node_bin) : undefined;
  if (nodeBin) {
    parts.push(`node_bin=${nodeBin}`);
  }
  const bridgeScript =
    typeof errorData.bridge_script === "string" ? compactRecoveryDetail(errorData.bridge_script) : undefined;
  if (bridgeScript) {
    parts.push(`bridge_script=${quoteRecoveryPreview(bridgeScript)}`);
  }
  const bridgeScriptOverride = typeof errorData.bridge_script_override === "string"
    ? compactRecoveryDetail(errorData.bridge_script_override)
    : undefined;
  if (bridgeScriptOverride) {
    parts.push(`bridge_script_override=${quoteRecoveryPreview(bridgeScriptOverride)}`);
  }
  const indexConfigPath =
    typeof errorData.index_config_path === "string" ? compactRecoveryDetail(errorData.index_config_path) : undefined;
  if (indexConfigPath) {
    parts.push(`index_config_path=${quoteRecoveryPreview(indexConfigPath)}`);
  }
  const rpcErrorCode = errorData.rpc_error_code;
  if (
    (typeof rpcErrorCode === "number" && Number.isFinite(rpcErrorCode))
    || (typeof rpcErrorCode === "string" && rpcErrorCode.trim())
  ) {
    parts.push(`rpc_error_code=${String(rpcErrorCode)}`);
  }
  const rpcErrorMessage =
    typeof errorData.rpc_error_message === "string" ? compactRecoveryDetail(errorData.rpc_error_message) : undefined;
  if (rpcErrorMessage) {
    parts.push(`rpc_error_message=${quoteRecoveryPreview(rpcErrorMessage)}`);
  }
  const backendStatus =
    typeof errorData.backend_status === "string" ? compactRecoveryDetail(errorData.backend_status) : undefined;
  if (backendStatus) {
    parts.push(`backend_status=${backendStatus}`);
  }
  const errorCode = typeof errorData.error_code === "string" ? compactRecoveryDetail(errorData.error_code) : undefined;
  if (errorCode) {
    parts.push(`error_code=${errorCode}`);
  }
  const transport = typeof errorData.transport === "string" ? compactRecoveryDetail(errorData.transport) : undefined;
  if (transport) {
    parts.push(`transport=${transport}`);
  }
  const browserContextKind =
    typeof errorData.browser_context_kind === "string"
      ? compactRecoveryDetail(errorData.browser_context_kind)
      : undefined;
  if (browserContextKind) {
    parts.push(`browser_context_kind=${browserContextKind}`);
  }
  const diagnosticHint =
    typeof errorData.diagnostic_hint === "string" ? compactRecoveryDetail(errorData.diagnostic_hint) : undefined;
  if (diagnosticHint) {
    parts.push(`diagnostic_hint=${quoteRecoveryPreview(diagnosticHint)}`);
  }
  pushCompactStringPart(parts, "recovery_hint", errorData.recovery_hint, { quote: true });
  pushCompactStringPart(parts, "body_preview", errorData.body_preview, { quote: true });
  pushCompactStringPart(parts, "response_headers", errorData.response_headers, { quote: true });
  const resultPreview =
    typeof errorData.result_preview === "string" ? compactRecoveryDetail(errorData.result_preview) : undefined;
  if (resultPreview) {
    parts.push(`result_preview=${quoteRecoveryPreview(resultPreview)}`);
  }
  const structuredContentPreview = typeof errorData.structured_content_preview === "string"
    ? compactRecoveryDetail(errorData.structured_content_preview)
    : undefined;
  if (structuredContentPreview) {
    parts.push(`structured_content_preview=${quoteRecoveryPreview(structuredContentPreview)}`);
  }
  const argumentPreview =
    typeof errorData.argument_preview === "string" ? compactRecoveryDetail(errorData.argument_preview) : undefined;
  if (argumentPreview) {
    parts.push(`argument_preview=${quoteRecoveryPreview(argumentPreview)}`);
  }
  const bridgeErrorClass =
    typeof errorData.bridge_error_class === "string" ? compactRecoveryDetail(errorData.bridge_error_class) : undefined;
  if (bridgeErrorClass) {
    parts.push(`bridge_error_class=${bridgeErrorClass}`);
  }
  const bridgeErrorMessage = typeof errorData.bridge_error_message === "string"
    ? compactRecoveryDetail(errorData.bridge_error_message)
    : undefined;
  if (bridgeErrorMessage) {
    parts.push(`bridge_error_message=${quoteRecoveryPreview(bridgeErrorMessage)}`);
  }
  const causeErrorClass =
    typeof errorData.cause_error_class === "string" ? compactRecoveryDetail(errorData.cause_error_class) : undefined;
  if (causeErrorClass) {
    parts.push(`cause_error_class=${causeErrorClass}`);
  }
  const causeErrorMessage = typeof errorData.cause_error_message === "string"
    ? compactRecoveryDetail(errorData.cause_error_message)
    : undefined;
  if (causeErrorMessage) {
    parts.push(`cause_error_message=${quoteRecoveryPreview(causeErrorMessage)}`);
  }
  const rawMessage =
    typeof errorData.raw_message === "string" ? compactRecoveryDetail(errorData.raw_message) : undefined;
  if (rawMessage) {
    parts.push(`raw_message=${quoteRecoveryPreview(rawMessage)}`);
  }
  const stderrPreview =
    typeof errorData.stderr_preview === "string" ? compactRecoveryDetail(errorData.stderr_preview) : undefined;
  if (stderrPreview) {
    parts.push(`stderr_preview=${quoteRecoveryPreview(stderrPreview)}`);
  }
  const stdoutPreview =
    typeof errorData.stdout_preview === "string" ? compactRecoveryDetail(errorData.stdout_preview) : undefined;
  if (stdoutPreview) {
    parts.push(`stdout_preview=${quoteRecoveryPreview(stdoutPreview)}`);
  }

  if (diagnosticKind && !semanticLike && !browserLike) {
    parts.push(`diagnostic_kind=${diagnosticKind}`);
  }
  const candidates =
    compactRecoveryCandidateList("candidates", diagnostics.candidates)
    ?? compactRecoveryCandidateList("closest_lines", diagnostics.closest_lines);
  if (candidates) {
    parts.push(candidates);
  }
  const availableTools = compactRecoveryStringList("available_tools", errorData.available_tools);
  if (availableTools) {
    parts.push(availableTools);
  }
  const argumentKeys = compactRecoveryStringList("argument_keys", errorData.argument_keys);
  if (argumentKeys) {
    parts.push(argumentKeys);
  }
  const requestedSources = compactRecoveryStringList("requested_sources", errorData.requested_sources);
  if (requestedSources) {
    parts.push(requestedSources);
  }
  const hiddenArgs = compactRecoveryStringList("hidden_args", errorData.hidden_args);
  if (hiddenArgs) {
    parts.push(hiddenArgs);
  }
  const visibleArgs = compactRecoveryStringList("visible_args", errorData.visible_args);
  if (visibleArgs) {
    parts.push(visibleArgs);
  }
  const allowTools = compactRecoveryStringList("allow_tools", errorData.allow_tools);
  if (allowTools) {
    parts.push(allowTools);
  }
  const availableServers = compactRecoveryStringList("available_servers", errorData.available_servers);
  if (availableServers) {
    parts.push(availableServers);
  }
  return compactRecoveryDetail(parts.join(" "));
}
