import {
  listSlashCommandSuggestions,
  type SlashCommandSuggestion,
} from "../commands/slash/registry";
import {
  listRunStartUserCommandSuggestions,
  type RunStartUserCommandSuggestion,
} from "./run-start-user-commands";
import {
  resolvePlanStatusRecommendationActionId,
  resolvePlanStatusRecommendation,
  resolvePlanStatusRecommendationCommand,
} from "./run-start-plan-mode";

export interface RunStartSlashSuggestion {
  command: string;
  description: string;
  source: "builtin" | "user";
}

export type RunStartPlanSuggestionStatus =
  | "draft"
  | "blocked"
  | "review_failed"
  | "ready"
  | "approved"
  | "applying"
  | "apply_failed"
  | "applied"
  | "discarded";

export interface RunStartPlanSuggestionState {
  activePlanStatus?: RunStartPlanSuggestionStatus;
  latestPlanStatus?: RunStartPlanSuggestionStatus;
  latestVerificationStatus?: "pending" | "passed" | "failed";
}

interface ListRunStartSlashSuggestionsInput {
  homeDir: string;
  userInput: string;
  pendingAskCount?: number;
  planMode?: boolean;
  planSuggestionState?: RunStartPlanSuggestionState;
  maxItems?: number;
}

const ROOT_SLASH_PRIMARY_BUILTIN_COMMANDS = new Set<string>([
  "sessions",
  "resume",
  "rewind",
  "commands",
  "skill-creator",
  "ask",
  "model",
  "plan",
  "status",
  "help",
  "exit",
]);

const PENDING_ASK_PRIORITY_SUGGESTIONS: readonly RunStartSlashSuggestion[] = [
  {
    command: "/ask",
    description: "Show ask-user status",
    source: "builtin",
  },
];

const ASK_PRIORITY_SUGGESTIONS: readonly RunStartSlashSuggestion[] = [
  {
    command: "/ask",
    description: "Show ask-user status",
    source: "builtin",
  },
];

const PLAN_PRIMARY_PRIORITY_SUGGESTIONS: readonly RunStartSlashSuggestion[] = [
  {
    command: "/plan",
    description: "Open plan actions",
    source: "builtin",
  },
  {
    command: "/plan <goal>",
    description: "Start plan mode with a goal",
    source: "builtin",
  },
  {
    command: "/plan check",
    description: "Quick benchmark check-only (preset core)",
    source: "builtin",
  },
];

const PLAN_BENCHMARK_PRIORITY_SUGGESTIONS: readonly RunStartSlashSuggestion[] = [
  {
    command: "/plan benchmark <label=path>",
    description: "Benchmark active plan against external candidate(s)",
    source: "builtin",
  },
  {
    command: "/plan benchmark --preset core",
    description: "Benchmark active plan with preset codex/claude/generic baselines",
    source: "builtin",
  },
];

const PLAN_CHECK_PRIORITY_SUGGESTIONS: readonly RunStartSlashSuggestion[] = [
  {
    command: "/plan check",
    description: "Quick benchmark check-only (default: core)",
    source: "builtin",
  },
  {
    command: "/plan check core",
    description: "Quick check-only with preset core",
    source: "builtin",
  },
  {
    command: "/plan check generic",
    description: "Quick check-only with preset generic",
    source: "builtin",
  },
];

const PLAN_STATUS_PRIORITY_SUGGESTION: RunStartSlashSuggestion = {
  command: "/plan status",
  description: "Show active plan status summary",
  source: "builtin",
};

const PLAN_APPROVE_PRIORITY_SUGGESTION: RunStartSlashSuggestion = {
  command: "/plan approve [note]",
  description: "Approve active plan",
  source: "builtin",
};

const PLAN_REJECT_PRIORITY_SUGGESTION: RunStartSlashSuggestion = {
  command: "/plan reject [reason]",
  description: "Reject active plan and keep refining",
  source: "builtin",
};

const PLAN_VERIFY_PRIORITY_SUGGESTION: RunStartSlashSuggestion = {
  command: "/plan verify <pass|fail> [note]",
  description: "Record verification result for latest applied plan",
  source: "builtin",
};

const PLAN_APPLY_PRIORITY_SUGGESTION: RunStartSlashSuggestion = {
  command: "/plan apply [extra]",
  description: "Apply approved plan and exit plan mode",
  source: "builtin",
};

const PLAN_CANCEL_PRIORITY_SUGGESTION: RunStartSlashSuggestion = {
  command: "/plan cancel",
  description: "Exit plan mode",
  source: "builtin",
};

function pushUniqueSuggestion(
  rows: RunStartSlashSuggestion[],
  next: RunStartSlashSuggestion,
): void {
  if (rows.some((item) => item.command === next.command)) {
    return;
  }
  rows.push(next);
}

function resolvePlanEffectiveStatus(state: RunStartPlanSuggestionState | undefined): {
  activeStatus?: RunStartPlanSuggestionStatus;
  latestStatus?: RunStartPlanSuggestionStatus;
  effectiveStatus?: RunStartPlanSuggestionStatus;
  verificationPending: boolean;
} {
  const activeStatus = state?.activePlanStatus;
  const latestStatus = state?.latestPlanStatus;
  const latestVerificationStatus = state?.latestVerificationStatus;
  const effectiveStatus = activeStatus ?? latestStatus;
  return {
    activeStatus,
    latestStatus,
    effectiveStatus,
    verificationPending: latestVerificationStatus === undefined || latestVerificationStatus === "pending",
  };
}

function resolvePlanActionSuggestionsForPrefixA(
  state: RunStartPlanSuggestionState | undefined,
): readonly RunStartSlashSuggestion[] {
  const resolved = resolvePlanEffectiveStatus(state);
  if (resolved.effectiveStatus === "approved" || resolved.effectiveStatus === "applying") {
    return [PLAN_APPLY_PRIORITY_SUGGESTION, PLAN_APPROVE_PRIORITY_SUGGESTION];
  }
  return [PLAN_APPROVE_PRIORITY_SUGGESTION, PLAN_APPLY_PRIORITY_SUGGESTION];
}

function resolvePlanSuggestionStateTag(state: RunStartPlanSuggestionState | undefined): string | undefined {
  if (!state) {
    return undefined;
  }
  const resolved = resolvePlanEffectiveStatus(state);
  const activeStatus = resolved.activeStatus;
  const latestStatus = resolved.latestStatus;
  const effectiveStatus = resolved.effectiveStatus;
  const verificationLabel = resolved.verificationPending ? "pending" : "recorded";
  if (!activeStatus && (latestStatus === "applied" || latestStatus === "apply_failed")) {
    return `latest=${latestStatus}; verification=${verificationLabel}`;
  }
  if (effectiveStatus === "applied" || effectiveStatus === "apply_failed") {
    return `status=${effectiveStatus}; verification=${verificationLabel}`;
  }
  if (effectiveStatus) {
    return `status=${effectiveStatus}`;
  }
  return undefined;
}

function trimPlanRecommendationReason(reasonRaw: string): string {
  const compacted = reasonRaw.replace(/\s+/g, " ").trim();
  if (compacted.length <= 72) {
    return compacted;
  }
  return `${compacted.slice(0, 69)}...`;
}

function matchesPlanRecommendationCommand(input: {
  suggestionCommand: string;
  recommendationCommand: string;
}): boolean {
  const suggestionActionId = resolvePlanStatusRecommendationActionId(input.suggestionCommand);
  const recommendationActionId = resolvePlanStatusRecommendationActionId(input.recommendationCommand);
  if (recommendationActionId === "unknown" || suggestionActionId === "unknown") {
    return false;
  }
  if (suggestionActionId === recommendationActionId) {
    return true;
  }
  return false;
}

function resolvePlanRootPrioritySuggestions(input: {
  planMode: boolean;
  planSuggestionState?: RunStartPlanSuggestionState;
}): RunStartSlashSuggestion[] {
  const state = input.planSuggestionState;
  if (!state) {
    return [];
  }
  const rows: RunStartSlashSuggestion[] = [];
  const append = (item: RunStartSlashSuggestion): void => {
    pushUniqueSuggestion(rows, item);
  };
  const resolved = resolvePlanEffectiveStatus(state);
  const activeStatus = resolved.activeStatus;
  const latestStatus = resolved.latestStatus;
  const effectiveStatus = resolved.effectiveStatus;

  const appendNoActiveBaseline = (): void => {
    append(PLAN_PRIMARY_PRIORITY_SUGGESTIONS[1]);
    append(PLAN_CHECK_PRIORITY_SUGGESTIONS[0]);
    if (input.planMode) {
      append(PLAN_STATUS_PRIORITY_SUGGESTION);
      append(PLAN_CANCEL_PRIORITY_SUGGESTION);
    } else {
      append(PLAN_PRIMARY_PRIORITY_SUGGESTIONS[0]);
    }
  };

  const verificationPending = resolved.verificationPending;
  if (
    !activeStatus
    && (latestStatus === "applied" || latestStatus === "apply_failed")
    && verificationPending
  ) {
    append(PLAN_VERIFY_PRIORITY_SUGGESTION);
    append(PLAN_STATUS_PRIORITY_SUGGESTION);
    append(PLAN_PRIMARY_PRIORITY_SUGGESTIONS[1]);
    append(PLAN_CHECK_PRIORITY_SUGGESTIONS[0]);
    if (input.planMode) {
      append(PLAN_CANCEL_PRIORITY_SUGGESTION);
    }
    return rows;
  }

  if (effectiveStatus === "draft" || effectiveStatus === "blocked" || effectiveStatus === "review_failed") {
    append(PLAN_CHECK_PRIORITY_SUGGESTIONS[0]);
    append(PLAN_APPROVE_PRIORITY_SUGGESTION);
    append(PLAN_REJECT_PRIORITY_SUGGESTION);
    append(PLAN_STATUS_PRIORITY_SUGGESTION);
    if (input.planMode) {
      append(PLAN_CANCEL_PRIORITY_SUGGESTION);
    }
    return rows;
  }
  if (effectiveStatus === "ready") {
    append(PLAN_APPROVE_PRIORITY_SUGGESTION);
    append(PLAN_CHECK_PRIORITY_SUGGESTIONS[0]);
    append(PLAN_REJECT_PRIORITY_SUGGESTION);
    append(PLAN_STATUS_PRIORITY_SUGGESTION);
    if (input.planMode) {
      append(PLAN_CANCEL_PRIORITY_SUGGESTION);
    }
    return rows;
  }
  if (effectiveStatus === "approved") {
    append(PLAN_APPLY_PRIORITY_SUGGESTION);
    append(PLAN_STATUS_PRIORITY_SUGGESTION);
    append(PLAN_APPROVE_PRIORITY_SUGGESTION);
    append(PLAN_CHECK_PRIORITY_SUGGESTIONS[0]);
    if (input.planMode) {
      append(PLAN_CANCEL_PRIORITY_SUGGESTION);
    }
    return rows;
  }
  if (effectiveStatus === "applying") {
    append(PLAN_STATUS_PRIORITY_SUGGESTION);
    append(PLAN_APPLY_PRIORITY_SUGGESTION);
    if (input.planMode) {
      append(PLAN_CANCEL_PRIORITY_SUGGESTION);
    }
    return rows;
  }
  if (effectiveStatus === "apply_failed") {
    append(PLAN_VERIFY_PRIORITY_SUGGESTION);
    append(PLAN_CHECK_PRIORITY_SUGGESTIONS[0]);
    append(PLAN_REJECT_PRIORITY_SUGGESTION);
    append(PLAN_STATUS_PRIORITY_SUGGESTION);
    if (input.planMode) {
      append(PLAN_CANCEL_PRIORITY_SUGGESTION);
    } else {
      append(PLAN_PRIMARY_PRIORITY_SUGGESTIONS[1]);
    }
    return rows;
  }
  if (effectiveStatus === "applied") {
    if (verificationPending) {
      append(PLAN_VERIFY_PRIORITY_SUGGESTION);
      append(PLAN_STATUS_PRIORITY_SUGGESTION);
    }
    append(PLAN_PRIMARY_PRIORITY_SUGGESTIONS[1]);
    append(PLAN_CHECK_PRIORITY_SUGGESTIONS[0]);
    if (input.planMode) {
      append(PLAN_CANCEL_PRIORITY_SUGGESTION);
    }
    return rows;
  }
  if (effectiveStatus === "discarded") {
    appendNoActiveBaseline();
    return rows;
  }

  appendNoActiveBaseline();
  return rows;
}

function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase();
}

function startsWithSlashToken(value: string): boolean {
  return value.trimStart().startsWith("/");
}

function isRootSlashQuery(value: string): boolean {
  return value.trim() === "/";
}

function resolveSlashHead(value: string): string | undefined {
  const head = value
    .trimStart()
    .split(/\s+/, 1)[0]
    ?.toLowerCase();
  if (!head || !head.startsWith("/")) {
    return undefined;
  }
  return head;
}

function matchesSuggestionQuery(queryRaw: string, suggestionCommandRaw: string): boolean {
  const query = normalizeForMatch(queryRaw);
  if (!query || query === "/") {
    return true;
  }
  const suggestionCommand = normalizeForMatch(suggestionCommandRaw);
  if (suggestionCommand.startsWith(query)) {
    return true;
  }
  const queryWithoutTrailingSpace = queryRaw.trimStart().toLowerCase().replace(/\s+$/g, "");
  if (queryWithoutTrailingSpace.length > 0 && suggestionCommand.startsWith(queryWithoutTrailingSpace)) {
    return true;
  }
  const queryTokens = queryWithoutTrailingSpace
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const suggestionTokens = suggestionCommand
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (queryTokens.length <= 0 || suggestionTokens.length <= 0) {
    return false;
  }
  if (queryTokens.length > 1) {
    for (let tokenIndex = 0; tokenIndex < queryTokens.length; tokenIndex += 1) {
      const queryToken = queryTokens[tokenIndex] ?? "";
      const suggestionToken = suggestionTokens[tokenIndex] ?? "";
      if (!queryToken || !suggestionToken || !suggestionToken.startsWith(queryToken)) {
        return false;
      }
    }
    return true;
  }
  const queryHead = queryTokens[0] ?? "";
  const suggestionHead = suggestionTokens[0] ?? "";
  if (!queryHead || !suggestionHead) {
    return false;
  }
  return suggestionHead.startsWith(queryHead);
}

function toBuiltinSuggestion(item: SlashCommandSuggestion): RunStartSlashSuggestion {
  return {
    command: item.command,
    description: item.description,
    source: "builtin",
  };
}

function toUserSuggestion(item: RunStartUserCommandSuggestion): RunStartSlashSuggestion {
  return {
    command: item.command,
    description: item.enabled ? item.description : `${item.description} (disabled)`,
    source: "user",
  };
}

export function listRunStartSlashSuggestions(
  input: ListRunStartSlashSuggestionsInput,
): RunStartSlashSuggestion[] {
  if (!startsWithSlashToken(input.userInput)) {
    return [];
  }
  const maxItems = typeof input.maxItems === "number" && input.maxItems > 0
    ? Math.floor(input.maxItems)
    : 8;
  const query = input.userInput.trimStart();
  const queryHead = resolveSlashHead(query);
  const normalizedQuery = normalizeForMatch(query);
  const isRootSlash = isRootSlashQuery(query);
  const planMode = input.planMode === true;
  const hasPendingAsk = typeof input.pendingAskCount === "number" && input.pendingAskCount > 0;
  const suggestions: RunStartSlashSuggestion[] = [];
  const seen = new Set<string>();

  const appendSuggestion = (item: RunStartSlashSuggestion): void => {
    const commandHead = (item.command.trim().split(/\s+/, 1)[0] ?? "").replace(/^\//, "").toLowerCase();
    const isRootSubcommand = item.command.trim().includes(" ");
    if (
      isRootSlash
      && item.source === "builtin"
      && !ROOT_SLASH_PRIMARY_BUILTIN_COMMANDS.has(commandHead)
    ) {
      return;
    }
    if (isRootSlash && item.source === "builtin" && isRootSubcommand) {
      return;
    }
    if (!matchesSuggestionQuery(query, item.command)) {
      return;
    }
    if (seen.has(item.command)) {
      return;
    }
    if (
      planMode
      && queryHead === "/plan"
      && normalizedQuery === "/plan"
      && item.command === "/plan"
    ) {
      return;
    }
    seen.add(item.command);
    suggestions.push(item);
  };

  if (hasPendingAsk) {
    for (const entry of PENDING_ASK_PRIORITY_SUGGESTIONS) {
      appendSuggestion(entry);
    }
  }
  if (queryHead === "/ask") {
    for (const entry of ASK_PRIORITY_SUGGESTIONS) {
      appendSuggestion(entry);
    }
  }
  if (queryHead === "/plan") {
    if (normalizedQuery === "/plan") {
      const stateDriven = resolvePlanRootPrioritySuggestions({
        planMode,
        planSuggestionState: input.planSuggestionState,
      });
      if (stateDriven.length > 0) {
        for (const entry of stateDriven) {
          appendSuggestion(entry);
        }
      } else if (planMode) {
        appendSuggestion(PLAN_STATUS_PRIORITY_SUGGESTION);
        appendSuggestion(PLAN_CHECK_PRIORITY_SUGGESTIONS[0]);
        appendSuggestion(PLAN_APPROVE_PRIORITY_SUGGESTION);
        appendSuggestion(PLAN_VERIFY_PRIORITY_SUGGESTION);
        appendSuggestion(PLAN_APPLY_PRIORITY_SUGGESTION);
        appendSuggestion(PLAN_CANCEL_PRIORITY_SUGGESTION);
      } else {
        for (const entry of PLAN_PRIMARY_PRIORITY_SUGGESTIONS) {
          appendSuggestion(entry);
        }
      }
    } else {
      for (const entry of PLAN_PRIMARY_PRIORITY_SUGGESTIONS) {
        appendSuggestion(entry);
      }
    }
    if (normalizedQuery.startsWith("/plan s")) {
      appendSuggestion(PLAN_STATUS_PRIORITY_SUGGESTION);
    }
    if (normalizedQuery.startsWith("/plan a")) {
      const actionSuggestions = resolvePlanActionSuggestionsForPrefixA(input.planSuggestionState);
      for (const entry of actionSuggestions) {
        appendSuggestion(entry);
      }
    }
    if (normalizedQuery.startsWith("/plan r")) {
      appendSuggestion(PLAN_REJECT_PRIORITY_SUGGESTION);
    }
    if (normalizedQuery.startsWith("/plan v")) {
      appendSuggestion(PLAN_VERIFY_PRIORITY_SUGGESTION);
    }
    if (normalizedQuery.startsWith("/plan b")) {
      for (const entry of PLAN_BENCHMARK_PRIORITY_SUGGESTIONS) {
        appendSuggestion(entry);
      }
    }
    if (normalizedQuery.startsWith("/plan c")) {
      for (const entry of PLAN_CHECK_PRIORITY_SUGGESTIONS) {
        appendSuggestion(entry);
      }
    }
    if (normalizedQuery.startsWith("/plan o")) {
      appendSuggestion({
        command: "/plan open",
        description: "Open active plan file in editor",
        source: "builtin",
      });
    }
    if (normalizedQuery.startsWith("/plan ca")) {
      appendSuggestion(PLAN_CANCEL_PRIORITY_SUGGESTION);
    }
  }

  const builtin = listSlashCommandSuggestions();
  for (const entry of builtin) {
    appendSuggestion(toBuiltinSuggestion(entry));
  }

  const userCommands = listRunStartUserCommandSuggestions(input.homeDir);
  for (const entry of userCommands) {
    appendSuggestion(toUserSuggestion(entry));
  }

  const planRecommendation = queryHead === "/plan"
    ? (() => {
      const recommendation = resolvePlanStatusRecommendation({
        mode: input.planMode === true ? "plan_only" : "normal",
        status: input.planSuggestionState?.activePlanStatus ?? input.planSuggestionState?.latestPlanStatus,
        latestVerificationStatus: input.planSuggestionState?.latestVerificationStatus,
      });
      return {
        command: resolvePlanStatusRecommendationCommand(recommendation.action),
        reason: trimPlanRecommendationReason(recommendation.reason),
      };
    })()
    : undefined;
  const planStateTag = queryHead === "/plan"
    ? resolvePlanSuggestionStateTag(input.planSuggestionState)
    : undefined;
  const renderedSuggestions = queryHead === "/plan"
    ? suggestions.map((item) => {
      if (!item.command.startsWith("/plan")) {
        return item;
      }
      const suffixParts: string[] = [];
      if (planStateTag) {
        suffixParts.push(planStateTag);
      }
      if (
        planRecommendation
        && planRecommendation.reason.length > 0
        && matchesPlanRecommendationCommand({
          suggestionCommand: item.command,
          recommendationCommand: planRecommendation.command,
        })
      ) {
        suffixParts.push(`Recommended now: ${planRecommendation.reason}`);
      }
      if (suffixParts.length <= 0) {
        return item;
      }
      return {
        ...item,
        description: `${item.description} · ${suffixParts.join(" · ")}`,
      };
    })
    : suggestions;

  if (renderedSuggestions.length <= maxItems) {
    return renderedSuggestions;
  }
  return renderedSuggestions.slice(0, maxItems);
}
